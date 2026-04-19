# Narrator

Understand unfamiliar codebases without reading every line. Narrator is a VS Code extension that generates spoken walkthroughs of your code with synchronized line highlighting — like having a senior dev walk you through the project.

Point it at a repo and it will tour you through the key files, explaining what each one does. Or select a specific block of code for a deeper explanation. Either way, lines highlight in your editor as each section is narrated aloud.

## How It Works

**New to a codebase? Start with a repo tour:**

1. Open the command palette (`Cmd+Shift+P`) and run **"Narrator: Explain Repo"**
2. Narrator walks through the important files one by one, explaining each
3. Listen as lines highlight in sync — navigate between files when you're ready

**Already know where to look? Explain specific code:**

1. Select code in your editor
2. Press `Ctrl+Shift+N` (or right-click > "Explain with Narrator")
3. Pick a depth: **Overview** (30–60s), **Standard** (1–2 min), or **Deep Dive** (2–5 min)
4. Click any segment to replay it, drill down for more detail, or ask follow-up questions

Everything can run locally on your machine — no API keys, no cloud, no cost.

## Getting Started

Narrator needs two things to work: an **LLM** to generate explanations and a **TTS engine** to read them aloud. Both can run locally for free, or you can use cloud services.

### Recommended Setup (Local, Free)

This gets you running in under 5 minutes with everything on your machine.

**Step 1 — Install an LLM server**

Install [LM Studio](https://lmstudio.ai) (easiest) or [Ollama](https://ollama.ai).

- **LM Studio:** Download it, load any coding model (e.g., Qwen Coder), and click "Start Server". It runs at `http://localhost:1234/v1` by default.
- **Ollama:** Install it and run `ollama run qwen2.5-coder:32b` (or any model that fits your hardware).

**Step 2 — Install a TTS server**

Pick the option that matches your hardware:

**Apple Silicon Mac (M1/M2/M3/M4) — use mlx-audio:**

```bash
pip install "mlx-audio[tts,server]"
mlx_audio.server --port 8000
```

This uses your Mac's GPU for fast speech synthesis. The first run downloads a small model (~164MB). Python 3.10–3.12 recommended.

**Any platform — use Kokoro:**

Follow the setup instructions at [Kokoro-FastAPI](https://github.com/remsky/Kokoro-FastAPI). It runs on CPU, which works everywhere but is slower.

**Step 3 — Configure Narrator**

Open the command palette (`Cmd+Shift+P`) and run **"Narrator: Setup"**. Pick your LLM and TTS providers. That's it.

### Cloud Alternatives

If you'd rather not run local servers:

- **Claude API** for explanations — requires an [Anthropic API key](https://console.anthropic.com) (~$0.01–0.03 per explanation)
- **ElevenLabs** for voice — requires an [ElevenLabs API key](https://elevenlabs.io) (~$0.01 per explanation). Best voice quality available.
- **Text-only mode** — set TTS provider to "None" to skip audio entirely. You still get the full transcript and line highlighting.

You can mix and match: local LLM + cloud TTS, cloud LLM + local TTS, or any combination.

## Features

- **Repo tours** — point Narrator at a repository and get a guided walkthrough of the key files, one by one
- **Three depth levels** — Overview for a quick scan, Standard for a solid walkthrough, Deep Dive for line-by-line detail
- **Synchronized highlighting** — editor lines light up as each section is narrated
- **Drill down** — click the arrow on any segment to get a deeper explanation of that section
- **Follow-up Q&A** — ask questions about the code in the panel's input box
- **Playback controls** — play/stop, adjustable speed (0.5x–2x), click any segment to replay it
- **Keyboard shortcuts** — `[` and `]` to adjust speed while the panel is focused

## Commands

| Command | Shortcut | Description |
|---------|----------|-------------|
| Explain with Narrator | `Ctrl+Shift+N` | Explain selected code |
| Narrator: Setup | | Configure LLM and TTS providers |
| Narrator: Explain Repo | | Walk through a whole repository |

## Settings Reference

All settings are under `narrator.*` in VS Code settings (`Cmd+,`).

| Setting | Default | Description |
|---------|---------|-------------|
| `llmProvider` | `local` | `local` (LM Studio/Ollama) or `claude` |
| `claudeApiKey` | | Anthropic API key (only needed for Claude) |
| `localLlmUrl` | `http://localhost:1234/v1` | Local LLM server URL |
| `localLlmModel` | | Model name (required for Ollama, leave blank for LM Studio) |
| `ttsProvider` | `kokoro` | `mlx-audio`, `kokoro`, `elevenlabs`, or `none` |
| `mlxAudioUrl` | `http://localhost:8000` | mlx-audio server URL |
| `mlxAudioModel` | `mlx-community/Kokoro-82M-bf16` | mlx-audio model (HuggingFace repo) |
| `mlxAudioVoice` | `af_heart` | mlx-audio voice preset |
| `kokoroUrl` | `http://localhost:8880` | Kokoro server URL |
| `kokoroVoice` | `af_bella` | Kokoro voice name |
| `elevenLabsApiKey` | | ElevenLabs API key |
| `voiceId` | `21m00Tcm4TlvDq8ikWAM` | ElevenLabs voice ID |

## Troubleshooting

**"No audio plays"** — Make sure your TTS server is running. For mlx-audio: `mlx_audio.server --port 8000`. For Kokoro: check that the server is up on port 8880.

**"Explanation is slow"** — The LLM generates the explanation first, then audio is synthesized one segment at a time. Larger models produce better explanations but take longer. Try a smaller model if speed matters more than quality.

**"mlx-audio won't install"** — Use Python 3.10–3.12 and install with `pip install "mlx-audio[tts,server]"` (quotes required in zsh). Apple Silicon only.

**"Nothing happens when I trigger Narrator"** — Make sure you have code selected (or a file open) and your LLM server is running.

## Development

```bash
npm install
cd webview-ui && npm install && cd ..
npm run build:all    # Build everything
npm run watch        # Watch mode (extension only)
```

Press `F5` in VS Code to launch the Extension Development Host.

## License

MIT
