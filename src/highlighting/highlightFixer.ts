import { ExplanationSegment } from "../llm/llmClient";

/**
 * Post-process LLM segments to fix highlight ranges by matching
 * identifiers from the narration against the actual source code.
 */
export function fixHighlightRanges(
  segments: ExplanationSegment[],
  sourceCode: string,
  sourceStartLine: number
): ExplanationSegment[] {
  const lines = sourceCode.split("\n");

  return segments.map((seg, segIdx) => {
    // If the segment already has a valid range that looks reasonable, keep it
    if (
      seg.highlight_range.start > 0 &&
      seg.highlight_range.end > 0 &&
      seg.highlight_range.start <= seg.highlight_range.end &&
      seg.highlight_range.end <= sourceStartLine + lines.length
    ) {
      return seg;
    }

    // Try to find the right lines by extracting identifiers from the narration
    const identifiers = extractIdentifiers(seg.narration);
    if (identifiers.length === 0) return seg;

    // Find the best matching line range
    const match = findBestMatch(lines, identifiers, sourceStartLine, segments, segIdx);
    if (match) {
      return {
        ...seg,
        highlight_range: { start: match.start, end: match.end },
        highlight_lines: Array.from(
          { length: match.end - match.start + 1 },
          (_, i) => match.start + i
        ),
      };
    }

    return seg;
  });
}

/**
 * Extract likely code identifiers from narration text.
 * Looks for camelCase, snake_case, PascalCase words, and backtick-quoted terms.
 */
function extractIdentifiers(narration: string): string[] {
  const ids = new Set<string>();

  // Backtick-quoted identifiers
  const backtickMatches = narration.match(/`([^`]+)`/g);
  if (backtickMatches) {
    for (const m of backtickMatches) {
      ids.add(m.slice(1, -1));
    }
  }

  // camelCase, PascalCase, snake_case identifiers (at least 2 parts)
  const codePattern = /\b([a-z][a-zA-Z0-9]*[A-Z][a-zA-Z0-9]*|[A-Z][a-z]+[A-Z][a-zA-Z0-9]*|[a-z]+_[a-z_]+)\b/g;
  let match;
  while ((match = codePattern.exec(narration)) !== null) {
    ids.add(match[1]);
  }

  // Single quoted or common code references like function names
  const singleWords = narration.match(/\b(function|class|const|let|var|def|fn|func|type|interface|struct|enum)\s+(\w+)/gi);
  if (singleWords) {
    for (const m of singleWords) {
      const name = m.split(/\s+/)[1];
      if (name) ids.add(name);
    }
  }

  return Array.from(ids);
}

/**
 * Find the line range in source that best matches the given identifiers.
 * Avoids overlapping with already-assigned segments.
 */
function findBestMatch(
  lines: string[],
  identifiers: string[],
  sourceStartLine: number,
  allSegments: ExplanationSegment[],
  currentIdx: number
): { start: number; end: number } | null {
  // Find all lines containing any of the identifiers
  const matchingLines: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    const lineNum = sourceStartLine + i;
    for (const id of identifiers) {
      if (lines[i].includes(id)) {
        matchingLines.push(lineNum);
        break;
      }
    }
  }

  if (matchingLines.length === 0) return null;

  // Find the first matching identifier and expand to a logical block
  const firstMatch = matchingLines[0];
  const lastMatch = matchingLines[matchingLines.length - 1];

  // Try to expand to cover the full block (find enclosing braces, etc.)
  const startIdx = firstMatch - sourceStartLine;
  const endIdx = lastMatch - sourceStartLine;

  // Expand backwards to find the start of the block (function/class declaration)
  let blockStart = startIdx;
  for (let i = startIdx - 1; i >= 0 && i >= startIdx - 3; i--) {
    const line = lines[i].trim();
    if (
      line.match(/^(export\s+)?(async\s+)?(function|class|const|let|var|type|interface|def|fn|pub|func)/) ||
      line.match(/^\w.*=>/) ||
      line === ""
    ) {
      blockStart = i;
      break;
    }
  }

  // Expand forward to find the end of the block
  let blockEnd = endIdx;
  let braceDepth = 0;
  for (let i = blockStart; i < lines.length && i <= endIdx + 10; i++) {
    for (const ch of lines[i]) {
      if (ch === "{" || ch === "(") braceDepth++;
      if (ch === "}" || ch === ")") braceDepth--;
    }
    blockEnd = i;
    if (braceDepth <= 0 && i > endIdx) break;
  }

  return {
    start: sourceStartLine + blockStart,
    end: sourceStartLine + blockEnd,
  };
}
