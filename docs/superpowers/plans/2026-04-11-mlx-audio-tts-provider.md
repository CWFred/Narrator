# mlx-audio TTS Provider Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add mlx-audio as a new local TTS provider that leverages Apple Silicon GPU acceleration via the MLX framework.

**Architecture:** New `MlxAudioClient` implements existing `TtsClient` interface. Calls the mlx-audio server's OpenAI-compatible `/v1/audio/speech` endpoint (non-streaming). A fire-and-forget warmup request on panel open forces lazy model loading.

**Tech Stack:** TypeScript, VS Code Extension API, mlx-audio FastAPI server (user-managed)

---

### Task 1: Create the mlx-audio TTS client

**Files:**
- Create: `src/tts/mlxAudioClient.ts`

- [ ] **Step 1: Create `src/tts/mlxAudioClient.ts`**

```typescript
import { TtsClient, TtsResult } from "./ttsClient";

// TODO: Support streaming mode (stream: true, streaming_interval) for lower
// time-to-first-audio. Would require client-side chunk buffering and careful
// interaction testing with playback speed controls.

export class MlxAudioClient implements TtsClient {
  private baseUrl: string;
  private model: string;
  private voice: string;

  constructor(
    baseUrl: string = "http://localhost:8000",
    model: string = "mlx-community/Kokoro-82M-bf16",
    voice: string = "af_heart"
  ) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.model = model;
    this.voice = voice;
  }

  async synthesize(text: string): Promise<TtsResult> {
    const response = await fetch(`${this.baseUrl}/v1/audio/speech`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: this.model,
        input: text,
        voice: this.voice,
        response_format: "wav",
      }),
    });

    if (!response.ok) {
      throw new Error(
        `mlx-audio error: ${response.status} ${response.statusText}`
      );
    }

    const arrayBuffer = await response.arrayBuffer();
    const audioBase64 = Buffer.from(arrayBuffer).toString("base64");

    return {
      audioBase64,
      mimeType: "audio/wav",
    };
  }
}
```

- [ ] **Step 2: Verify the file compiles**

Run: `cd /Users/frednick/Code/Narrator && npx tsc --noEmit src/tts/mlxAudioClient.ts`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/tts/mlxAudioClient.ts
git commit -m "feat: add mlx-audio TTS client"
```

---

### Task 2: Add mlx-audio configuration settings

**Files:**
- Modify: `package.json:76-101` (configuration properties)
- Modify: `src/config/settings.ts:1-21`

- [ ] **Step 1: Add `mlx-audio` to `ttsProvider` enum and add new settings in `package.json`**

In `package.json`, change the `narrator.ttsProvider` enum from:
```json
"enum": ["elevenlabs", "kokoro", "none"],
```
to:
```json
"enum": ["elevenlabs", "kokoro", "mlx-audio", "none"],
```

And add these three properties after `narrator.kokoroVoice`:

```json
"narrator.mlxAudioUrl": {
  "type": "string",
  "default": "http://localhost:8000",
  "description": "mlx-audio server URL. Requires Apple Silicon and a running mlx_audio.server."
},
"narrator.mlxAudioModel": {
  "type": "string",
  "default": "mlx-community/Kokoro-82M-bf16",
  "description": "mlx-audio model identifier (HuggingFace repo name)"
},
"narrator.mlxAudioVoice": {
  "type": "string",
  "default": "af_heart",
  "description": "mlx-audio voice preset. Examples: af_heart, af_bella, af_nova, am_adam, am_echo, bf_emma, bm_george"
}
```

- [ ] **Step 2: Update `TtsProvider` type and `getConfig()` in `src/config/settings.ts`**

Change line 4 from:
```typescript
export type TtsProvider = "elevenlabs" | "kokoro" | "none";
```
to:
```typescript
export type TtsProvider = "elevenlabs" | "kokoro" | "mlx-audio" | "none";
```

Add three new lines inside the `getConfig()` return object, after `kokoroVoice`:
```typescript
    mlxAudioUrl: config.get<string>("mlxAudioUrl", "http://localhost:8000"),
    mlxAudioModel: config.get<string>("mlxAudioModel", "mlx-community/Kokoro-82M-bf16"),
    mlxAudioVoice: config.get<string>("mlxAudioVoice", "af_heart"),
```

- [ ] **Step 3: Verify compilation**

Run: `cd /Users/frednick/Code/Narrator && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add package.json src/config/settings.ts
git commit -m "feat: add mlx-audio configuration settings"
```

---

### Task 3: Wire mlx-audio into the TTS factory and add warmup

**Files:**
- Modify: `src/commands/explain.ts:1-16` (imports), `src/commands/explain.ts:33-45` (createTtsClient factory), `src/commands/explain.ts:146` (after panel creation)

- [ ] **Step 1: Add import for MlxAudioClient**

In `src/commands/explain.ts`, add after line 12 (`import { KokoroClient }`):
```typescript
import { MlxAudioClient } from "../tts/mlxAudioClient";
```

- [ ] **Step 2: Add `mlx-audio` case to `createTtsClient()`**

In `src/commands/explain.ts`, change the `createTtsClient` function from:

```typescript
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
```

to:

```typescript
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
  if (config.ttsProvider === "mlx-audio") {
    return new MlxAudioClient(config.mlxAudioUrl, config.mlxAudioModel, config.mlxAudioVoice);
  }
  return new KokoroClient(config.kokoroUrl, config.kokoroVoice);
}
```

- [ ] **Step 3: Add warmup call after panel creation**

In `src/commands/explain.ts`, inside `registerExplainCommand`, after line 146 (`const panel = NarratorPanel.createOrShow(context.extensionUri);`), add:

```typescript
    // Warm up mlx-audio model on panel open (fire-and-forget)
    if (getConfig().ttsProvider === "mlx-audio") {
      const warmupClient = createTtsClient();
      warmupClient?.synthesize(".").catch(() => {});
    }
```

- [ ] **Step 4: Verify compilation**

Run: `cd /Users/frednick/Code/Narrator && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 5: Commit**

```bash
git add src/commands/explain.ts
git commit -m "feat: wire mlx-audio into TTS factory with model warmup"
```

---

### Task 4: Add mlx-audio to the setup wizard

**Files:**
- Modify: `src/commands/setup.ts:92-159` (TTS provider section), `src/commands/setup.ts:162-169` (summary label)

- [ ] **Step 1: Add mlx-audio option to the TTS quick pick**

In `src/commands/setup.ts`, change the TTS quick pick array (lines 93-111) from:

```typescript
    const ttsChoice = await vscode.window.showQuickPick(
      [
        {
          label: "Kokoro (Local)",
          description: "Free, private — runs on your machine",
          value: "kokoro",
        },
        {
          label: "ElevenLabs (Cloud)",
          description: "Best voice quality — requires API key (~$0.01 per explanation)",
          value: "elevenlabs",
        },
        {
          label: "None (Text Only)",
          description: "No audio — just show the transcript",
          value: "none",
        },
      ],
      { title: "Narrator Setup (2/2): Voice", placeHolder: "How should Narrator narrate explanations?" }
    );
```

to:

```typescript
    const ttsChoice = await vscode.window.showQuickPick(
      [
        {
          label: "mlx-audio (Local, Apple Silicon)",
          description: "Fast GPU-accelerated TTS — requires Apple Silicon Mac",
          value: "mlx-audio",
        },
        {
          label: "Kokoro (Local)",
          description: "Free, private — runs on your machine",
          value: "kokoro",
        },
        {
          label: "ElevenLabs (Cloud)",
          description: "Best voice quality — requires API key (~$0.01 per explanation)",
          value: "elevenlabs",
        },
        {
          label: "None (Text Only)",
          description: "No audio — just show the transcript",
          value: "none",
        },
      ],
      { title: "Narrator Setup (2/2): Voice", placeHolder: "How should Narrator narrate explanations?" }
    );
```

- [ ] **Step 2: Add mlx-audio configuration prompts**

In `src/commands/setup.ts`, after the closing `}` of the `else if (ttsChoice.value === "kokoro")` block (line 159), add:

```typescript
 else if (ttsChoice.value === "mlx-audio") {
      const mlxUrl = await vscode.window.showInputBox({
        title: "mlx-audio Server URL",
        prompt: "Enter the mlx-audio server URL (start server with: mlx_audio.server --port 8000)",
        placeHolder: "http://localhost:8000",
        value: config.get<string>("mlxAudioUrl", "http://localhost:8000"),
      });
      if (mlxUrl !== undefined) {
        await config.update("mlxAudioUrl", mlxUrl, vscode.ConfigurationTarget.Global);
      }

      const mlxModel = await vscode.window.showInputBox({
        title: "mlx-audio Model",
        prompt: "Enter the HuggingFace model name",
        placeHolder: "mlx-community/Kokoro-82M-bf16",
        value: config.get<string>("mlxAudioModel", "mlx-community/Kokoro-82M-bf16"),
      });
      if (mlxModel !== undefined) {
        await config.update("mlxAudioModel", mlxModel, vscode.ConfigurationTarget.Global);
      }

      const mlxVoice = await vscode.window.showInputBox({
        title: "mlx-audio Voice",
        prompt: "Enter the voice preset (e.g., af_heart, am_adam, bf_emma)",
        placeHolder: "af_heart",
        value: config.get<string>("mlxAudioVoice", "af_heart"),
      });
      if (mlxVoice !== undefined) {
        await config.update("mlxAudioVoice", mlxVoice, vscode.ConfigurationTarget.Global);
      }
    }
```

- [ ] **Step 3: Update the summary label**

In `src/commands/setup.ts`, change the summary `ttsLabel` logic (lines 163-168) from:

```typescript
    const ttsLabel =
      ttsChoice.value === "elevenlabs"
        ? "ElevenLabs (cloud)"
        : ttsChoice.value === "kokoro"
          ? "Kokoro (local)"
          : "Text only";
```

to:

```typescript
    const ttsLabel =
      ttsChoice.value === "elevenlabs"
        ? "ElevenLabs (cloud)"
        : ttsChoice.value === "mlx-audio"
          ? "mlx-audio (local)"
          : ttsChoice.value === "kokoro"
            ? "Kokoro (local)"
            : "Text only";
```

- [ ] **Step 4: Verify compilation**

Run: `cd /Users/frednick/Code/Narrator && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 5: Commit**

```bash
git add src/commands/setup.ts
git commit -m "feat: add mlx-audio to setup wizard"
```

---

### Task 5: Build and manual verification

**Files:**
- None created/modified — verification only

- [ ] **Step 1: Full build**

Run: `cd /Users/frednick/Code/Narrator && npm run compile`
Expected: Build succeeds with no errors

- [ ] **Step 2: Verify extension loads in VS Code**

1. Press F5 in VS Code to launch the Extension Development Host
2. Open the command palette (Cmd+Shift+P)
3. Run "Narrator: Setup"
4. Verify "mlx-audio (Local, Apple Silicon)" appears in the TTS provider list
5. Select it and verify URL, model, and voice prompts appear with correct defaults

- [ ] **Step 3: Verify TTS works with a running mlx-audio server**

Prerequisites: `pip install mlx-audio[server]` and `mlx_audio.server --port 8000`

1. Configure Narrator to use mlx-audio via setup wizard
2. Select some code and run "Explain with Narrator"
3. Verify audio plays for narration segments
4. Verify playback speed controls (0.5x–2x) work correctly
5. Verify warmup: close and reopen the panel — second explanation should start faster

- [ ] **Step 4: Verify settings in VS Code settings UI**

1. Open Settings (Cmd+,)
2. Search "narrator"
3. Verify `mlxAudioUrl`, `mlxAudioModel`, `mlxAudioVoice` settings appear with correct defaults and descriptions

- [ ] **Step 5: Final commit**

```bash
git add -A
git commit -m "feat: mlx-audio TTS provider - complete integration"
```
