import * as vscode from "vscode";
import { NarratorPanel } from "./panel";

export type ExtensionMessage =
  | { type: "codeContext"; payload: { code: string; language: string; fileName: string; startLine: number; endLine: number } }
  | { type: "explanationChunk"; payload: { text: string } }
  | { type: "explanationComplete"; payload: { segments: ExplanationSegment[]; summary: string } }
  | { type: "audioData"; payload: { segmentId: string; narrationText: string; audioBase64: string; mimeType: string } }
  | { type: "ttsStarted"; payload: { segmentId: string } }
  | { type: "drillDownComplete"; payload: { segmentId: string; children: ExplanationSegment[] } }
  | { type: "repoTourNext"; payload: { currentFile: number; totalFiles: number; nextFile: string } }
  | { type: "error"; payload: { message: string } };

export type WebviewMessage =
  | { type: "ready" }
  | { type: "requestExplanation"; payload: { depth: string } }
  | { type: "followUp"; payload: { question: string; scopeStartLine?: number; scopeEndLine?: number; parentNarration?: string } }
  | { type: "startOver" }
  | { type: "segmentStarted"; payload: { segmentId: string; startLine: number; endLine: number } }
  | { type: "segmentEnded"; payload: { segmentId: string } }
  | { type: "playbackStopped" }
  | { type: "narrateSegment"; payload: { segmentId: string; text: string } }
  | { type: "drillDown"; payload: { segmentId: string; startLine: number; endLine: number; parentNarration: string } }
  | { type: "startAudioGeneration"; payload: { segments: Array<{ segmentId: string; text: string }> } }
  | { type: "nextFile" }
  | { type: "prevFile" }
  | { type: "stopTour" };

export interface ExplanationSegment {
  narration: string;
  highlight_lines: number[];
  highlight_range: { start: number; end: number };
}

export function setupMessageHandler(
  panel: NarratorPanel,
  onMessage: (message: WebviewMessage) => void
): vscode.Disposable {
  return panel.webview.onDidReceiveMessage((message: WebviewMessage) => {
    onMessage(message);
  });
}

export function getNonce(): string {
  let text = "";
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  for (let i = 0; i < 32; i++) {
    text += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return text;
}
