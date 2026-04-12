# Narrator

A VS Code extension that explains unfamiliar codebases out loud. Select code, pick a depth level, and hear it explained with synchronized line highlighting.

## Features

- **AI-powered code explanations** — Select code and get a structured walkthrough
- **Three depth levels** — Overview (30–60s), Standard (1–2 min), Deep Dive (2–5 min)
- **Synchronized highlighting** — Editor lines light up in sync with narration
- **Voice narration** — Hear explanations via ElevenLabs or local Kokoro TTS
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
| `narrator.ttsProvider` | `elevenlabs` | `elevenlabs`, `kokoro`, or `none` (text-only) |
| `narrator.elevenLabsApiKey` | | Your ElevenLabs API key |
| `narrator.voiceId` | `21m00Tcm4TlvDq8ikWAM` | ElevenLabs voice ID |

### General

| Setting | Default | Description |
|---------|---------|-------------|
| `narrator.defaultDepth` | `standard` | Default explanation depth: `overview`, `standard`, or `deep` |

## Local Setup (Zero Cost)

For fully offline operation:

1. **LLM:** Install [LM Studio](https://lmstudio.ai) or [Ollama](https://ollama.ai)
   - LM Studio: Load a model and start the server (default: `http://localhost:1234/v1`)
   - Ollama: `ollama run qwen2.5-coder:32b`
2. **TTS:** Install [Kokoro TTS](https://github.com/remsky/Kokoro-FastAPI) and start the server
3. Set `narrator.llmProvider` to `local` and `narrator.ttsProvider` to `kokoro`

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
| Local (LM Studio + Kokoro) | $0.00 |

## License

MIT
