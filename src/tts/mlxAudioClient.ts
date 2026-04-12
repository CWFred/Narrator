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
