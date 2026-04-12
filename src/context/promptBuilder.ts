import { CodeContext } from "./codeContext";
import { DepthLevel } from "../config/settings";

const SYSTEM_PROMPTS: Record<DepthLevel, string> = {
  overview: `You are a senior engineer explaining code to a colleague joining the team.
Give a high-level explanation of WHAT this code does and WHY it exists.
3-5 sentences maximum. No line-by-line detail. Focus on purpose and role in the system.`,

  standard: `You are a senior engineer doing a code walkthrough.
Explain what this code does, walking through the key sections.
Mention any important patterns, dependencies, or non-obvious decisions.`,

  deep: `You are a senior engineer doing a thorough code review walkthrough.
Explain this code comprehensively: its purpose, how it works section by section,
the patterns it uses, edge cases it handles, potential gotchas, and what someone
would need to know before modifying it.`,
};

const JSON_FORMAT_INSTRUCTION = `

You MUST respond with valid JSON in exactly this format:
{
  "segments": [
    {
      "narration": "Plain English explanation for this section.",
      "highlight_lines": [12, 13, 14],
      "highlight_range": { "start": 12, "end": 14 }
    }
  ],
  "summary": "One-sentence summary of the entire code."
}

CRITICAL rules for highlight_lines and highlight_range:
- Each line of code is numbered (e.g., "  14 |   const x = 1"). Use EXACTLY those line numbers.
- highlight_range.start and highlight_range.end must EXACTLY match the first and last line your narration describes. No overlap with other segments.
- Segments must cover consecutive, non-overlapping line ranges. If segment 1 ends at line 20, segment 2 must start at line 21 or later.
- highlight_lines must list every line number in the range.
- Each segment's narration should be 1-3 sentences, suitable for reading aloud.
- Do NOT include markdown, code fences, or any text outside the JSON.`;

export function buildSystemPrompt(depth: DepthLevel): string {
  return SYSTEM_PROMPTS[depth] + JSON_FORMAT_INSTRUCTION;
}

function addLineNumbers(text: string, startLine: number): string {
  return text
    .split("\n")
    .map((line, i) => `  ${startLine + i} | ${line}`)
    .join("\n");
}

export function buildUserPrompt(context: CodeContext): string {
  const numberedCode = addLineNumbers(context.selectedText, context.startLine);

  return `File: ${context.relativePath}
Language: ${context.language}
Lines ${context.startLine}–${context.endLine}:

${numberedCode}`;
}

export function buildDrillDownPrompt(
  startLine: number,
  endLine: number,
  parentNarration: string
): { system: string; user: string } {
  const system = `You are explaining a specific section of code in more detail.
This code was previously described as: "${parentNarration}"

Now explain it at a finer level of detail, breaking it into smaller sections.
Each section should cover 2-5 lines. Explain what each section does and why.

You MUST respond with valid JSON in exactly this format:
{
  "segments": [
    {
      "narration": "Plain English explanation for this section.",
      "highlight_lines": [12, 13, 14],
      "highlight_range": { "start": 12, "end": 14 }
    }
  ],
  "summary": "One-sentence summary."
}

CRITICAL rules for highlight_lines and highlight_range:
- Each line of code is numbered (e.g., "  14 |   const x = 1"). Use EXACTLY those line numbers.
- highlight_range.start and highlight_range.end must EXACTLY match the first and last line your narration describes. No overlap with other segments.
- Segments must cover consecutive, non-overlapping line ranges.
- highlight_lines must list every line number in the range.
- Each segment's narration should be 1-2 sentences, suitable for reading aloud.
- Do NOT include markdown, code fences, or any text outside the JSON.`;

  return { system, user: "" };
}
