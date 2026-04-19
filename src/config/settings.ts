import * as vscode from "vscode";

export type LlmProvider = "claude" | "local";
export type TtsProvider = "elevenlabs" | "kokoro" | "mlx-audio" | "none";
export type DepthLevel = "overview" | "standard" | "deep";

export function getConfig() {
  const config = vscode.workspace.getConfiguration("narrator");
  return {
    llmProvider: config.get<LlmProvider>("llmProvider", "local"),
    claudeApiKey: config.get<string>("claudeApiKey", ""),
    localLlmUrl: config.get<string>("localLlmUrl", "http://localhost:1234/v1"),
    localLlmModel: config.get<string>("localLlmModel", ""),
    ttsProvider: config.get<TtsProvider>("ttsProvider", "kokoro"),
    elevenLabsApiKey: config.get<string>("elevenLabsApiKey", ""),
    voiceId: config.get<string>("voiceId", ""),
    kokoroUrl: config.get<string>("kokoroUrl", "http://localhost:8880"),
    kokoroVoice: config.get<string>("kokoroVoice", "af_bella"),
    mlxAudioUrl: config.get<string>("mlxAudioUrl", "http://localhost:8000"),
    mlxAudioModel: config.get<string>("mlxAudioModel", "mlx-community/Kokoro-82M-bf16"),
    mlxAudioVoice: config.get<string>("mlxAudioVoice", "af_heart"),
  };
}
