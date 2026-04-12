import * as vscode from "vscode";

const highlightDecoration = vscode.window.createTextEditorDecorationType({
  backgroundColor: new vscode.ThemeColor("editor.findMatchHighlightBackground"),
  borderRadius: "3px",
  isWholeLine: true,
});

export function highlight(
  editor: vscode.TextEditor,
  startLine: number,
  endLine: number
): void {
  // Skip invalid ranges (e.g. overview segments with 0,0)
  if (startLine <= 0 || endLine <= 0) return;

  // Lines from LLM are 1-indexed; VS Code ranges are 0-indexed
  const start = Math.max(0, startLine - 1);
  const end = Math.min(editor.document.lineCount - 1, endLine - 1);
  const range = new vscode.Range(start, 0, end, Number.MAX_SAFE_INTEGER);
  editor.setDecorations(highlightDecoration, [range]);

  // Scroll to the highlighted range
  editor.revealRange(range, vscode.TextEditorRevealType.InCenter);
}

export function clear(editor: vscode.TextEditor): void {
  editor.setDecorations(highlightDecoration, []);
}
