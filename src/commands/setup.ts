import * as vscode from "vscode";

export function registerSetupCommand(
  context: vscode.ExtensionContext
): vscode.Disposable {
  return vscode.commands.registerCommand("narrator.setup", async () => {
    const config = vscode.workspace.getConfiguration("narrator");

    // Step 1: LLM provider
    const llmChoice = await vscode.window.showQuickPick(
      [
        {
          label: "Local (LM Studio / Ollama)",
          description: "Free, private — runs on your machine",
          value: "local",
        },
        {
          label: "Claude (Anthropic API)",
          description: "Cloud — requires API key (~$0.01–0.03 per explanation)",
          value: "claude",
        },
      ],
      { title: "Narrator Setup (1/2): Explanation Model", placeHolder: "How should Narrator generate explanations?" }
    );

    if (!llmChoice) return;

    await config.update("llmProvider", llmChoice.value, vscode.ConfigurationTarget.Global);

    if (llmChoice.value === "claude") {
      const apiKey = await vscode.window.showInputBox({
        title: "Anthropic API Key",
        prompt: "Enter your Anthropic API key (starts with sk-ant-)",
        password: true,
        placeHolder: "sk-ant-...",
        value: config.get<string>("claudeApiKey", ""),
      });
      if (apiKey !== undefined) {
        await config.update("claudeApiKey", apiKey, vscode.ConfigurationTarget.Global);
      }
    } else {
      // Local LLM setup
      const urlChoice = await vscode.window.showQuickPick(
        [
          {
            label: "LM Studio (http://localhost:1234/v1)",
            value: "http://localhost:1234/v1",
          },
          {
            label: "Ollama (http://localhost:11434)",
            value: "http://localhost:11434",
          },
          {
            label: "Custom URL...",
            value: "custom",
          },
        ],
        { title: "Local LLM Server", placeHolder: "Where is your local model running?" }
      );

      if (!urlChoice) return;

      let url = urlChoice.value;
      if (url === "custom") {
        const customUrl = await vscode.window.showInputBox({
          title: "Custom LLM Server URL",
          prompt: "Enter the base URL of your local LLM server",
          placeHolder: "http://localhost:8000/v1",
        });
        if (!customUrl) return;
        url = customUrl;
      }

      await config.update("localLlmUrl", url, vscode.ConfigurationTarget.Global);

      // Ollama requires a model name; LM Studio uses whatever's loaded
      if (url === "http://localhost:11434") {
        const model = await vscode.window.showInputBox({
          title: "Model Name",
          prompt: "Enter the Ollama model name",
          placeHolder: "e.g., qwen2.5-coder:32b",
          value: config.get<string>("localLlmModel", ""),
        });
        if (model !== undefined) {
          await config.update("localLlmModel", model, vscode.ConfigurationTarget.Global);
        }
      } else {
        await config.update("localLlmModel", "", vscode.ConfigurationTarget.Global);
      }
    }

    // Step 2: TTS provider
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

    if (!ttsChoice) return;

    await config.update("ttsProvider", ttsChoice.value, vscode.ConfigurationTarget.Global);

    if (ttsChoice.value === "elevenlabs") {
      const apiKey = await vscode.window.showInputBox({
        title: "ElevenLabs API Key",
        prompt: "Enter your ElevenLabs API key",
        password: true,
        placeHolder: "xi-...",
        value: config.get<string>("elevenLabsApiKey", ""),
      });
      if (apiKey !== undefined) {
        await config.update("elevenLabsApiKey", apiKey, vscode.ConfigurationTarget.Global);
      }

      const voiceId = await vscode.window.showInputBox({
        title: "ElevenLabs Voice ID",
        prompt: "Enter a voice ID (or keep the default)",
        placeHolder: "21m00Tcm4TlvDq8ikWAM",
        value: config.get<string>("voiceId", "21m00Tcm4TlvDq8ikWAM"),
      });
      if (voiceId !== undefined) {
        await config.update("voiceId", voiceId, vscode.ConfigurationTarget.Global);
      }
    } else if (ttsChoice.value === "kokoro") {
      const kokoroUrl = await vscode.window.showInputBox({
        title: "Kokoro Server URL",
        prompt: "Enter the Kokoro TTS server URL",
        placeHolder: "http://localhost:8880",
        value: config.get<string>("kokoroUrl", "http://localhost:8880"),
      });
      if (kokoroUrl !== undefined) {
        await config.update("kokoroUrl", kokoroUrl, vscode.ConfigurationTarget.Global);
      }

      const voice = await vscode.window.showInputBox({
        title: "Kokoro Voice",
        prompt: "Enter the Kokoro voice name (or keep default)",
        placeHolder: "af_bella",
        value: config.get<string>("kokoroVoice", "af_bella"),
      });
      if (voice !== undefined) {
        await config.update("kokoroVoice", voice, vscode.ConfigurationTarget.Global);
      }
    } else if (ttsChoice.value === "mlx-audio") {
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

    // Summary
    const llmLabel = llmChoice.value === "claude" ? "Claude (cloud)" : "Local LLM";
    const ttsLabel =
      ttsChoice.value === "elevenlabs"
        ? "ElevenLabs (cloud)"
        : ttsChoice.value === "mlx-audio"
          ? "mlx-audio (local)"
          : ttsChoice.value === "kokoro"
            ? "Kokoro (local)"
            : "Text only";

    vscode.window.showInformationMessage(
      `Narrator configured: ${llmLabel} + ${ttsLabel}. Select code and press Cmd+Shift+D to start.`
    );
  });
}
