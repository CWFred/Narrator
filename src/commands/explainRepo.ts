import * as vscode from "vscode";
import { NarratorPanel } from "../webview/panel";
import { setupMessageHandler, WebviewMessage } from "../webview/messageHandler";
import { highlight, clear } from "../highlighting/decorationEngine";
import { getConfig } from "../config/settings";
import { LlmClient, ExplanationResult } from "../llm/llmClient";
import { ClaudeClient } from "../llm/claudeClient";
import { LocalLlmClient } from "../llm/ollamaClient";
import { TtsClient } from "../tts/ttsClient";
import { ElevenLabsClient } from "../tts/elevenLabsClient";
import { KokoroClient } from "../tts/kokoroClient";
import { fixHighlightRanges } from "../highlighting/highlightFixer";
import { buildDrillDownPrompt } from "../context/promptBuilder";

function createLlmClient(): LlmClient {
  const config = getConfig();
  if (config.llmProvider === "claude") {
    if (!config.claudeApiKey) {
      throw new Error("Claude API key not set. Configure it in Settings → Narrator.");
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
      throw new Error("ElevenLabs API key not set. Configure it in Settings → Narrator.");
    }
    return new ElevenLabsClient(config.elevenLabsApiKey, config.voiceId);
  }
  return new KokoroClient(config.kokoroUrl, config.kokoroVoice);
}

const IGNORE_PATTERNS = [
  "**/node_modules/**",
  "**/.git/**",
  "**/dist/**",
  "**/out/**",
  "**/build/**",
  "**/*.min.*",
  "**/package-lock.json",
  "**/*.map",
  "**/.DS_Store",
];

const CODE_EXTENSIONS = [
  "ts", "tsx", "js", "jsx", "py", "rs", "go", "java", "c", "cpp", "h",
  "cs", "rb", "php", "swift", "kt", "scala", "zig", "lua", "sh", "bash",
  "sql", "graphql", "proto", "yaml", "yml", "toml", "json",
];

async function discoverFiles(rootUri: vscode.Uri): Promise<vscode.Uri[]> {
  const pattern = `**/*.{${CODE_EXTENSIONS.join(",")}}`;
  const exclude = `{${IGNORE_PATTERNS.join(",")}}`;
  const files = await vscode.workspace.findFiles(
    new vscode.RelativePattern(rootUri, pattern),
    new vscode.RelativePattern(rootUri, exclude),
    500
  );

  return files.sort((a, b) => {
    const aName = a.path.split("/").pop() || "";
    const bName = b.path.split("/").pop() || "";
    const entryPoints = [
      "index", "main", "app", "extension", "mod", "lib", "server", "entry",
    ];
    const aIsEntry = entryPoints.some((e) => aName.toLowerCase().startsWith(e));
    const bIsEntry = entryPoints.some((e) => bName.toLowerCase().startsWith(e));
    if (aIsEntry && !bIsEntry) return -1;
    if (!aIsEntry && bIsEntry) return 1;
    return a.path.localeCompare(b.path);
  });
}

function addLineNumbers(text: string): string {
  return text
    .split("\n")
    .map((line, i) => `  ${i + 1} | ${line}`)
    .join("\n");
}

async function readFileIfExists(rootUri: vscode.Uri, filename: string): Promise<string | undefined> {
  try {
    const uri = vscode.Uri.joinPath(rootUri, filename);
    const doc = await vscode.workspace.openTextDocument(uri);
    return doc.getText();
  } catch {
    return undefined;
  }
}

function buildFileTree(filePaths: string[]): string {
  return filePaths.map((f) => `  ${f}`).join("\n");
}

const FILE_SELECTION_PROMPT = `You are a senior engineer helping someone understand a new codebase.
Given the project metadata and file tree, identify the ~12-15 most important files for understanding
how this codebase works. Focus on:

- Entry points and main application files
- Core business logic and domain models
- Key architectural files (routing, middleware, data layer)
- Files that tie the system together

Skip:
- Config files, lock files, build scripts
- Test files (unless they're the only documentation of behavior)
- Pure type definition files (unless they define core domain types)
- Boilerplate, generated code, vendor files

You MUST respond with valid JSON in exactly this format:
{
  "candidates": [
    "path/to/file1.ts",
    "path/to/file2.ts"
  ],
  "reasoning": "Brief explanation of why these files matter"
}

Do NOT include markdown, code fences, or any text outside the JSON.`;

const FILE_CURATION_PROMPT = `You are a senior engineer designing an onboarding tour of a codebase.
You've read the contents of candidate files. Now pick the 5-8 files that are ESSENTIAL to
understanding this project, and order them in the sequence someone should read them.

The order should follow the data/control flow:
1. Start at the entry point
2. Follow the main code path
3. Show the key abstractions and patterns
4. End with supporting infrastructure only if it's architecturally important

You MUST respond with valid JSON in exactly this format:
{
  "tour": [
    {
      "path": "path/to/file.ts",
      "why": "One sentence explaining why this file matters and what to focus on"
    }
  ]
}

Do NOT include markdown, code fences, or any text outside the JSON.`;

interface TourFile {
  path: string;
  why: string;
  uri: vscode.Uri;
}

async function curateTourFiles(
  llmClient: LlmClient,
  workspaceFolder: vscode.WorkspaceFolder,
  allFiles: vscode.Uri[],
  readme: string | undefined,
  projectMeta: string
): Promise<TourFile[]> {
  const allPaths = allFiles.map((f) => vscode.workspace.asRelativePath(f));
  const fileTree = buildFileTree(allPaths);

  // Pass 1: LLM picks ~15 candidate files from the file tree
  const pass1Prompt = `Project: ${workspaceFolder.name}

Files in this project:
${fileTree}
${readme ? `\nREADME.md:\n${readme}\n` : ""}${projectMeta}
Which files are most important for understanding this codebase?`;

  const pass1Result = await llmClient.explain(FILE_SELECTION_PROMPT, pass1Prompt, () => {});
  const pass1Text = pass1Result.segments.map((s) => s.narration).join("");

  let candidates: string[];
  try {
    // The LLM might return the JSON as narration or as the raw response
    const parsed = JSON.parse(pass1Text);
    candidates = parsed.candidates || [];
  } catch {
    // Try to parse from the summary or raw text
    try {
      const parsed = JSON.parse(pass1Result.summary || "{}");
      candidates = parsed.candidates || [];
    } catch {
      // Fallback: use all paths if LLM can't curate
      candidates = allPaths.slice(0, 15);
    }
  }

  // Read the full contents of candidate files
  const candidateContents: Array<{ path: string; content: string; uri: vscode.Uri }> = [];
  for (const candidatePath of candidates) {
    const matchingFile = allFiles.find(
      (f) => vscode.workspace.asRelativePath(f) === candidatePath
    );
    if (!matchingFile) continue;
    try {
      const doc = await vscode.workspace.openTextDocument(matchingFile);
      const text = doc.getText();
      if (text.trim() && text.length <= 50000) {
        candidateContents.push({ path: candidatePath, content: text, uri: matchingFile });
      }
    } catch {
      // Skip unreadable files
    }
  }

  if (candidateContents.length === 0) {
    // Fallback: just use first 8 files
    return allFiles.slice(0, 8).map((f) => ({
      path: vscode.workspace.asRelativePath(f),
      why: "",
      uri: f,
    }));
  }

  // Pass 2: LLM reads full contents and picks the essential 5-8 in order
  const fileSummaries = candidateContents
    .map((f) => {
      // Send first 100 lines to keep context manageable
      const lines = f.content.split("\n");
      const preview = lines.slice(0, 100).join("\n");
      const truncated = lines.length > 100 ? `\n  ... (${lines.length - 100} more lines)` : "";
      return `--- ${f.path} (${lines.length} lines) ---\n${preview}${truncated}`;
    })
    .join("\n\n");

  const pass2Prompt = `Project: ${workspaceFolder.name}
${readme ? `\nREADME.md:\n${readme}\n` : ""}
Here are the candidate files with their contents:

${fileSummaries}

Pick the 5-8 essential files and order them for an onboarding tour.`;

  const pass2Result = await llmClient.explain(FILE_CURATION_PROMPT, pass2Prompt, () => {});
  const pass2Text = pass2Result.segments.map((s) => s.narration).join("");

  let tour: Array<{ path: string; why: string }>;
  try {
    const parsed = JSON.parse(pass2Text);
    tour = parsed.tour || [];
  } catch {
    try {
      const parsed = JSON.parse(pass2Result.summary || "{}");
      tour = parsed.tour || [];
    } catch {
      // Fallback: use candidates in order
      tour = candidateContents.slice(0, 8).map((f) => ({ path: f.path, why: "" }));
    }
  }

  // Resolve URIs
  return tour
    .map((t) => {
      const match = candidateContents.find((f) => f.path === t.path);
      if (!match) return null;
      return { path: t.path, why: t.why, uri: match.uri };
    })
    .filter((t): t is TourFile => t !== null);
}

// --- Prompts ---

const OVERVIEW_SYSTEM_PROMPT = `You are a senior engineer giving a high-level overview of a codebase to someone who has never seen it before.

Explain:
- What this project IS (its purpose, what problem it solves)
- The overall architecture and how the pieces fit together
- The tech stack and key dependencies
- The main entry points and data flow
- Anything surprising or notable about the design

This is a spoken narration — be conversational, clear, and engaging. Imagine you're onboarding a new hire on their first day.

You MUST respond with valid JSON in exactly this format:
{
  "segments": [
    {
      "narration": "Plain English explanation.",
      "highlight_lines": [],
      "highlight_range": { "start": 0, "end": 0 }
    }
  ],
  "summary": "One-sentence summary of the project."
}

Rules:
- Use 4-8 segments for a thorough overview.
- Since this is a project overview (no specific file open), set highlight_lines to [] and highlight_range to { "start": 0, "end": 0 }.
- Each segment's narration should be 2-4 sentences, suitable for reading aloud.
- Do NOT include markdown, code fences, or any text outside the JSON.`;

const REPO_FILE_PROMPT = `You are a senior engineer giving a guided tour of a codebase to a new team member.
For each file, explain its purpose, key components, and how it fits into the larger project.
Keep explanations concise and conversational — this is a narrated walkthrough, not documentation.

You MUST respond with valid JSON in exactly this format:
{
  "segments": [
    {
      "narration": "Plain English explanation for this section.",
      "highlight_lines": [1, 2, 3],
      "highlight_range": { "start": 1, "end": 3 }
    }
  ],
  "summary": "One-sentence summary of the entire file."
}

CRITICAL rules for highlight_lines and highlight_range:
- Each line of code is numbered (e.g., "  14 |   const x = 1"). Use EXACTLY those line numbers.
- highlight_range.start and highlight_range.end must EXACTLY match the first and last line your narration describes. No overlap with other segments.
- Segments must cover consecutive, non-overlapping line ranges.
- highlight_lines must list every line number in the range.
- Each segment's narration should be 1-3 sentences, suitable for reading aloud.
- Do NOT include markdown, code fences, or any text outside the JSON.`;

// --- Helpers ---

async function synthesizeAndSend(
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

// --- Command ---

export function registerExplainRepoCommand(
  context: vscode.ExtensionContext
): vscode.Disposable {
  return vscode.commands.registerCommand("narrator.explainRepo", async () => {
    let currentDocUri: vscode.Uri | undefined;

    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
      vscode.window.showWarningMessage("Narrator: No workspace folder open.");
      return;
    }

    const files = await discoverFiles(workspaceFolder.uri);
    if (files.length === 0) {
      vscode.window.showWarningMessage("Narrator: No code files found in workspace.");
      return;
    }

    let llmClient: LlmClient;
    let ttsClient: TtsClient | undefined;
    try {
      llmClient = createLlmClient();
      ttsClient = createTtsClient();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      vscode.window.showErrorMessage(`Narrator: ${msg}`);
      return;
    }

    const panel = NarratorPanel.createOrShow(context.extensionUri);

    // Gather project metadata
    const readme = await readFileIfExists(workspaceFolder.uri, "README.md");
    const packageJson = await readFileIfExists(workspaceFolder.uri, "package.json");
    const cargoToml = await readFileIfExists(workspaceFolder.uri, "Cargo.toml");
    const pyprojectToml = await readFileIfExists(workspaceFolder.uri, "pyproject.toml");
    const goMod = await readFileIfExists(workspaceFolder.uri, "go.mod");

    let projectMeta = "";
    if (packageJson) projectMeta += `\npackage.json:\n${packageJson}\n`;
    if (cargoToml) projectMeta += `\nCargo.toml:\n${cargoToml}\n`;
    if (pyprojectToml) projectMeta += `\npyproject.toml:\n${pyprojectToml}\n`;
    if (goMod) projectMeta += `\ngo.mod:\n${goMod}\n`;

    // Show status while curating
    panel.postMessage({
      type: "codeContext",
      payload: {
        code: "",
        language: "",
        fileName: `${workspaceFolder.name} — Analyzing codebase...`,
        startLine: 0,
        endLine: 0,
      },
    });

    // Two-pass LLM curation: pick the essential files
    let tourFiles: TourFile[];
    try {
      tourFiles = await curateTourFiles(llmClient, workspaceFolder, files, readme, projectMeta);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      panel.postMessage({ type: "error", payload: { message: `Failed to curate tour: ${msg}` } });
      return;
    }

    if (tourFiles.length === 0) {
      panel.postMessage({ type: "error", payload: { message: "No key files identified." } });
      return;
    }

    // Let user confirm/modify the curated selection
    const tourItems = tourFiles.map((f) => ({
      label: f.path,
      description: f.why,
      picked: true,
    }));

    const confirmed = await vscode.window.showQuickPick(tourItems, {
      canPickMany: true,
      title: `Narrator: Curated Tour (${tourFiles.length} key files)`,
      placeHolder: "These are the key files — deselect any you want to skip",
    });

    if (!confirmed || confirmed.length === 0) return;

    const selected = confirmed.map((c) => {
      const match = tourFiles.find((f) => f.path === c.label)!;
      return { label: match.path, uri: match.uri, why: match.why };
    });

    const messageDisposable = setupMessageHandler(
      panel,
      async (message: WebviewMessage) => {
        switch (message.type) {
          case "segmentStarted": {
            const { startLine, endLine } = message.payload;
            if (currentDocUri) {
              const doc = await vscode.workspace.openTextDocument(currentDocUri);
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
            const { segmentId, startLine, endLine, parentNarration } = message.payload;
            let drillDoc: vscode.TextDocument;
            if (currentDocUri) {
              drillDoc = await vscode.workspace.openTextDocument(currentDocUri);
            } else {
              const editor = vscode.window.activeTextEditor;
              if (!editor) break;
              drillDoc = editor.document;
            }
            const doc = drillDoc;
            const range = new vscode.Range(startLine - 1, 0, endLine, 0);
            const codeSlice = doc.getText(range);
            const numberedCode = codeSlice.split("\n").map((line: string, i: number) => `  ${startLine + i} | ${line}`).join("\n");

            try {
              const llm = createLlmClient();
              const { system } = buildDrillDownPrompt(startLine, endLine, parentNarration);
              const result = await llm.explain(system, `Lines ${startLine}–${endLine}:\n\n${numberedCode}`, () => {});
              result.segments = fixHighlightRanges(result.segments, codeSlice, startLine);
              panel.postMessage({ type: "drillDownComplete", payload: { segmentId, children: result.segments } });
            } catch (err: unknown) {
              const msg = err instanceof Error ? err.message : String(err);
              panel.postMessage({ type: "error", payload: { message: msg } });
            }
            break;
          }
        }
      }
    );
    context.subscriptions.push(messageDisposable);

    // ========================================
    // Step 0: High-level project overview
    // ========================================

    const tourFileList = selected
      .map((f) => `  ${f.label}${f.why ? ` — ${f.why}` : ""}`)
      .join("\n");

    const overviewPrompt = `Project directory: ${workspaceFolder.name}

Key files selected for this tour:
${tourFileList}
${readme ? `\nREADME.md:\n${readme}\n` : ""}${projectMeta}
Give a high-level overview of this entire project. What is it? How is it structured? How do these key files connect?`;

    // Send a "Project Overview" context to the webview
    panel.postMessage({
      type: "codeContext",
      payload: {
        code: "",
        language: "",
        fileName: `${workspaceFolder.name} — Project Overview`,
        startLine: 0,
        endLine: 0,
      },
    });

    await new Promise((r) => setTimeout(r, 300));

    try {
      const overviewResult = await llmClient.explain(
        OVERVIEW_SYSTEM_PROMPT,
        overviewPrompt,
        (chunk) => {
          panel.postMessage({
            type: "explanationChunk",
            payload: { text: chunk },
          });
        }
      );

      const overviewSegmentsWithIds = overviewResult.segments.map((seg, i) => ({
        ...seg,
        id: `seg-${Date.now()}-${i}`,
      }));

      panel.postMessage({
        type: "explanationComplete",
        payload: { segments: overviewSegmentsWithIds, summary: overviewResult.summary },
      });

      await synthesizeAndSend(panel, ttsClient, overviewSegmentsWithIds.map(s => ({ id: s.id, narration: s.narration })));

      // Wait for user to proceed to first file
      const shouldStart = await new Promise<boolean>((resolve) => {
        panel.postMessage({
          type: "repoTourNext",
          payload: {
            currentFile: 0,
            totalFiles: selected.length,
            nextFile: selected[0].label,
          },
        });
        const listener = panel.webview.onDidReceiveMessage((msg) => {
          if (msg.type === "nextFile") {
            listener.dispose();
            resolve(true);
          } else if (msg.type === "stopTour") {
            listener.dispose();
            resolve(false);
          }
        });
      });

      if (!shouldStart) {
        vscode.window.showInformationMessage("Narrator: Tour ended.");
        return;
      }

      // Capture overview for context in file explanations
      var projectSummary = overviewResult.summary ||
        overviewResult.segments.map((s) => s.narration).join(" ");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      panel.postMessage({ type: "error", payload: { message: msg } });
      return;
    }

    // ========================================
    // Step 1+: File-by-file walkthrough
    // ========================================

    const fileSummaries: string[] = [];

    let fileIdx = 0;
    while (fileIdx < selected.length) {
      const fileItem = selected[fileIdx];
      const doc = await vscode.workspace.openTextDocument(fileItem.uri);
      const fileText = doc.getText();

      if (!fileText.trim() || fileText.length > 50000) {
        fileIdx++;
        continue;
      }

      await vscode.window.showTextDocument(doc, vscode.ViewColumn.One);
      currentDocUri = doc.uri;

      const relativePath = fileItem.label;
      const language = doc.languageId;
      const numberedCode = addLineNumbers(fileText);

      panel.postMessage({
        type: "codeContext",
        payload: {
          code: fileText,
          language,
          fileName: relativePath.split("/").pop() || relativePath,
          startLine: 1,
          endLine: doc.lineCount,
        },
      });

      await new Promise((r) => setTimeout(r, 300));

      const previousContext = fileSummaries
        .slice(0, fileIdx)
        .map((s) => `  - ${s}`)
        .join("\n");

      const whyThisFile = fileItem.why ? `\nWhy this file matters: ${fileItem.why}\n` : "";

      const userPrompt = `Project overview: ${projectSummary}
${previousContext ? `\nFiles already covered:\n${previousContext}\n` : ""}${whyThisFile}
File: ${relativePath}
Language: ${language}
${doc.lineCount} lines:

${numberedCode}`;

      try {
        const result = await llmClient.explain(
          REPO_FILE_PROMPT,
          userPrompt,
          (chunk) => {
            panel.postMessage({
              type: "explanationChunk",
              payload: { text: chunk },
            });
          }
        );

        // Fix highlight ranges using source code matching
        result.segments = fixHighlightRanges(result.segments, fileText, 1);

        const segmentsWithIds = result.segments.map((seg, i) => ({
          ...seg,
          id: `seg-${Date.now()}-${i}`,
        }));

        panel.postMessage({
          type: "explanationComplete",
          payload: { segments: segmentsWithIds, summary: result.summary },
        });

        // Store summary for context in subsequent files
        const summary = result.summary || result.segments[0]?.narration || "";
        // Ensure fileSummaries[fileIdx] is set (not duplicated on revisit)
        fileSummaries[fileIdx] = `${relativePath}: ${summary}`;

        await synthesizeAndSend(panel, ttsClient, segmentsWithIds.map(s => ({ id: s.id, narration: s.narration })));

        // Wait for user before next file
        type NavAction = "next" | "prev" | "stop";
        const action = await new Promise<NavAction>((resolve) => {
          if (fileIdx === selected.length - 1) {
            resolve("next"); // Last file, auto-finish
            return;
          }
          panel.postMessage({
            type: "repoTourNext",
            payload: {
              currentFile: fileIdx + 1,
              totalFiles: selected.length,
              nextFile: selected[fileIdx + 1]?.label || "",
            },
          });
          const listener = panel.webview.onDidReceiveMessage((msg) => {
            if (msg.type === "nextFile") {
              listener.dispose();
              resolve("next");
            } else if (msg.type === "prevFile") {
              listener.dispose();
              resolve("prev");
            } else if (msg.type === "stopTour") {
              listener.dispose();
              resolve("stop");
            }
          });
        });

        if (action === "stop") break;
        if (action === "prev") {
          fileIdx = Math.max(0, fileIdx - 1);
        } else {
          fileIdx++;
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        panel.postMessage({ type: "error", payload: { message: msg } });
        break;
      }
    }

    vscode.window.showInformationMessage("Narrator: Repo tour complete.");
  });
}
