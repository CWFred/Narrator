import * as vscode from "vscode";

export interface CodeContext {
  selectedText: string;
  language: string;
  fileName: string;
  relativePath: string;
  startLine: number;
  endLine: number;
  surroundingContext: string;
}

const CONTEXT_LINES = 50;

export function extractCodeContext(
  editor: vscode.TextEditor
): CodeContext | undefined {
  const document = editor.document;
  const selection = editor.selection;

  let selectedText: string;
  let startLine: number;
  let endLine: number;

  if (selection.isEmpty) {
    // Fall back to the full visible range
    const visibleRanges = editor.visibleRanges;
    if (visibleRanges.length === 0) {
      return undefined;
    }
    const visibleRange = visibleRanges[0];
    startLine = visibleRange.start.line;
    endLine = visibleRange.end.line;
    selectedText = document.getText(visibleRange);
  } else {
    startLine = selection.start.line;
    endLine = selection.end.line;
    selectedText = document.getText(selection);
  }

  if (!selectedText.trim()) {
    return undefined;
  }

  // Get surrounding context (±50 lines around selection)
  const contextStart = Math.max(0, startLine - CONTEXT_LINES);
  const contextEnd = Math.min(
    document.lineCount - 1,
    endLine + CONTEXT_LINES
  );
  const contextRange = new vscode.Range(contextStart, 0, contextEnd, 0);
  const surroundingContext = document.getText(contextRange);

  const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
  const relativePath = workspaceFolder
    ? vscode.workspace.asRelativePath(document.uri)
    : document.fileName;

  return {
    selectedText,
    language: document.languageId,
    fileName: document.fileName.split("/").pop() || document.fileName,
    relativePath,
    startLine: startLine + 1, // 1-indexed for display
    endLine: endLine + 1,
    surroundingContext,
  };
}
