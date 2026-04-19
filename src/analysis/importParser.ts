import * as vscode from "vscode";

export interface ImportGraph {
  imports: Map<string, string[]>;
  importedBy: Map<string, string[]>;
  centrality: Map<string, number>;
}

interface ImportPattern {
  regex: RegExp;
  extractPath: (match: RegExpMatchArray) => string | null;
}

const LANGUAGE_PATTERNS: Record<string, ImportPattern[]> = {
  // JavaScript / TypeScript
  js: [
    { regex: /import\s+.*?\s+from\s+['"](.+?)['"]/g, extractPath: (m) => m[1] },
    { regex: /require\(\s*['"](.+?)['"]\s*\)/g, extractPath: (m) => m[1] },
    { regex: /export\s+.*?\s+from\s+['"](.+?)['"]/g, extractPath: (m) => m[1] },
  ],
  ts: undefined as any, // set below
  jsx: undefined as any,
  tsx: undefined as any,

  // Python
  py: [
    { regex: /^from\s+(\S+)\s+import/gm, extractPath: (m) => m[1] },
    { regex: /^import\s+(\S+)/gm, extractPath: (m) => m[1] },
  ],

  // Java
  java: [
    { regex: /^import\s+(?:static\s+)?(\S+);/gm, extractPath: (m) => m[1] },
  ],

  // C#
  cs: [
    { regex: /^using\s+(?:static\s+)?(\S+);/gm, extractPath: (m) => m[1] },
  ],

  // C / C++
  c: [
    { regex: /#include\s*["<](.+?)[">]/g, extractPath: (m) => m[1] },
  ],
  cpp: undefined as any,
  h: undefined as any,
  hpp: undefined as any,

  // PHP
  php: [
    { regex: /use\s+(\S+?)(?:\s+as\s+\S+)?;/g, extractPath: (m) => m[1] },
    { regex: /(?:require|include)(?:_once)?\s*\(?\s*['"](.+?)['"]/g, extractPath: (m) => m[1] },
  ],

  // Go
  go: [
    { regex: /import\s+(?:\w+\s+)?"(.+?)"/g, extractPath: (m) => m[1] },
    { regex: /import\s*\(\s*(?:\n\s*(?:\w+\s+)?"(.+?)")+/g, extractPath: (m) => m[1] },
  ],

  // Rust
  rs: [
    { regex: /use\s+(?:crate::)?(\S+?)(?:::\{.*?\})?;/g, extractPath: (m) => m[1] },
    { regex: /mod\s+(\w+);/g, extractPath: (m) => m[1] },
  ],

  // Swift
  swift: [
    { regex: /^import\s+(\w+)/gm, extractPath: (m) => m[1] },
  ],

  // Kotlin
  kt: [
    { regex: /^import\s+(\S+)/gm, extractPath: (m) => m[1] },
  ],

  // Ruby
  rb: [
    { regex: /require\s+['"](.+?)['"]/g, extractPath: (m) => m[1] },
    { regex: /require_relative\s+['"](.+?)['"]/g, extractPath: (m) => m[1] },
  ],
};

// Aliases
LANGUAGE_PATTERNS.ts = LANGUAGE_PATTERNS.js;
LANGUAGE_PATTERNS.jsx = LANGUAGE_PATTERNS.js;
LANGUAGE_PATTERNS.tsx = LANGUAGE_PATTERNS.js;
LANGUAGE_PATTERNS.cpp = LANGUAGE_PATTERNS.c;
LANGUAGE_PATTERNS.h = LANGUAGE_PATTERNS.c;
LANGUAGE_PATTERNS.hpp = LANGUAGE_PATTERNS.c;

function getExtension(filePath: string): string {
  const parts = filePath.split(".");
  return parts[parts.length - 1]?.toLowerCase() || "";
}

function extractImports(content: string, ext: string): string[] {
  const patterns = LANGUAGE_PATTERNS[ext];
  if (!patterns) return [];

  const results: string[] = [];
  for (const pattern of patterns) {
    const regex = new RegExp(pattern.regex.source, pattern.regex.flags);
    let match: RegExpExecArray | null;
    while ((match = regex.exec(content)) !== null) {
      const path = pattern.extractPath(match);
      if (path) results.push(path);
    }
  }
  return results;
}

function resolveImportToFile(
  importPath: string,
  sourceFile: string,
  allFilePaths: string[]
): string | null {
  // Skip obvious external imports
  if (importPath.startsWith("@") && !importPath.startsWith("@/")) return null;
  if (!importPath.startsWith(".") && !importPath.startsWith("/")) {
    // Could be a project-internal absolute import — try to match
    const candidates = allFilePaths.filter((f) =>
      f.includes(importPath.replace(/\./g, "/"))
    );
    return candidates.length === 1 ? candidates[0] : null;
  }

  // Resolve relative paths
  const sourceParts = sourceFile.split("/");
  sourceParts.pop(); // remove filename
  const importParts = importPath.split("/");

  for (const part of importParts) {
    if (part === "..") sourceParts.pop();
    else if (part !== ".") sourceParts.push(part);
  }

  const resolved = sourceParts.join("/");

  // Try exact match, then with extensions
  const extensions = ["", ".ts", ".tsx", ".js", ".jsx", ".py", ".rs", ".go",
    ".java", ".cs", ".c", ".cpp", ".h", ".php", ".swift", ".kt", ".rb",
    "/index.ts", "/index.js", "/index.tsx", "/index.jsx", "/mod.rs"];

  for (const ext of extensions) {
    const candidate = resolved + ext;
    if (allFilePaths.includes(candidate)) return candidate;
  }
  return null;
}

export async function buildImportGraph(
  files: vscode.Uri[],
  workspaceFolder: vscode.WorkspaceFolder
): Promise<ImportGraph> {
  const imports = new Map<string, string[]>();
  const importedBy = new Map<string, string[]>();
  const allPaths = files.map((f) => vscode.workspace.asRelativePath(f));

  // Initialize maps
  for (const path of allPaths) {
    imports.set(path, []);
    importedBy.set(path, []);
  }

  // Extract imports from each file (first 50 lines)
  for (const file of files) {
    const relativePath = vscode.workspace.asRelativePath(file);
    const ext = getExtension(relativePath);
    if (!LANGUAGE_PATTERNS[ext]) continue;

    try {
      const doc = await vscode.workspace.openTextDocument(file);
      const lines = doc.getText().split("\n").slice(0, 50).join("\n");
      const rawImports = extractImports(lines, ext);

      const resolved: string[] = [];
      for (const raw of rawImports) {
        const target = resolveImportToFile(raw, relativePath, allPaths);
        if (target && target !== relativePath) {
          resolved.push(target);
          const existing = importedBy.get(target) || [];
          if (!existing.includes(relativePath)) {
            importedBy.set(target, [...existing, relativePath]);
          }
        }
      }
      imports.set(relativePath, resolved);
    } catch {
      // Skip unreadable files
    }
  }

  // Calculate centrality (number of direct + transitive importers)
  const centrality = new Map<string, number>();
  for (const path of allPaths) {
    const visited = new Set<string>();
    const queue = importedBy.get(path) || [];
    for (const q of queue) {
      if (!visited.has(q)) {
        visited.add(q);
        const transitive = importedBy.get(q) || [];
        for (const t of transitive) {
          if (!visited.has(t) && t !== path) queue.push(t);
        }
      }
    }
    centrality.set(path, visited.size);
  }

  return { imports, importedBy, centrality };
}

export function formatGraphSummary(
  graph: ImportGraph,
  filePath: string
): string {
  const deps = graph.imports.get(filePath) || [];
  const dependents = graph.importedBy.get(filePath) || [];
  const lines: string[] = [];
  if (deps.length > 0) lines.push(`Imports from: ${deps.join(", ")}`);
  if (dependents.length > 0) lines.push(`Imported by: ${dependents.join(", ")}`);
  return lines.join("\n");
}
