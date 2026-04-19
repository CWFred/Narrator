interface ExportPattern {
  regex: RegExp;
}

const EXPORT_PATTERNS: Record<string, ExportPattern[]> = {
  // JavaScript / TypeScript
  js: [
    { regex: /^export\s+(?:default\s+)?(?:async\s+)?function\s+\w+[^{]*/gm },
    { regex: /^export\s+(?:default\s+)?class\s+\w+[^{]*/gm },
    { regex: /^export\s+(?:const|let|var)\s+\w+\s*(?::[^=]+)?/gm },
    { regex: /^export\s+(?:interface|type)\s+\w+[^{]*/gm },
  ],
  ts: undefined as any,
  jsx: undefined as any,
  tsx: undefined as any,

  // Python
  py: [
    { regex: /^def\s+\w+\(.*?\).*?:/gm },
    { regex: /^class\s+\w+.*?:/gm },
  ],

  // Java
  java: [
    { regex: /^\s*public\s+(?:static\s+)?(?:abstract\s+)?(?:class|interface|enum)\s+\w+[^{]*/gm },
    { regex: /^\s*public\s+(?:static\s+)?(?:abstract\s+)?(?:synchronized\s+)?\S+\s+\w+\s*\([^)]*\)/gm },
  ],

  // C#
  cs: [
    { regex: /^\s*public\s+(?:static\s+)?(?:abstract\s+)?(?:partial\s+)?(?:class|interface|struct|enum)\s+\w+[^{]*/gm },
    { regex: /^\s*public\s+(?:static\s+)?(?:async\s+)?(?:virtual\s+)?(?:override\s+)?\S+\s+\w+\s*\([^)]*\)/gm },
  ],

  // C / C++
  c: [
    { regex: /^(?:extern\s+)?(?:static\s+)?(?:inline\s+)?(?:const\s+)?\w[\w\s*]+\s+\w+\s*\([^)]*\)\s*;/gm },
    { regex: /^(?:class|struct)\s+\w+/gm },
  ],
  cpp: undefined as any,
  h: undefined as any,
  hpp: undefined as any,

  // PHP
  php: [
    { regex: /^\s*(?:public\s+)?(?:static\s+)?function\s+\w+\s*\([^)]*\)/gm },
    { regex: /^\s*(?:abstract\s+)?class\s+\w+[^{]*/gm },
    { regex: /^\s*interface\s+\w+[^{]*/gm },
  ],

  // Go
  go: [
    { regex: /^func\s+(?:\(\w+\s+\*?\w+\)\s+)?[A-Z]\w*\s*\([^)]*\).*$/gm },
    { regex: /^type\s+[A-Z]\w+\s+(?:struct|interface)/gm },
  ],

  // Rust
  rs: [
    { regex: /^\s*pub\s+(?:async\s+)?fn\s+\w+[^{]*/gm },
    { regex: /^\s*pub\s+(?:struct|enum|trait|type)\s+\w+[^{]*/gm },
  ],

  // Swift
  swift: [
    { regex: /^\s*(?:public|open)\s+(?:static\s+)?func\s+\w+[^{]*/gm },
    { regex: /^\s*(?:public|open)\s+(?:class|struct|protocol|enum)\s+\w+[^{]*/gm },
  ],

  // Kotlin
  kt: [
    { regex: /^\s*(?:public\s+)?(?:suspend\s+)?fun\s+\w+[^{]*/gm },
    { regex: /^\s*(?:public\s+)?(?:data\s+)?(?:sealed\s+)?(?:class|interface|object)\s+\w+[^{]*/gm },
  ],

  // Ruby
  rb: [
    { regex: /^\s*def\s+(?:self\.)?\w+(?:\(.*?\))?/gm },
    { regex: /^\s*(?:class|module)\s+\w+/gm },
  ],

  // SQL
  sql: [
    { regex: /CREATE\s+(?:OR\s+REPLACE\s+)?(?:TABLE|VIEW|FUNCTION|PROCEDURE)\s+(?:IF\s+NOT\s+EXISTS\s+)?\S+/gim },
  ],
};

// Aliases
EXPORT_PATTERNS.ts = EXPORT_PATTERNS.js;
EXPORT_PATTERNS.jsx = EXPORT_PATTERNS.js;
EXPORT_PATTERNS.tsx = EXPORT_PATTERNS.js;
EXPORT_PATTERNS.cpp = EXPORT_PATTERNS.c;
EXPORT_PATTERNS.h = EXPORT_PATTERNS.c;
EXPORT_PATTERNS.hpp = EXPORT_PATTERNS.c;

function getExtension(filePath: string): string {
  const parts = filePath.split(".");
  return parts[parts.length - 1]?.toLowerCase() || "";
}

export function extractExports(content: string, filePath: string): string[] {
  const ext = getExtension(filePath);
  const patterns = EXPORT_PATTERNS[ext];
  if (!patterns) return [];

  const results: string[] = [];
  for (const pattern of patterns) {
    const regex = new RegExp(pattern.regex.source, pattern.regex.flags);
    let match: RegExpExecArray | null;
    while ((match = regex.exec(content)) !== null) {
      const signature = match[0].trim();
      if (signature && !results.includes(signature)) {
        results.push(signature);
      }
    }
  }
  return results;
}
