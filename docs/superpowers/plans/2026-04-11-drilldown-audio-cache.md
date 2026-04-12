# Hierarchical Drill-Down with Audio Caching — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the flat segment list with a recursive tree UI where each segment can be expanded for deeper explanations, add per-session audio caching, fix the misclick bug with stable IDs, and scope follow-up questions to the current drill-down depth.

**Architecture:** The flat `Segment[]` becomes a `SegmentNode` tree with stable UUIDs, recursive rendering in Transcript.tsx, and a new `drillDown` message path from webview through the extension host to the LLM. Audio caching uses an in-memory `Map<string, AudioBuffer>` in the useAudio hook that persists across stop/reset but clears on panel dispose.

**Tech Stack:** React (webview), TypeScript (extension host), VS Code Extension API, existing LLM/TTS clients.

---

### File Map

| File | Action | Responsibility |
|------|--------|---------------|
| `webview-ui/src/types.ts` | Create | Shared `SegmentNode` interface + tree utilities |
| `webview-ui/src/hooks/useAudio.ts` | Rewrite | Add audio cache, switch from index to ID |
| `webview-ui/src/components/Transcript.tsx` | Rewrite | Recursive tree rendering with disclosure arrows |
| `webview-ui/src/App.tsx` | Major edit | Tree state, drill-down handler, scoped follow-ups |
| `webview-ui/src/components/PlaybackBar.tsx` | Minor edit | Use ID instead of index |
| `webview-ui/src/components/FollowUp.tsx` | Minor edit | Dynamic placeholder based on scope |
| `webview-ui/src/index.css` | Edit | Styles for tree nodes, arrows, indentation, loading |
| `src/webview/messageHandler.ts` | Edit | Add drillDown/drillDownComplete message types, switch to IDs |
| `src/commands/explain.ts` | Edit | Handle drillDown messages, generate IDs on segments |
| `src/commands/explainRepo.ts` | Edit | Handle drillDown messages, generate IDs on segments |
| `src/context/promptBuilder.ts` | Edit | Add drill-down prompt builder |

---

### Task 1: Create SegmentNode type and tree utilities

**Files:**
- Create: `webview-ui/src/types.ts`

- [ ] **Step 1: Create the shared types file**

```typescript
// webview-ui/src/types.ts

export interface SegmentNode {
  id: string;
  narration: string;
  highlight_lines: number[];
  highlight_range: { start: number; end: number };
  children?: SegmentNode[];
  isExpanded: boolean;
  isLoading: boolean;
}

let counter = 0;
export function generateId(): string {
  return `seg-${Date.now()}-${counter++}`;
}

export function findNodeById(
  tree: SegmentNode[],
  id: string
): SegmentNode | undefined {
  for (const node of tree) {
    if (node.id === id) return node;
    if (node.children) {
      const found = findNodeById(node.children, id);
      if (found) return found;
    }
  }
  return undefined;
}

export function updateNodeById(
  tree: SegmentNode[],
  id: string,
  updater: (node: SegmentNode) => SegmentNode
): SegmentNode[] {
  return tree.map((node) => {
    if (node.id === id) return updater(node);
    if (node.children) {
      return { ...node, children: updateNodeById(node.children, id, updater) };
    }
    return node;
  });
}

export function segmentsToNodes(
  segments: Array<{
    narration: string;
    highlight_lines: number[];
    highlight_range: { start: number; end: number };
  }>
): SegmentNode[] {
  return segments.map((seg) => ({
    id: generateId(),
    narration: seg.narration,
    highlight_lines: seg.highlight_lines,
    highlight_range: seg.highlight_range,
    isExpanded: false,
    isLoading: false,
  }));
}

export function isExpandable(node: SegmentNode): boolean {
  const range = node.highlight_range;
  if (!range || range.start <= 0 || range.end <= 0) return false;
  return range.end - range.start + 1 > 3;
}

export function flattenVisibleNodes(tree: SegmentNode[]): SegmentNode[] {
  const result: SegmentNode[] = [];
  for (const node of tree) {
    result.push(node);
    if (node.isExpanded && node.children) {
      result.push(...flattenVisibleNodes(node.children));
    }
  }
  return result;
}
```

- [ ] **Step 2: Verify it compiles**

Run: `cd webview-ui && npx tsc --noEmit 2>&1 | head -20`
Expected: No errors related to types.ts (other files may have errors until updated)

- [ ] **Step 3: Commit**

```bash
git add webview-ui/src/types.ts
git commit -m "feat: add SegmentNode tree types and utilities"
```

---

### Task 2: Rewrite useAudio with caching and ID-based tracking

**Files:**
- Rewrite: `webview-ui/src/hooks/useAudio.ts`

- [ ] **Step 1: Rewrite useAudio.ts**

```typescript
// webview-ui/src/hooks/useAudio.ts
import { useRef, useCallback, useState } from "react";

interface AudioQueueItem {
  segmentId: string;
  narrationText: string;
  audioBase64: string;
  mimeType: string;
}

function hashText(text: string): string {
  let hash = 0;
  for (let i = 0; i < text.length; i++) {
    const char = text.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash |= 0;
  }
  return String(hash);
}

export function useAudio(
  onSegmentStart: (segmentId: string) => void,
  onSegmentEnd: (segmentId: string) => void
) {
  const queueRef = useRef<AudioQueueItem[]>([]);
  const isPlayingRef = useRef(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentSegmentId, setCurrentSegmentId] = useState<string | null>(null);
  const [hasAudio, setHasAudio] = useState(false);
  const audioContextRef = useRef<AudioContext | null>(null);
  const currentSourceRef = useRef<AudioBufferSourceNode | null>(null);
  const stopRequestedRef = useRef(false);
  const audioCacheRef = useRef<Map<string, AudioBuffer>>(new Map());

  const decodeAudio = useCallback(async (
    ctx: AudioContext,
    audioBase64: string
  ): Promise<AudioBuffer> => {
    const binaryStr = atob(audioBase64);
    const bytes = new Uint8Array(binaryStr.length);
    for (let i = 0; i < binaryStr.length; i++) {
      bytes[i] = binaryStr.charCodeAt(i);
    }
    return ctx.decodeAudioData(bytes.buffer.slice(0));
  }, []);

  const playNext = useCallback(async () => {
    if (stopRequestedRef.current || queueRef.current.length === 0) {
      isPlayingRef.current = false;
      setIsPlaying(false);
      setCurrentSegmentId(null);
      return;
    }

    const ctx = audioContextRef.current;
    if (!ctx || ctx.state === "closed") return;

    isPlayingRef.current = true;
    setIsPlaying(true);

    const item = queueRef.current.shift()!;
    setCurrentSegmentId(item.segmentId);
    onSegmentStart(item.segmentId);

    try {
      if (ctx.state === "suspended") await ctx.resume();

      const cacheKey = hashText(item.narrationText);
      let audioBuffer = audioCacheRef.current.get(cacheKey);
      if (!audioBuffer) {
        audioBuffer = await decodeAudio(ctx, item.audioBase64);
        audioCacheRef.current.set(cacheKey, audioBuffer);
      }

      const source = ctx.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(ctx.destination);
      currentSourceRef.current = source;

      source.onended = () => {
        currentSourceRef.current = null;
        onSegmentEnd(item.segmentId);
        playNext();
      };

      source.start();
    } catch (err) {
      console.error("Audio playback error:", err);
      currentSourceRef.current = null;
      onSegmentEnd(item.segmentId);
      playNext();
    }
  }, [onSegmentStart, onSegmentEnd, decodeAudio]);

  const enqueue = useCallback(
    (item: AudioQueueItem) => {
      queueRef.current.push(item);
      setHasAudio(true);
      if (audioContextRef.current && audioContextRef.current.state === "running" && !isPlayingRef.current) {
        playNext();
      }
    },
    [playNext]
  );

  const getCachedBuffer = useCallback((narrationText: string): AudioBuffer | undefined => {
    return audioCacheRef.current.get(hashText(narrationText));
  }, []);

  const play = useCallback(async () => {
    stopRequestedRef.current = false;
    if (!audioContextRef.current || audioContextRef.current.state === "closed") {
      audioContextRef.current = new AudioContext();
    }
    if (audioContextRef.current.state === "suspended") {
      await audioContextRef.current.resume();
    }
    if (!isPlayingRef.current) {
      playNext();
    }
  }, [playNext]);

  const playCached = useCallback(async (segmentId: string, narrationText: string) => {
    stopRequestedRef.current = false;
    if (!audioContextRef.current || audioContextRef.current.state === "closed") {
      audioContextRef.current = new AudioContext();
    }
    const ctx = audioContextRef.current;
    if (ctx.state === "suspended") await ctx.resume();

    const cached = audioCacheRef.current.get(hashText(narrationText));
    if (!cached) return false;

    isPlayingRef.current = true;
    setIsPlaying(true);
    setCurrentSegmentId(segmentId);
    onSegmentStart(segmentId);

    const source = ctx.createBufferSource();
    source.buffer = cached;
    source.connect(ctx.destination);
    currentSourceRef.current = source;
    source.onended = () => {
      currentSourceRef.current = null;
      isPlayingRef.current = false;
      setIsPlaying(false);
      setCurrentSegmentId(null);
      onSegmentEnd(segmentId);
    };
    source.start();
    return true;
  }, [onSegmentStart, onSegmentEnd]);

  const stop = useCallback(() => {
    stopRequestedRef.current = true;
    queueRef.current = [];
    if (currentSourceRef.current) {
      try { currentSourceRef.current.stop(); } catch {}
      currentSourceRef.current = null;
    }
    if (audioContextRef.current && audioContextRef.current.state !== "closed") {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }
    isPlayingRef.current = false;
    setIsPlaying(false);
    setCurrentSegmentId(null);
    setHasAudio(false);
    // Note: audioCacheRef is NOT cleared on stop
  }, []);

  const reset = useCallback(() => {
    stopRequestedRef.current = false;
    setHasAudio(false);
  }, []);

  const clearCache = useCallback(() => {
    audioCacheRef.current.clear();
  }, []);

  return {
    enqueue, play, playCached, stop, reset, clearCache, getCachedBuffer,
    isPlaying, currentSegmentId, hasAudio,
  };
}
```

- [ ] **Step 2: Commit**

```bash
git add webview-ui/src/hooks/useAudio.ts
git commit -m "feat: rewrite useAudio with caching and ID-based tracking"
```

---

### Task 3: Update message types for ID-based communication

**Files:**
- Modify: `src/webview/messageHandler.ts`

- [ ] **Step 1: Update messageHandler.ts**

Replace the full contents of `src/webview/messageHandler.ts` with:

```typescript
import * as vscode from "vscode";
import { NarratorPanel } from "./panel";

export type ExtensionMessage =
  | { type: "codeContext"; payload: { code: string; language: string; fileName: string; startLine: number; endLine: number } }
  | { type: "explanationChunk"; payload: { text: string } }
  | { type: "explanationComplete"; payload: { segments: ExplanationSegment[]; summary: string } }
  | { type: "audioData"; payload: { segmentId: string; narrationText: string; audioBase64: string; mimeType: string } }
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
  | { type: "nextFile" }
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
```

- [ ] **Step 2: Commit**

```bash
git add src/webview/messageHandler.ts
git commit -m "feat: update message types for ID-based segments and drill-down"
```

---

### Task 4: Add drill-down prompt to promptBuilder

**Files:**
- Modify: `src/context/promptBuilder.ts`

- [ ] **Step 1: Add the drill-down prompt function**

Add to the end of `src/context/promptBuilder.ts`:

```typescript
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

  return { system, user: "" }; // user prompt is built by the caller with the actual code
}
```

- [ ] **Step 2: Commit**

```bash
git add src/context/promptBuilder.ts
git commit -m "feat: add drill-down prompt builder"
```

---

### Task 5: Add drill-down handler to explain.ts

**Files:**
- Modify: `src/commands/explain.ts`

- [ ] **Step 1: Add imports and drill-down handler**

Add import at the top of `src/commands/explain.ts`:

```typescript
import { buildDrillDownPrompt } from "../context/promptBuilder";
```

Add this function before `registerExplainCommand`:

```typescript
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
  const editor = vscode.window.activeTextEditor;
  if (!editor) return;

  const doc = editor.document;
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
```

- [ ] **Step 2: Add drillDown case to the message handler switch**

In the `setupMessageHandler` callback inside `registerExplainCommand`, add this case after the `narrateSegment` case:

```typescript
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
```

- [ ] **Step 3: Update sendTtsForSegments to use IDs**

Replace the `sendTtsForSegments` function:

```typescript
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
```

- [ ] **Step 4: Update the explain command to generate IDs and pass them**

In the `registerExplainCommand` function, after `fixHighlightRanges` and before `panel.postMessage({ type: "explanationComplete"`, add ID generation:

```typescript
      // Assign stable IDs to each segment
      const segmentsWithIds = result.segments.map((seg, i) => ({
        ...seg,
        id: `seg-${Date.now()}-${i}`,
      }));
```

Update the `explanationComplete` message to use `segmentsWithIds`:

```typescript
      panel.postMessage({
        type: "explanationComplete",
        payload: { segments: segmentsWithIds, summary: result.summary },
      });

      await sendTtsForSegments(panel, ttsClient, segmentsWithIds.map(s => ({ id: s.id, narration: s.narration })));
```

- [ ] **Step 5: Update narrateSegment handler to use segmentId**

Replace the `narrateSegment` case:

```typescript
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
```

- [ ] **Step 6: Commit**

```bash
git add src/commands/explain.ts src/context/promptBuilder.ts
git commit -m "feat: add drill-down handler and ID-based segments in explain command"
```

---

### Task 6: Update explainRepo.ts for IDs and drill-down

**Files:**
- Modify: `src/commands/explainRepo.ts`

- [ ] **Step 1: Add drill-down imports and handler**

Add import at the top:

```typescript
import { buildDrillDownPrompt } from "../context/promptBuilder";
```

Copy the same `handleDrillDown` function from explain.ts (or extract to a shared module — but for now, duplicate to keep the two commands self-contained).

Add the same `addLineNumbers` helper if not already present.

- [ ] **Step 2: Add drillDown case to message handler**

In the `setupMessageHandler` callback, add after `narrateSegment`:

```typescript
          case "drillDown": {
            const editor = vscode.window.activeTextEditor;
            if (!editor) break;
            const doc = editor.document;
            const { segmentId, startLine, endLine, parentNarration } = message.payload;
            const range = new vscode.Range(startLine - 1, 0, endLine, 0);
            const codeSlice = doc.getText(range);
            const numberedCode = codeSlice.split("\n").map((line, i) => `  ${startLine + i} | ${line}`).join("\n");

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
```

- [ ] **Step 3: Update sendTtsForSegments and explanationComplete to use IDs**

Same pattern as Task 5: generate IDs on segments before sending `explanationComplete`, update `synthesizeAndSend` to pass `segmentId` and `narrationText`.

- [ ] **Step 4: Commit**

```bash
git add src/commands/explainRepo.ts
git commit -m "feat: add drill-down and ID-based segments to explainRepo"
```

---

### Task 7: Rewrite Transcript.tsx as recursive tree

**Files:**
- Rewrite: `webview-ui/src/components/Transcript.tsx`

- [ ] **Step 1: Rewrite Transcript.tsx**

```tsx
// webview-ui/src/components/Transcript.tsx
import React, { useEffect, useRef } from "react";
import { SegmentNode, isExpandable } from "../types";

interface TranscriptProps {
  tree: SegmentNode[];
  activeSegmentId: string | null;
  streamingText: string;
  onSegmentPlay: (id: string) => void;
  onSegmentExpand: (id: string) => void;
}

function SegmentNodeView({
  node,
  depth,
  activeSegmentId,
  onSegmentPlay,
  onSegmentExpand,
}: {
  node: SegmentNode;
  depth: number;
  activeSegmentId: string | null;
  onSegmentPlay: (id: string) => void;
  onSegmentExpand: (id: string) => void;
}) {
  const isActive = node.id === activeSegmentId;
  const ref = useRef<HTMLDivElement>(null);
  const expandable = isExpandable(node);

  useEffect(() => {
    if (isActive) {
      ref.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  }, [isActive]);

  return (
    <div className="segment-tree-node" style={{ paddingLeft: depth * 16 }}>
      <div
        ref={ref}
        className={`segment-row ${isActive ? "active" : ""}`}
      >
        {expandable ? (
          <button
            className="segment-expand-btn"
            onClick={(e) => { e.stopPropagation(); onSegmentExpand(node.id); }}
            aria-label={node.isExpanded ? "Collapse" : "Expand"}
          >
            {node.isLoading ? (
              <span className="segment-spinner" />
            ) : node.isExpanded ? (
              <span className="segment-arrow expanded" />
            ) : (
              <span className="segment-arrow" />
            )}
          </button>
        ) : (
          <span className="segment-arrow-spacer" />
        )}
        <span
          className="segment-text"
          onClick={() => onSegmentPlay(node.id)}
        >
          {node.narration}
        </span>
      </div>
      {node.isExpanded && node.children && (
        <div className="segment-children">
          {node.children.map((child) => (
            <SegmentNodeView
              key={child.id}
              node={child}
              depth={depth + 1}
              activeSegmentId={activeSegmentId}
              onSegmentPlay={onSegmentPlay}
              onSegmentExpand={onSegmentExpand}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export function Transcript({
  tree,
  activeSegmentId,
  streamingText,
  onSegmentPlay,
  onSegmentExpand,
}: TranscriptProps) {
  return (
    <div className="transcript">
      <h3>Transcript</h3>
      {tree.map((node) => (
        <SegmentNodeView
          key={node.id}
          node={node}
          depth={0}
          activeSegmentId={activeSegmentId}
          onSegmentPlay={onSegmentPlay}
          onSegmentExpand={onSegmentExpand}
        />
      ))}
      {streamingText && (
        <div className="transcript-segment streaming">{streamingText}</div>
      )}
      {tree.length === 0 && !streamingText && (
        <div className="transcript-empty">
          Select code and press Ctrl+Shift+N to start.
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add webview-ui/src/components/Transcript.tsx
git commit -m "feat: rewrite Transcript as recursive tree with disclosure arrows"
```

---

### Task 8: Add tree node CSS styles

**Files:**
- Modify: `webview-ui/src/index.css`

- [ ] **Step 1: Add tree node styles**

Append to `webview-ui/src/index.css`:

```css
/* Segment tree nodes */
.segment-tree-node {
  display: flex;
  flex-direction: column;
}

.segment-row {
  display: flex;
  align-items: flex-start;
  gap: 4px;
  padding: 4px 6px;
  border-left: 3px solid transparent;
  border-radius: 0 3px 3px 0;
  transition: background 0.15s;
}

.segment-row:hover {
  background: var(--vscode-list-hoverBackground);
}

.segment-row.active {
  border-left-color: var(--vscode-focusBorder);
  background: var(--vscode-list-activeSelectionBackground);
  color: var(--vscode-list-activeSelectionForeground);
}

.segment-expand-btn {
  background: none;
  border: none;
  padding: 2px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  flex-shrink: 0;
  margin-top: 2px;
}

.segment-arrow {
  display: inline-block;
  width: 0;
  height: 0;
  border-left: 5px solid var(--vscode-foreground);
  border-top: 4px solid transparent;
  border-bottom: 4px solid transparent;
  transition: transform 0.15s;
}

.segment-arrow.expanded {
  transform: rotate(90deg);
}

.segment-arrow-spacer {
  width: 18px;
  flex-shrink: 0;
}

.segment-spinner {
  display: inline-block;
  width: 12px;
  height: 12px;
  border: 2px solid var(--vscode-foreground);
  border-top-color: transparent;
  border-radius: 50%;
  animation: spin 0.6s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.segment-text {
  cursor: pointer;
  font-size: 13px;
  line-height: 1.5;
  flex: 1;
}

.segment-children {
  display: flex;
  flex-direction: column;
}
```

- [ ] **Step 2: Remove old `.transcript-segment` styles that conflict**

Remove the old `.transcript-segment` rule (lines 200-206 in current CSS) and `.transcript-segment.active` rule (lines 208-212). The new `.segment-row` rules replace them.

- [ ] **Step 3: Commit**

```bash
git add webview-ui/src/index.css
git commit -m "feat: add tree node and disclosure arrow CSS styles"
```

---

### Task 9: Rewrite App.tsx for tree state and drill-down

**Files:**
- Rewrite: `webview-ui/src/App.tsx`
- Modify: `webview-ui/src/components/PlaybackBar.tsx`
- Modify: `webview-ui/src/components/FollowUp.tsx`

- [ ] **Step 1: Update FollowUp.tsx to accept placeholder prop**

```tsx
// webview-ui/src/components/FollowUp.tsx
import React, { useState } from "react";

interface FollowUpProps {
  onSubmit: (question: string) => void;
  disabled?: boolean;
  placeholder?: string;
}

export function FollowUp({ onSubmit, disabled, placeholder }: FollowUpProps) {
  const [question, setQuestion] = useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (question.trim()) {
      onSubmit(question.trim());
      setQuestion("");
    }
  };

  return (
    <form className="follow-up" onSubmit={handleSubmit}>
      <input
        type="text"
        value={question}
        onChange={(e) => setQuestion(e.target.value)}
        placeholder={placeholder || "Ask a follow-up..."}
        disabled={disabled}
      />
      <button type="submit" disabled={disabled || !question.trim()}>
        Ask
      </button>
    </form>
  );
}
```

- [ ] **Step 2: Update PlaybackBar.tsx to remove index dependency**

Replace `currentSegment: number` with `currentSegmentLabel: string` in props:

```tsx
// webview-ui/src/components/PlaybackBar.tsx
import React from "react";

interface PlaybackBarProps {
  isPlaying: boolean;
  hasAudio: boolean;
  onPlay: () => void;
  onStop: () => void;
}

export function PlaybackBar({
  isPlaying,
  hasAudio,
  onPlay,
  onStop,
}: PlaybackBarProps) {
  if (!hasAudio && !isPlaying) {
    return null;
  }

  return (
    <div className="playback-bar">
      <div className="playback-status">
        {isPlaying ? "Playing..." : hasAudio ? "Ready to play" : "Playback complete"}
      </div>
      <div className="playback-controls">
        {!isPlaying && hasAudio && (
          <button className="play-btn" onClick={onPlay}>
            Play All
          </button>
        )}
        {isPlaying && (
          <button onClick={onStop}>
            Stop
          </button>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Rewrite App.tsx**

```tsx
// webview-ui/src/App.tsx
import React, { useState, useEffect, useCallback } from "react";
import { useVsCode } from "./hooks/useVsCode";
import { useAudio } from "./hooks/useAudio";
import { DepthPicker } from "./components/DepthPicker";
import { Transcript } from "./components/Transcript";
import { PlaybackBar } from "./components/PlaybackBar";
import { FollowUp } from "./components/FollowUp";
import { StatusBar } from "./components/StatusBar";
import {
  SegmentNode,
  segmentsToNodes,
  findNodeById,
  updateNodeById,
} from "./types";

type Depth = "overview" | "standard" | "deep";
type Status = "idle" | "loading" | "streaming" | "playing" | "error";

interface CodeInfo {
  code: string;
  language: string;
  fileName: string;
  startLine: number;
  endLine: number;
}

interface TourInfo {
  currentFile: number;
  totalFiles: number;
  nextFile: string;
}

export default function App() {
  const vscode = useVsCode();
  const [depth, setDepth] = useState<Depth>("standard");
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string>();
  const [segmentTree, setSegmentTree] = useState<SegmentNode[]>([]);
  const [streamingText, setStreamingText] = useState("");
  const [codeInfo, setCodeInfo] = useState<CodeInfo | null>(null);
  const [tourInfo, setTourInfo] = useState<TourInfo | null>(null);
  const [expandedScope, setExpandedScope] = useState<{
    startLine: number;
    endLine: number;
    parentNarration: string;
  } | null>(null);

  const handleSegmentStart = useCallback(
    (segmentId: string) => {
      const node = findNodeById(segmentTree, segmentId);
      if (node && node.highlight_range.start > 0) {
        vscode.postMessage({
          type: "segmentStarted",
          payload: {
            segmentId,
            startLine: node.highlight_range.start,
            endLine: node.highlight_range.end,
          },
        });
      }
    },
    [segmentTree, vscode]
  );

  const handleSegmentEnd = useCallback(
    (segmentId: string) => {
      vscode.postMessage({
        type: "segmentEnded",
        payload: { segmentId },
      });
    },
    [vscode]
  );

  const audio = useAudio(handleSegmentStart, handleSegmentEnd);

  const handlePlay = useCallback(() => {
    audio.play();
  }, [audio]);

  const handleStop = useCallback(() => {
    audio.stop();
    vscode.postMessage({ type: "playbackStopped" });
  }, [audio, vscode]);

  const handleSegmentPlay = useCallback(
    async (segmentId: string) => {
      const node = findNodeById(segmentTree, segmentId);
      if (!node) return;

      audio.stop();
      audio.reset();

      // Highlight
      if (node.highlight_range.start > 0) {
        vscode.postMessage({
          type: "segmentStarted",
          payload: {
            segmentId,
            startLine: node.highlight_range.start,
            endLine: node.highlight_range.end,
          },
        });
      }

      // Try cache first (play() also inits AudioContext from this click gesture)
      const played = await audio.playCached(segmentId, node.narration);
      if (!played) {
        // Not cached — request TTS, init AudioContext for when it arrives
        audio.play();
        vscode.postMessage({
          type: "narrateSegment",
          payload: { segmentId, text: node.narration },
        });
      }
    },
    [segmentTree, vscode, audio]
  );

  const handleSegmentExpand = useCallback(
    (segmentId: string) => {
      const node = findNodeById(segmentTree, segmentId);
      if (!node) return;

      if (node.children) {
        // Toggle expand/collapse
        setSegmentTree((prev) =>
          updateNodeById(prev, segmentId, (n) => ({
            ...n,
            isExpanded: !n.isExpanded,
          }))
        );
        // Update follow-up scope
        if (!node.isExpanded) {
          setExpandedScope({
            startLine: node.highlight_range.start,
            endLine: node.highlight_range.end,
            parentNarration: node.narration,
          });
        } else {
          setExpandedScope(null);
        }
      } else {
        // First expand — request drill-down from LLM
        setSegmentTree((prev) =>
          updateNodeById(prev, segmentId, (n) => ({ ...n, isLoading: true }))
        );
        setExpandedScope({
          startLine: node.highlight_range.start,
          endLine: node.highlight_range.end,
          parentNarration: node.narration,
        });
        vscode.postMessage({
          type: "drillDown",
          payload: {
            segmentId,
            startLine: node.highlight_range.start,
            endLine: node.highlight_range.end,
            parentNarration: node.narration,
          },
        });
      }
    },
    [segmentTree, vscode]
  );

  const handleFollowUp = useCallback(
    (question: string) => {
      vscode.postMessage({
        type: "followUp",
        payload: {
          question,
          scopeStartLine: expandedScope?.startLine,
          scopeEndLine: expandedScope?.endLine,
          parentNarration: expandedScope?.parentNarration,
        },
      });
      setStatus("loading");
      setStreamingText("");
    },
    [vscode, expandedScope]
  );

  const handleStartOver = useCallback(() => {
    audio.stop();
    setSegmentTree([]);
    setStreamingText("");
    setTourInfo(null);
    setExpandedScope(null);
    setStatus("idle");
    setError(undefined);
    vscode.postMessage({ type: "startOver" });
  }, [audio, vscode]);

  const handleNextFile = useCallback(() => {
    setTourInfo(null);
    vscode.postMessage({ type: "nextFile" });
  }, [vscode]);

  const handleStopTour = useCallback(() => {
    setTourInfo(null);
    vscode.postMessage({ type: "stopTour" });
  }, [vscode]);

  useEffect(() => {
    const handler = (event: MessageEvent) => {
      const message = event.data;
      switch (message.type) {
        case "codeContext":
          setCodeInfo(message.payload);
          setSegmentTree([]);
          setStreamingText("");
          setTourInfo(null);
          setExpandedScope(null);
          setStatus("idle");
          setError(undefined);
          audio.reset();
          break;
        case "explanationChunk":
          setStatus("streaming");
          setStreamingText((prev) => prev + message.payload.text);
          break;
        case "explanationComplete":
          setSegmentTree(segmentsToNodes(message.payload.segments));
          setStreamingText("");
          setStatus("playing");
          break;
        case "audioData":
          audio.enqueue({
            segmentId: message.payload.segmentId,
            narrationText: message.payload.narrationText,
            audioBase64: message.payload.audioBase64,
            mimeType: message.payload.mimeType,
          });
          break;
        case "drillDownComplete": {
          const children = segmentsToNodes(message.payload.children);
          setSegmentTree((prev) =>
            updateNodeById(prev, message.payload.segmentId, (n) => ({
              ...n,
              children,
              isExpanded: true,
              isLoading: false,
            }))
          );
          break;
        }
        case "repoTourNext":
          setTourInfo(message.payload);
          break;
        case "error":
          setStatus("error");
          setError(message.payload.message);
          break;
      }
    };

    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, [audio]);

  const isBusy = status === "loading" || status === "streaming";

  const followUpPlaceholder = expandedScope
    ? `Ask about lines ${expandedScope.startLine}–${expandedScope.endLine}...`
    : "Ask a follow-up...";

  return (
    <div className="narrator-app">
      <header className="narrator-header">
        <h2>NARRATOR</h2>
        <DepthPicker value={depth} onChange={setDepth} disabled={isBusy} />
      </header>

      {codeInfo && (
        <div className="code-info">
          <span className="code-info-file">{codeInfo.fileName}</span>
          <span className="code-info-lines">
            L{codeInfo.startLine}–{codeInfo.endLine}
          </span>
          <span className="code-info-lang">{codeInfo.language}</span>
        </div>
      )}

      <StatusBar status={status} error={error} />

      <PlaybackBar
        isPlaying={audio.isPlaying}
        hasAudio={audio.hasAudio}
        onPlay={handlePlay}
        onStop={handleStop}
      />

      <div className="transcript-area">
        <Transcript
          tree={segmentTree}
          activeSegmentId={audio.currentSegmentId}
          streamingText={streamingText}
          onSegmentPlay={handleSegmentPlay}
          onSegmentExpand={handleSegmentExpand}
        />
      </div>

      {tourInfo && (
        <div className="tour-nav">
          <div className="tour-progress">
            File {tourInfo.currentFile} of {tourInfo.totalFiles}
          </div>
          <div className="tour-next-file">
            Next: {tourInfo.nextFile}
          </div>
          <div className="tour-buttons">
            <button className="tour-next-btn" onClick={handleNextFile}>
              Next File
            </button>
            <button className="tour-stop-btn" onClick={handleStopTour}>
              End Tour
            </button>
          </div>
        </div>
      )}

      <div className="bottom-controls">
        {(segmentTree.length > 0) && !tourInfo && (
          <button className="start-over-btn" onClick={handleStartOver}>
            Start over
          </button>
        )}
        {!tourInfo && (
          <FollowUp
            onSubmit={handleFollowUp}
            disabled={isBusy}
            placeholder={followUpPlaceholder}
          />
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Commit**

```bash
git add webview-ui/src/App.tsx webview-ui/src/components/PlaybackBar.tsx webview-ui/src/components/FollowUp.tsx
git commit -m "feat: rewrite App.tsx with tree state, drill-down, scoped follow-ups"
```

---

### Task 10: Build, package, and install

**Files:**
- All files from above

- [ ] **Step 1: Build everything**

Run: `cd /Users/frednick/Code/Narrator && npm run build:all 2>&1`
Expected: "Build complete." with no errors

- [ ] **Step 2: Fix any compilation errors**

If there are TypeScript errors, fix them and re-run the build.

- [ ] **Step 3: Package and install**

Run: `npx @vscode/vsce package --allow-missing-repository && code --install-extension narrator-0.1.0.vsix --force`

- [ ] **Step 4: Test manually**

1. Reload VS Code
2. Select code, press Ctrl+Shift+N
3. Verify segments appear with disclosure arrows
4. Click arrow — verify spinner, then children appear indented
5. Click segment text — verify audio plays from cache or TTS, and lines highlight
6. Click a different segment — verify correct segment plays (misclick fix)
7. Expand a child, type a follow-up — verify placeholder shows line scope

- [ ] **Step 5: Commit everything**

```bash
git add -A
git commit -m "feat: hierarchical drill-down with audio caching — complete implementation"
```
