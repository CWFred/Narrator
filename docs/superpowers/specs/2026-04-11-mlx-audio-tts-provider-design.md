# mlx-audio TTS Provider

**Date:** 2026-04-11
**Status:** Approved

## Summary

Add mlx-audio as a new TTS provider option in the Narrator extension. mlx-audio runs locally on Apple Silicon via the MLX framework and exposes an OpenAI-compatible API at `/v1/audio/speech`. This gives users a fast, local alternative to Kokoro (which is slow on CPU) and ElevenLabs (which requires a cloud API key).

Non-streaming mode only for initial implementation.

> **Future enhancement:** Support streaming mode (`stream: true`, `streaming_interval`) for lower time-to-first-audio. This would require client-side chunk buffering and careful interaction testing with playback speed controls.

## Architecture

### New File: `src/tts/mlxAudioClient.ts`

Implements the existing `TtsClient` interface:

```typescript
interface TtsClient {
  synthesize(text: string): Promise<TtsResult>
}
```

**Constructor parameters:**
- `baseUrl: string` (default: `http://localhost:8000`)
- `model: string` (default: `mlx-community/Kokoro-82M-bf16`)
- `voice: string` (default: `af_heart`)

**`synthesize(text)` implementation:**
1. POST to `{baseUrl}/v1/audio/speech` with JSON body:
   ```json
   {
     "model": "<model>",
     "input": "<text>",
     "voice": "<voice>",
     "response_format": "wav"
   }
   ```
2. Read response as `arrayBuffer`
3. Convert to base64
4. Return `{ audioBase64, mimeType: "audio/wav" }`

WAV format is used to avoid requiring ffmpeg on the user's machine.

### Model Warmup

When `NarratorPanel.createOrShow()` is called and the TTS provider is `mlx-audio`, a fire-and-forget warmup request is dispatched in the background:

- Calls `synthesize(".")` on the mlx-audio client and discards the result
- Forces lazy model loading so the first real TTS request is fast
- No error shown to the user if warmup fails
- Does not block panel creation or any UI interaction

### Modified Files

#### `package.json` — Configuration Schema

Add to `narrator.ttsProvider` enum: `"mlx-audio"`

New settings:
| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `narrator.mlxAudioUrl` | string | `http://localhost:8000` | mlx-audio server URL |
| `narrator.mlxAudioModel` | string | `mlx-community/Kokoro-82M-bf16` | Model identifier (HuggingFace repo) |
| `narrator.mlxAudioVoice` | string | `af_heart` | Voice preset name |

#### `src/config/settings.ts`

Read `mlxAudioUrl`, `mlxAudioModel`, `mlxAudioVoice` from VS Code configuration in `getConfig()`.

#### `src/commands/explain.ts`

Add `"mlx-audio"` case to `createTtsClient()` factory function:

```typescript
if (config.ttsProvider === "mlx-audio") {
  return new MlxAudioClient(config.mlxAudioUrl, config.mlxAudioModel, config.mlxAudioVoice);
}
```

#### `src/commands/setup.ts`

Add mlx-audio to the TTS provider quick pick list with a description noting it requires Apple Silicon and a running `mlx_audio.server`. When selected, prompt for:
1. Server URL (default: `http://localhost:8000`)
2. Model (default: `mlx-community/Kokoro-82M-bf16`)
3. Voice (default: `af_heart`)

#### `src/webview/panel.ts` (or appropriate location for warmup trigger)

Add warmup logic: when the panel is created/shown and TTS provider is `mlx-audio`, call `synthesize(".")` in the background (fire-and-forget, errors caught and ignored).

## What Doesn't Change

- `TtsClient` interface — unchanged
- Audio playback (`useAudio.ts`) — already handles base64 WAV with playback speed controls
- Kokoro provider — unchanged
- ElevenLabs provider — unchanged
- Webview UI, highlighting, LLM clients — unchanged

## Playback Speed Controls

No compatibility issue. Playback speed is applied via `HTMLAudioElement.playbackRate` on the client side, independent of TTS generation. Works identically to existing providers.

## Limitations

- **Apple Silicon only** — mlx-audio requires M1/M2/M3/M4 Mac. The setup wizard description should note this.
- **First-time model download** — Models are fetched from HuggingFace on first use (Kokoro-82M is ~164MB). This is a one-time cost handled by mlx-audio, not the extension.
- **Server must be running** — User must start `mlx_audio.server` separately. Same pattern as Kokoro.
