import * as vscode from "vscode";
import { extractCodeContext } from "../context/codeContext";
import { NarratorPanel } from "../webview/panel";
import { setupMessageHandler, WebviewMessage } from "../webview/messageHandler";
import { highlight, clear } from "../highlighting/decorationEngine";
import { getConfig, DepthLevel } from "../config/settings";
import { LlmClient, ExplanationResult } from "../llm/llmClient";
import { ClaudeClient } from "../llm/claudeClient";
import { LocalLlmClient } from "../llm/ollamaClient";
import { TtsClient } from "../tts/ttsClient";
import { ElevenLabsClient } from "../tts/elevenLabsClient";
import { KokoroClient } from "../tts/kokoroClient";
import { MlxAudioClient } from "../tts/mlxAudioClient";
import { ConversationManager } from "../context/conversationManager";
import { fixHighlightRanges } from "../highlighting/highlightFixer";
import { buildDrillDownPrompt } from "../context/promptBuilder";

const conversation = new ConversationManager();
let lastDocumentUri: vscode.Uri | undefined;

function createLlmClient(): LlmClient {
  const config = getConfig();
  if (config.llmProvider === "claude") {
    if (!config.claudeApiKey) {
      throw new Error(
        "Claude API key not set. Configure it in Settings → Narrator."
      );
    }
    return new ClaudeClient(config.claudeApiKey);
  }
  return new LocalLlmClient(config.localLlmUrl, config.localLlmModel);
}

function createTtsClient(): TtsClient | undefined {
  const config = getConfig();
  if (config.ttsProvider === "none") return undefined;
  if (config.ttsProvider === "elevenlabs") {
    if (!config.elevenLabsApiKey) {
      throw new Error(
        "ElevenLabs API key not set. Configure it in Settings → Narrator."
      );
    }
    return new ElevenLabsClient(config.elevenLabsApiKey, config.voiceId);
  }
  return new KokoroClient(config.kokoroUrl, config.kokoroVoice);
}

async function sendTtsForSegments(
  panel: NarratorPanel,
  ttsClient: TtsClient | undefined,
  segments: Array<{ id: string; narration: string }>
) {
  if (!ttsClient) return;
  for (const seg of segments) {
    try {
      const audio = await ttsClient.synthesize(seg.narration);
      panel.postMessage({
        type: "audioData",
        payload: {
          segmentId: seg.id,
          narrationText: seg.narration,
          audioBase64: audio.audioBase64,
          mimeType: audio.mimeType,
        },
      });
    } catch (err: unknown) {
      console.error(`TTS error for segment ${seg.id}:`, err);
    }
  }
}

function addLineNumbers(text: string, startLine: number): string {
  return text
    .split("\n")
    .map((line, i) => `  ${startLine + i} | ${line}`)
    .join("\n");
}

async function handleDrillDown(
  panel: NarratorPanel,
  segmentId: string,
  startLine: number,
  endLine: number,
  parentNarration: string
) {
  // Use stored URI since the webview panel may have focus, not the editor
  let doc: vscode.TextDocument;
  if (lastDocumentUri) {
    doc = await vscode.workspace.openTextDocument(lastDocumentUri);
  } else {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;
    doc = editor.document;
  }
  const range = new vscode.Range(startLine - 1, 0, endLine, 0);
  const codeSlice = doc.getText(range);
  const numberedCode = addLineNumbers(codeSlice, startLine);

  let llmClient: LlmClient;
  try {
    llmClient = createLlmClient();
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    panel.postMessage({ type: "error", payload: { message: msg } });
    return;
  }

  const { system } = buildDrillDownPrompt(startLine, endLine, parentNarration);
  const userPrompt = `Lines ${startLine}–${endLine}:\n\n${numberedCode}`;

  try {
    const result = await llmClient.explain(system, userPrompt, () => {});
    result.segments = fixHighlightRanges(result.segments, codeSlice, startLine);

    panel.postMessage({
      type: "drillDownComplete",
      payload: { segmentId, children: result.segments },
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    panel.postMessage({ type: "error", payload: { message: msg } });
  }
}

export function registerExplainCommand(
  context: vscode.ExtensionContext
): vscode.Disposable {
  return vscode.commands.registerCommand("narrator.explain", async () => {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      vscode.window.showWarningMessage("Narrator: No active editor found.");
      return;
    }

    const codeCtx = extractCodeContext(editor);
    if (!codeCtx) {
      vscode.window.showWarningMessage("Narrator: No code selected or visible.");
      return;
    }

    lastDocumentUri = editor.document.uri;

    const config = getConfig();
    const depth: DepthLevel = config.defaultDepth;
    conversation.reset(codeCtx, depth);

    const panel = NarratorPanel.createOrShow(context.extensionUri);

    // Send code context to webview
    panel.postMessage({
      type: "codeContext",
      payload: {
        code: codeCtx.selectedText,
        language: codeCtx.language,
        fileName: codeCtx.fileName,
        startLine: codeCtx.startLine,
        endLine: codeCtx.endLine,
      },
    });

    // Handle messages from webview
    const messageDisposable = setupMessageHandler(
      panel,
      async (message: WebviewMessage) => {
        switch (message.type) {
          case "segmentStarted": {
            const { startLine, endLine } = message.payload;
            if (lastDocumentUri) {
              const doc = await vscode.workspace.openTextDocument(lastDocumentUri);
              const editor = await vscode.window.showTextDocument(doc, vscode.ViewColumn.One, true);
              highlight(editor, startLine, endLine);
            }
            break;
          }
          case "segmentEnded":
          case "playbackStopped": {
            const currentEditor = vscode.window.activeTextEditor;
            if (currentEditor) {
              clear(currentEditor);
            }
            break;
          }
          case "followUp": {
            await handleFollowUp(panel, message.payload.question);
            break;
          }
          case "narrateSegment": {
            const tts = createTtsClient();
            if (tts) {
              try {
                const audio = await tts.synthesize(message.payload.text);
                panel.postMessage({
                  type: "audioData",
                  payload: {
                    segmentId: message.payload.segmentId,
                    narrationText: message.payload.text,
                    audioBase64: audio.audioBase64,
                    mimeType: audio.mimeType,
                  },
                });
              } catch (err: unknown) {
                console.error("TTS error for single segment:", err);
              }
            }
            break;
          }
          case "generateAllAudio": {
            const tts = createTtsClient();
            if (tts) {
              // Fire all TTS requests in parallel
              const promises = message.payload.segments.map(async (seg) => {
                try {
                  const audio = await tts.synthesize(seg.text);
                  panel.postMessage({
                    type: "audioData",
                    payload: {
                      segmentId: seg.segmentId,
                      narrationText: seg.text,
                      audioBase64: audio.audioBase64,
                      mimeType: audio.mimeType,
                    },
                  });
                } catch (err: unknown) {
                  console.error(`TTS error for segment ${seg.segmentId}:`, err);
                }
              });
              await Promise.all(promises);
            }
            break;
          }
          case "drillDown": {
            await handleDrillDown(
              panel,
              message.payload.segmentId,
              message.payload.startLine,
              message.payload.endLine,
              message.payload.parentNarration
            );
            break;
          }
        }
      }
    );

    context.subscriptions.push(messageDisposable);

    // Run initial LLM explanation
    let llmClient: LlmClient;
    let ttsClient: TtsClient | undefined;

    try {
      llmClient = createLlmClient();
      ttsClient = createTtsClient();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      panel.postMessage({ type: "error", payload: { message: msg } });
      return;
    }

    try {
      const result = await llmClient.explain(
        conversation.getSystemPrompt(),
        conversation.getInitialUserPrompt(),
        (chunk) => {
          panel.postMessage({
            type: "explanationChunk",
            payload: { text: chunk },
          });
        }
      );

      // Fix highlight ranges using source code matching
      result.segments = fixHighlightRanges(
        result.segments,
        codeCtx.selectedText,
        codeCtx.startLine
      );

      // Assign stable IDs to each segment
      const segmentsWithIds = result.segments.map((seg, i) => ({
        ...seg,
        id: `seg-${Date.now()}-${i}`,
      }));

      // Store assistant response in conversation
      const fullNarration = segmentsWithIds.map((s) => s.narration).join(" ");
      conversation.addAssistantMessage(fullNarration);

      panel.postMessage({
        type: "explanationComplete",
        payload: { segments: segmentsWithIds, summary: result.summary },
      });

      await sendTtsForSegments(panel, ttsClient, segmentsWithIds.map(s => ({ id: s.id, narration: s.narration })));
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      panel.postMessage({ type: "error", payload: { message: msg } });
    }
  });
}

async function handleFollowUp(panel: NarratorPanel, question: string) {
  let llmClient: LlmClient;
  let ttsClient: TtsClient | undefined;

  try {
    llmClient = createLlmClient();
    ttsClient = createTtsClient();
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    panel.postMessage({ type: "error", payload: { message: msg } });
    return;
  }

  try {
    const result = await conversation.askFollowUp(
      llmClient,
      question,
      (chunk) => {
        panel.postMessage({
          type: "explanationChunk",
          payload: { text: chunk },
        });
      }
    );

    // Fix highlight ranges if we have code context
    const codeCtx = conversation.getCodeContext();
    if (codeCtx) {
      result.segments = fixHighlightRanges(
        result.segments,
        codeCtx.selectedText,
        codeCtx.startLine
      );
    }

    // Assign stable IDs to each segment
    const segmentsWithIds = result.segments.map((seg, i) => ({
      ...seg,
      id: `seg-${Date.now()}-${i}`,
    }));

    panel.postMessage({
      type: "explanationComplete",
      payload: { segments: segmentsWithIds, summary: result.summary },
    });

    await sendTtsForSegments(panel, ttsClient, segmentsWithIds.map(s => ({ id: s.id, narration: s.narration })));
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    panel.postMessage({ type: "error", payload: { message: msg } });
  }
}
