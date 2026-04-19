import * as vscode from "vscode";
import { NarratorPanel } from "../webview/panel";
import { setupMessageHandler, WebviewMessage } from "../webview/messageHandler";
import { highlight, clear } from "../highlighting/decorationEngine";
import { getConfig, DepthLevel } from "../config/settings";
import { LlmClient } from "../llm/llmClient";
import { ClaudeClient } from "../llm/claudeClient";
import { LocalLlmClient } from "../llm/ollamaClient";
import { TtsClient } from "../tts/ttsClient";
import { ElevenLabsClient } from "../tts/elevenLabsClient";
import { KokoroClient } from "../tts/kokoroClient";
import { MlxAudioClient } from "../tts/mlxAudioClient";
import { fixHighlightRanges } from "../highlighting/highlightFixer";
import { buildDrillDownPrompt } from "../context/promptBuilder";
import { buildImportGraph, formatGraphSummary, ImportGraph } from "../analysis/importParser";
import { extractExports } from "../analysis/exportExtractor";

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
  if (config.ttsProvider === "mlx-audio") {
    return new MlxAudioClient(config.mlxAudioUrl, config.mlxAudioModel, config.mlxAudioVoice);
  }
  return new KokoroClient(config.kokoroUrl, config.kokoroVoice);
}

const IGNORE_PATTERNS = [
  "**/node_modules/**", "**/.git/**", "**/dist/**", "**/out/**", "**/build/**",
  "**/*.min.*", "**/package-lock.json", "**/*.map", "**/.DS_Store",
];

const CODE_EXTENSIONS = [
  "ts", "tsx", "js", "jsx", "py", "rs", "go", "java", "c", "cpp", "h",
  "cs", "rb", "php", "swift", "kt", "sql",
];

const ENTRY_POINT_NAMES = [
  "index", "main", "app", "extension", "mod", "lib", "server", "entry",
];

async function discoverFiles(rootUri: vscode.Uri): Promise<vscode.Uri[]> {
  const pattern = `**/*.{${CODE_EXTENSIONS.join(",")}}`;
  const exclude = `{${IGNORE_PATTERNS.join(",")}}`;
  return vscode.workspace.findFiles(
    new vscode.RelativePattern(rootUri, pattern),
    new vscode.RelativePattern(rootUri, exclude),
    500
  );
}

function addLineNumbers(text: string): string {
  return text.split("\n").map((line, i) => `  ${i + 1} | ${line}`).join("\n");
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

function extractJsonObject(text: string): Record<string, unknown> | null {
  let s = text.trim();
  if (!s) return null;
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) s = fence[1].trim();
  try {
    const parsed = JSON.parse(s);
    return typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : null;
  } catch { /* fall through */ }
  const start = s.indexOf("{");
  const end = s.lastIndexOf("}");
  if (start >= 0 && end > start) {
    try {
      const parsed = JSON.parse(s.slice(start, end + 1));
      return typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : null;
    } catch { /* fall through */ }
  }
  return null;
}

function getDepthConfig(depth: DepthLevel) {
  switch (depth) {
    case "overview": return { candidateCount: 8, tourSize: "3-5", segmentRange: "3-5", sentenceRange: "1-2" };
    case "standard": return { candidateCount: 15, tourSize: "5-8", segmentRange: "5-10", sentenceRange: "1-3" };
    case "deep": return { candidateCount: 25, tourSize: "8-12", segmentRange: "8-15", sentenceRange: "2-4" };
  }
}

function rankFilesByCentrality(
  files: vscode.Uri[],
  graph: ImportGraph,
  workspaceFolder: vscode.WorkspaceFolder
): vscode.Uri[] {
  return [...files].sort((a, b) => {
    const aPath = vscode.workspace.asRelativePath(a);
    const bPath = vscode.workspace.asRelativePath(b);
    const aCentrality = graph.centrality.get(aPath) || 0;
    const bCentrality = graph.centrality.get(bPath) || 0;

    // Entry points get a bonus
    const aName = aPath.split("/").pop()?.toLowerCase() || "";
    const bName = bPath.split("/").pop()?.toLowerCase() || "";
    const aIsEntry = ENTRY_POINT_NAMES.some((e) => aName.startsWith(e));
    const bIsEntry = ENTRY_POINT_NAMES.some((e) => bName.startsWith(e));
    const aScore = aCentrality + (aIsEntry ? 100 : 0);
    const bScore = bCentrality + (bIsEntry ? 100 : 0);

    return bScore - aScore;
  });
}

function buildCurationPrompt(depth: DepthLevel): string {
  const config = getDepthConfig(depth);
  return `You are a senior engineer designing an onboarding tour of a codebase.
You have the dependency graph, project metadata, and full file contents of the top candidates.
Pick the ${config.tourSize} files that are ESSENTIAL to understanding this project, and order them
in the sequence someone should read them.

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
      "why": "One sentence explaining why this file matters"
    }
  ]
}

Do NOT include markdown, code fences, or any text outside the JSON.`;
}

function buildFileExplanationPrompt(depth: DepthLevel): string {
  const config = getDepthConfig(depth);
  const depthGuidance = depth === "deep"
    ? "\n- Cover edge cases, error handling, and design decisions.\n- Explain WHY the code is structured this way, not just what it does."
    : "";

  return `You are a senior engineer giving a guided tour of a codebase to a new team member.
Explain this file's purpose, key components, and how it fits into the larger project.
Keep explanations conversational — this is a narrated walkthrough.${depthGuidance}

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

CRITICAL rules:
- Use ${config.segmentRange} segments, ${config.sentenceRange} sentences each.
- Line numbers must EXACTLY match the numbered code provided.
- Segments must cover consecutive, non-overlapping line ranges.
- Do NOT include markdown, code fences, or any text outside the JSON.`;
}

function buildCrossFileContext(
  filePath: string,
  depth: DepthLevel,
  graph: ImportGraph,
  fileSummaries: Map<string, string>,
  fileContents: Map<string, string>,
  fileExports: Map<string, string[]>,
  tourPaths: string[]
): string {
  const parts: string[] = [];

  // Always: import graph relationships
  const graphSummary = formatGraphSummary(graph, filePath);
  if (graphSummary) parts.push(`Dependencies:\n${graphSummary}`);

  // Always: summaries of previously explained files
  const summaries: string[] = [];
  for (const [path, summary] of fileSummaries) {
    if (path !== filePath) summaries.push(`  - ${path}: ${summary}`);
  }
  if (summaries.length > 0) parts.push(`Files already covered:\n${summaries.join("\n")}`);

  // Standard + Deep: exported signatures from connected files
  if (depth === "standard" || depth === "deep") {
    const connected = [
      ...(graph.imports.get(filePath) || []),
      ...(graph.importedBy.get(filePath) || []),
    ];
    const exportSections: string[] = [];
    for (const connPath of connected) {
      const exports = fileExports.get(connPath);
      if (exports && exports.length > 0) {
        exportSections.push(`${connPath} exports:\n  ${exports.join("\n  ")}`);
      }
    }
    if (exportSections.length > 0) {
      parts.push(`Connected file signatures:\n${exportSections.join("\n")}`);
    }
  }

  // Deep only: full contents of connected files that are also in the tour
  if (depth === "deep") {
    const connected = [
      ...(graph.imports.get(filePath) || []),
      ...(graph.importedBy.get(filePath) || []),
    ];
    for (const connPath of connected) {
      if (tourPaths.includes(connPath) && connPath !== filePath) {
        const content = fileContents.get(connPath);
        if (content && content.length < 30000) {
          parts.push(`Full source of ${connPath}:\n${content}`);
        }
      }
    }
  }

  return parts.join("\n\n");
}

async function sendTtsForSegments(
  panel: NarratorPanel,
  ttsClient: TtsClient | undefined,
  segments: Array<{ id: string; narration: string }>
) {
  if (!ttsClient) return;
  for (const seg of segments) {
    try {
      panel.postMessage({ type: "ttsStarted", payload: { segmentId: seg.id } });
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

// --- Prompts ---

const OVERVIEW_SYSTEM_PROMPT = `You are a senior engineer giving a high-level overview of a codebase to someone who has never seen it before.

Explain:
- What this project IS (its purpose, what problem it solves)
- The overall architecture and how the pieces fit together
- The tech stack and key dependencies
- The main entry points and data flow
- Anything surprising or notable about the design

This is a spoken narration — be conversational, clear, and engaging.

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
- Use 4-8 segments, 2-4 sentences each.
- Set highlight_lines to [] and highlight_range to { "start": 0, "end": 0 }.
- Do NOT include markdown, code fences, or any text outside the JSON.`;

// --- Command ---

interface TourState {
  tourPaths: string[];
  tourWhys: Map<string, string>;
  tourUris: Map<string, vscode.Uri>;
  depth: DepthLevel;
  graph: ImportGraph;
  fileContents: Map<string, string>;
  fileExports: Map<string, string[]>;
  fileSummaries: Map<string, string>;
  projectSummary: string;
}

export function registerExplainRepoCommand(
  context: vscode.ExtensionContext
): vscode.Disposable {
  return vscode.commands.registerCommand("narrator.explainRepo", async () => {
    let currentDocUri: vscode.Uri | undefined;
    let tourState: TourState | undefined;

    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
      vscode.window.showWarningMessage("Narrator: No workspace folder open.");
      return;
    }

    const panel = NarratorPanel.createOrShow(context.extensionUri);

    // Send empty context to trigger depth cards in webview
    panel.postMessage({
      type: "codeContext",
      payload: { code: "", language: "", fileName: workspaceFolder.name, startLine: 0, endLine: 0 },
    });

    async function explainFile(panel: NarratorPanel, filePath: string) {
      if (!tourState) return;
      const uri = tourState.tourUris.get(filePath);
      if (!uri) return;

      const doc = await vscode.workspace.openTextDocument(uri);
      const fileText = doc.getText();
      if (!fileText.trim() || fileText.length > 50000) return;

      await vscode.window.showTextDocument(doc, vscode.ViewColumn.One);
      currentDocUri = doc.uri;

      panel.postMessage({ type: "tourFileStarted", payload: { path: filePath } });
      panel.postMessage({
        type: "codeContext",
        payload: {
          code: fileText,
          language: doc.languageId,
          fileName: filePath.split("/").pop() || filePath,
          startLine: 1,
          endLine: doc.lineCount,
        },
      });

      const crossFileContext = buildCrossFileContext(
        filePath, tourState.depth, tourState.graph,
        tourState.fileSummaries, tourState.fileContents,
        tourState.fileExports, tourState.tourPaths
      );

      const why = tourState.tourWhys.get(filePath);
      const numberedCode = addLineNumbers(fileText);
      const userPrompt = `Project overview: ${tourState.projectSummary}

${crossFileContext}
${why ? `\nWhy this file matters: ${why}\n` : ""}
File: ${filePath}
Language: ${doc.languageId}
${doc.lineCount} lines:

${numberedCode}`;

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
          buildFileExplanationPrompt(tourState.depth),
          userPrompt,
          (chunk) => {
            panel.postMessage({ type: "explanationChunk", payload: { text: chunk } });
          }
        );

        result.segments = fixHighlightRanges(result.segments, fileText, 1);

        const segmentsWithIds = result.segments.map((seg, i) => ({
          ...seg, id: `seg-${Date.now()}-${i}`,
        }));

        panel.postMessage({
          type: "explanationComplete",
          payload: { segments: segmentsWithIds, summary: result.summary },
        });

        const summary = result.summary || result.segments[0]?.narration || "";
        tourState.fileSummaries.set(filePath, summary);

        await sendTtsForSegments(panel, ttsClient, segmentsWithIds.map(s => ({ id: s.id, narration: s.narration })));
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        panel.postMessage({ type: "error", payload: { message: msg } });
      }
    }

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
            if (currentEditor) clear(currentEditor);
            break;
          }
          case "narrateSegment": {
            const tts = createTtsClient();
            if (tts) {
              try {
                panel.postMessage({ type: "ttsStarted", payload: { segmentId: message.payload.segmentId } });
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
          case "startAudioGeneration": {
            const tts = createTtsClient();
            if (tts) {
              const segments = message.payload.segments.map((s) => ({ id: s.segmentId, narration: s.text }));
              await sendTtsForSegments(panel, tts, segments);
            }
            break;
          }
          case "drillDown": {
            const { segmentId, startLine, endLine, parentNarration } = message.payload;
            if (!currentDocUri) break;
            const doc = await vscode.workspace.openTextDocument(currentDocUri);
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
          case "requestRepoTour": {
            const depth = message.payload.depth as DepthLevel;
            const depthConfig = getDepthConfig(depth);

            try {
              // Phase 1: Discover files
              panel.postMessage({ type: "tourProgress", payload: { phase: "Discovering files..." } });
              const files = await discoverFiles(workspaceFolder.uri);
              if (files.length === 0) {
                panel.postMessage({ type: "error", payload: { message: "No code files found." } });
                return;
              }

              // Phase 2: Analyze dependencies
              panel.postMessage({ type: "tourProgress", payload: { phase: `Analyzing dependencies across ${files.length} files...` } });
              const graph = await buildImportGraph(files, workspaceFolder);

              // Phase 3: Read key files
              panel.postMessage({ type: "tourProgress", payload: { phase: "Reading key files..." } });
              const ranked = rankFilesByCentrality(files, graph, workspaceFolder);
              const candidates = ranked.slice(0, depthConfig.candidateCount);

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

              // Read full contents and extract exports
              const fileContents = new Map<string, string>();
              const fileExports = new Map<string, string[]>();
              for (const file of candidates) {
                const path = vscode.workspace.asRelativePath(file);
                try {
                  const doc = await vscode.workspace.openTextDocument(file);
                  const text = doc.getText();
                  if (text.trim() && text.length <= 50000) {
                    fileContents.set(path, text);
                    fileExports.set(path, extractExports(text, path));
                  }
                } catch { /* skip */ }
              }

              // Phase 4: Build tour via LLM
              panel.postMessage({ type: "tourProgress", payload: { phase: "Building tour..." } });

              const allPaths = files.map((f) => vscode.workspace.asRelativePath(f));
              const graphSummaryLines: string[] = [];
              for (const [path, score] of graph.centrality) {
                if (score > 0) graphSummaryLines.push(`  ${path}: imported by ${score} files`);
              }
              graphSummaryLines.sort((a, b) => {
                const aNum = parseInt(a.split("imported by ")[1]) || 0;
                const bNum = parseInt(b.split("imported by ")[1]) || 0;
                return bNum - aNum;
              });

              const candidateSummaries = [...fileContents.entries()]
                .map(([path, content]) => `--- ${path} (${content.split("\n").length} lines) ---\n${content}`)
                .join("\n\n");

              const llmClient = createLlmClient();
              const curationPrompt = `Project: ${workspaceFolder.name}

File tree (${allPaths.length} files):
${allPaths.map((f) => `  ${f}`).join("\n")}

Dependency graph (most imported files):
${graphSummaryLines.slice(0, 30).join("\n")}
${readme ? `\nREADME.md:\n${readme}\n` : ""}${projectMeta}

Candidate file contents:

${candidateSummaries}

Pick the ${depthConfig.tourSize} essential files and order them for an onboarding tour.`;

              let curationRaw = "";
              const curationResult = await llmClient.explain(buildCurationPrompt(depth), curationPrompt, (chunk) => {
                curationRaw += chunk;
              });

              let tour: Array<{ path: string; why: string }> = [];
              const fromRaw = extractJsonObject(curationRaw);
              if (fromRaw && Array.isArray(fromRaw.tour)) {
                tour = fromRaw.tour as Array<{ path: string; why: string }>;
              } else {
                // parseExplanationJson may have wrapped the raw text as a narration
                const narrationText = curationResult.segments.map((s) => s.narration).join("");
                const fromNarration = extractJsonObject(narrationText);
                if (fromNarration && Array.isArray(fromNarration.tour)) {
                  tour = fromNarration.tour as Array<{ path: string; why: string }>;
                }
              }

              if (tour.length === 0) {
                console.warn("[Narrator] LLM curation returned no tour; falling back to top candidates. Raw response:", curationRaw);
                tour = [...fileContents.keys()].slice(0, 8).map((p) => ({ path: p, why: "" }));
              }

              // Match tour items against all discovered files (the LLM may pick paths
              // outside the candidates subset shown with full content)
              const resolvedTour: Array<{ path: string; why: string; uri: vscode.Uri }> = [];
              for (const t of tour) {
                if (!t || typeof t.path !== "string") continue;
                const match = files.find((f) => vscode.workspace.asRelativePath(f) === t.path);
                if (match) resolvedTour.push({ path: t.path, why: t.why || "", uri: match });
              }

              if (resolvedTour.length === 0) {
                panel.postMessage({ type: "error", payload: { message: "No valid tour files identified." } });
                return;
              }

              const validTour = resolvedTour;

              // Build tour state
              const tourUris = new Map<string, vscode.Uri>();
              for (const t of validTour) tourUris.set(t.path, t.uri);

              const tourWhys = new Map<string, string>();
              for (const t of validTour) tourWhys.set(t.path, t.why);

              tourState = {
                tourPaths: validTour.map((t) => t.path),
                tourWhys,
                tourUris,
                depth,
                graph,
                fileContents,
                fileExports,
                fileSummaries: new Map(),
                projectSummary: "",
              };

              // Send tour files to webview
              panel.postMessage({
                type: "tourFiles",
                payload: {
                  files: validTour.map((t) => ({ path: t.path, why: t.why })),
                  depth,
                },
              });

              // Project overview
              const tourFileList = validTour.map((f) => `  ${f.path}${f.why ? ` — ${f.why}` : ""}`).join("\n");
              const overviewPrompt = `Project: ${workspaceFolder.name}

Key files selected for this tour:
${tourFileList}

Dependency graph highlights:
${graphSummaryLines.slice(0, 15).join("\n")}
${readme ? `\nREADME.md:\n${readme}\n` : ""}${projectMeta}
Give a high-level overview of this project.`;

              panel.postMessage({
                type: "codeContext",
                payload: { code: "", language: "", fileName: `${workspaceFolder.name} — Project Overview`, startLine: 0, endLine: 0 },
              });

              const ttsClient = createTtsClient();
              const overviewResult = await llmClient.explain(OVERVIEW_SYSTEM_PROMPT, overviewPrompt, (chunk) => {
                panel.postMessage({ type: "explanationChunk", payload: { text: chunk } });
              });

              const overviewSegments = overviewResult.segments.map((seg, i) => ({
                ...seg, id: `seg-${Date.now()}-${i}`,
              }));

              panel.postMessage({
                type: "explanationComplete",
                payload: { segments: overviewSegments, summary: overviewResult.summary },
              });

              tourState.projectSummary = overviewResult.summary || overviewResult.segments.map((s) => s.narration).join(" ");

              await sendTtsForSegments(panel, ttsClient, overviewSegments.map(s => ({ id: s.id, narration: s.narration })));

            } catch (err: unknown) {
              const msg = err instanceof Error ? err.message : String(err);
              panel.postMessage({ type: "error", payload: { message: msg } });
            }
            break;
          }
          case "tourJumpToFile": {
            if (tourState) {
              await explainFile(panel, message.payload.path);
            }
            break;
          }
        }
      }
    );

    context.subscriptions.push(messageDisposable);
  });
}
