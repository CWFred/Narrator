# Narrator

A VS Code extension that explains unfamiliar codebases out loud. Select code, pick a depth level, and hear it explained with synchronized line highlighting.

## Features

- **AI-powered code explanations** — Select code and get a structured walkthrough
- **Three depth levels** — Overview (30–60s), Standard (1–2 min), Deep Dive (2–5 min)
- **Synchronized highlighting** — Editor lines light up in sync with narration
- **Voice narration** — Hear explanations via ElevenLabs, mlx-audio (Apple Silicon), or Kokoro TTS
- **Follow-up Q&A** — Ask questions about the explained code
- **Local-first option** — Use Ollama or LM Studio for fully offline operation

## Quick Start

1. Install the extension
2. Open a file and select some code
3. Press `Cmd+Shift+D` (or right-click → "Explain with Narrator")
4. Choose a depth level in the sidebar panel
5. Listen to the explanation as lines highlight in your editor

## Configuration

Open Settings (`Cmd+,`) and search for "Narrator".

### LLM Provider

| Setting | Default | Description |
|---------|---------|-------------|
| `narrator.llmProvider` | `claude` | `claude` for Claude API, `local` for Ollama/LM Studio |
| `narrator.claudeApiKey` | | Your Anthropic API key |
| `narrator.localLlmUrl` | `http://localhost:1234/v1` | Local LLM server URL |
| `narrator.localLlmModel` | `qwen-3.5-next-coder-90b` | Model name for local provider |

### TTS Provider

| Setting | Default | Description |
|---------|---------|-------------|
| `narrator.ttsProvider` | `elevenlabs` | `elevenlabs`, `kokoro`, `mlx-audio`, or `none` (text-only) |
| `narrator.elevenLabsApiKey` | | Your ElevenLabs API key |
| `narrator.voiceId` | `21m00Tcm4TlvDq8ikWAM` | ElevenLabs voice ID |
| `narrator.mlxAudioUrl` | `http://localhost:8000` | mlx-audio server URL |
| `narrator.mlxAudioModel` | `mlx-community/Kokoro-82M-bf16` | mlx-audio model (HuggingFace repo name) |
| `narrator.mlxAudioVoice` | `af_heart` | mlx-audio voice preset |

### General

| Setting | Default | Description |
|---------|---------|-------------|
| `narrator.defaultDepth` | `standard` | Default explanation depth: `overview`, `standard`, or `deep` |

## Local Setup (Zero Cost)

For fully offline operation:

1. **LLM:** Install [LM Studio](https://lmstudio.ai) or [Ollama](https://ollama.ai)
   - LM Studio: Load a model and start the server (default: `http://localhost:1234/v1`)
   - Ollama: `ollama run qwen2.5-coder:32b`
2. **TTS:** Choose one of the options below, then set `narrator.ttsProvider` accordingly

### TTS Option A: mlx-audio (Recommended for Apple Silicon Macs)

[mlx-audio](https://github.com/Blaizzy/mlx-audio) uses Apple's MLX framework for GPU-accelerated TTS. Much faster than CPU-based alternatives.

**Requirements:** Apple Silicon Mac (M1/M2/M3/M4), Python 3.10–3.12 recommended

```bash
# Install mlx-audio with TTS and server support
pip install "mlx-audio[tts,server]"

# Start the server
mlx_audio.server --port 8000
```

The first request will download the model from HuggingFace (~164MB for Kokoro-82M). Narrator automatically warms up the model when you open the panel.

Set `narrator.ttsProvider` to `mlx-audio`. Default settings work out of the box.

**Available voices:** `af_heart`, `af_bella`, `af_nova`, `af_sky`, `am_adam`, `am_echo`, `bf_alice`, `bf_emma`, `bm_daniel`, `bm_george`, and [many more](https://github.com/Blaizzy/mlx-audio).

**Other models:** The default `mlx-community/Kokoro-82M-bf16` is the fastest. For higher quality, try `mlx-community/Qwen3-TTS-1.7B` or `mlx-community/Voxtral-4B` (these require more RAM and are slower).

### TTS Option B: Kokoro (Any Platform)

[Kokoro-FastAPI](https://github.com/remsky/Kokoro-FastAPI) runs on any platform but uses CPU, which can be slow.

```bash
# Follow instructions at https://github.com/remsky/Kokoro-FastAPI
# Default server runs on port 8880
```

Set `narrator.ttsProvider` to `kokoro`.

### TTS Option C: ElevenLabs (Cloud, Best Quality)

[ElevenLabs](https://elevenlabs.io) offers the highest voice quality but requires an API key and internet connection (~$0.01 per explanation).

Set `narrator.ttsProvider` to `elevenlabs` and configure your API key.

## Commands

| Command | Shortcut | Description |
|---------|----------|-------------|
| Explain with Narrator | `Cmd+Shift+D` | Explain selected code |
| Narrator: Ask Follow-up | | Ask a follow-up question |

## Development

```bash
# Install dependencies
npm install
cd webview-ui && npm install && cd ..

# Build everything
npm run build:all

# Watch mode (extension only)
npm run watch
```

Press `F5` in VS Code to launch the Extension Development Host.

## Cost

| Provider | Cost per explanation |
|----------|-------------------|
| Claude + ElevenLabs | ~$0.02–0.04 |
| Local (LM Studio + mlx-audio) | $0.00 |
| Local (LM Studio + Kokoro) | $0.00 |

## License

MIT
