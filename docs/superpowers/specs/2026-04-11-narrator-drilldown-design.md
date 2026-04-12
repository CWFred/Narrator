# Narrator: Hierarchical Drill-Down with Audio Caching

**Date:** 2026-04-11
**Status:** Approved

## Problem

The current Narrator UX is flat: you get one level of explanation and that's it. Users want to start with a high-level overview and progressively drill into specific sections for more detail. Additionally:

- Audio is re-generated on every click (no caching)
- Segment clicks sometimes trigger the wrong segment (stale index bug)
- Follow-up questions don't scope to the code you're currently looking at

## Design

### 1. Segment UI: Disclosure Nodes

Each transcript segment becomes a tree node with three interaction zones:

```
 >  [narration text here]
 |       ^ click text: highlight lines + play audio
 |
 ^ click arrow: expand to show deeper sub-segments
```

**Expanded state:**

```
 v  This function handles authentication by...
     >  Lines 12-15: First it extracts the JWT token...
     >  Lines 16-20: Then validates against the auth service...
     >  Lines 21-25: Finally returns the decoded claims...
```

**Rules:**
- Sub-segments are themselves expandable (recursive tree)
- Expand arrow hidden when `highlight_range` covers 3 lines or fewer
- Expanding a segment triggers an LLM call for a deeper explanation of just that line range
- Collapsing hides children but preserves their state (re-expanding is instant)
- Practically bottoms out at 2-3 levels (file -> function -> statements)

### 2. Data Model

Replace the flat `Segment[]` with a tree:

```typescript
interface SegmentNode {
  id: string;                  // stable UUID, used for all lookups
  narration: string;
  highlight_range: { start: number; end: number };
  highlight_lines: number[];
  children?: SegmentNode[];    // populated on first expand
  isExpanded: boolean;
  isLoading: boolean;          // spinner while LLM responds
}
```

**Key change:** All segment references use `id` instead of array index. This fixes the misclick bug where stale indices pointed to the wrong segment.

### 3. Drill-Down Mechanics

When the user clicks the expand arrow on a segment:

1. If `children` already exist, toggle `isExpanded` (instant, no LLM call)
2. If `children` is undefined (first expand):
   a. Set `isLoading: true`, show spinner
   b. Send the segment's line range to the LLM with a drill-down prompt
   c. LLM prompt includes:
      - The specific numbered source lines for that range
      - The parent narration as context ("this block was previously described as: ...")
      - System prompt requesting fine-grained, non-overlapping sub-segments
   d. Parse response into child `SegmentNode[]`
   e. Run highlight fixer on children
   f. Set `isLoading: false`, `isExpanded: true`
3. Children are cached on the SegmentNode itself -- re-expanding never re-queries

**New message types:**

- Webview -> Extension: `drillDown` with `{ segmentId, startLine, endLine, parentNarration }`
- Extension -> Webview: `drillDownComplete` with `{ segmentId, children: SegmentNode[] }`

### 4. Audio Cache

An in-memory `Map<string, AudioBuffer>` in the webview, keyed by a hash of the narration text.

**Flow:**
1. Before requesting TTS from the extension, check cache. If hit, play immediately.
2. When TTS audio arrives (Play All or segment click), decode to AudioBuffer and store in cache.
3. Play All generates TTS for all current-level segments sequentially, caching each. Second play is instant.
4. Cache clears when panel is disposed. No disk persistence, no eviction.

**Why narration text hash as key:** Same narration always produces the same audio. If the LLM returns identical text for two segments (unlikely but possible), they share the cached audio -- which is correct.

### 5. Follow-Up Questions Scoped to Depth

The follow-up input at the bottom of the panel adapts its scope:

- **If a segment is expanded:** Scope to the expanded segment's line range. Placeholder: "Ask about lines 12-25..."
- **If nothing is expanded:** Scope to the full file/selection. Placeholder: "Ask a follow-up..."

**LLM context for scoped follow-ups:**
- Primary: the specific lines in scope
- Context: the parent narration chain (breadcrumb of how the user drilled to this point)
- Background: the full file source (so the LLM can reference external lines if the question requires it)

**Follow-up answers** appear as new segments below the follow-up input. They have:
- Their own highlight ranges and audio (click to hear + highlight)
- Expand arrows (if they reference a multi-line range, drill deeper)
- Can highlight lines outside the current drill-down scope (editor is not constrained)

### 6. Misclick Fix

**Root cause:** `handleSegmentClick` uses array index to look up segments in React state. If segments re-render between the click event binding and the handler firing, the index points to the wrong segment.

**Fix:** Every `SegmentNode` gets a stable `id` (UUID generated on creation). Click handlers pass `id`, not index. Lookup uses `id` to find the segment in the tree. This is O(n) on the tree but the tree is always small.

### 7. Component Changes

**Transcript.tsx** -> Major rewrite:
- Renders a tree of `SegmentNode` recursively
- Each node: expand arrow (if expandable) + narration text (clickable)
- Indentation per depth level
- Loading spinner for expanding nodes
- Active segment highlight by `id`

**App.tsx:**
- State changes from `segments: Segment[]` to `segmentTree: SegmentNode[]`
- New `handleDrillDown(segmentId)` handler
- New `handleSegmentPlay(segmentId)` handler (replaces index-based click)
- Follow-up input scope derived from currently expanded segment
- `findSegmentById(tree, id)` utility for tree lookups

**useAudio.ts:**
- Add `audioCache: Map<string, AudioBuffer>` (persists across stop/reset)
- `enqueue` checks cache before adding to queue
- `playSingle(narrationText, audioBase64, mimeType)` for click-to-play with caching
- Cache cleared only on `dispose`, not on `stop/reset`

**messageHandler.ts:**
- Add `drillDown` and `drillDownComplete` message types
- All segment-related messages use `segmentId` instead of `segmentIndex`

**explain.ts / explainRepo.ts:**
- New `drillDown` handler: takes line range + parent narration, calls LLM with drill-down prompt, returns sub-segments
- Generate stable IDs for all segments on creation

**highlightFixer.ts:**
- No changes needed (already works on any segment array)

**decorationEngine.ts:**
- No changes needed

### 8. Drill-Down Prompt

```
You are explaining a specific section of code in more detail.
This code was previously described as: "{parentNarration}"

Now explain it at a finer level of detail, breaking it into smaller sections.
Each section should cover 2-5 lines. Explain what each section does and why.

[standard JSON format instructions with line numbers]
```

### 9. Scope and Risk

**In scope:**
- Tree-based segment model with expand/collapse
- Audio caching (in-memory, per-session)
- Drill-down LLM calls with parent context
- Scoped follow-up questions
- Misclick fix via stable IDs
- Works for single-file explain, repo tour, and follow-ups

**Out of scope:**
- Persisting drill-down state across sessions
- Pre-fetching deeper explanations before user expands
- Audio cache on disk

**Risk:** LLM quality at deep drill-down levels is untested. Line-by-line explanations for trivial code may feel verbose or unhelpful. Mitigation: the architecture supports prompt iteration without structural changes.
