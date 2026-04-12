import { TtsClient, TtsResult } from "./ttsClient";

export class KokoroClient implements TtsClient {
  private baseUrl: string;
  private voice: string;

  constructor(baseUrl: string = "http://localhost:8880", voice: string = "af_bella") {
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.voice = voice;
  }

  async synthesize(text: string): Promise<TtsResult> {
    const response = await fetch(`${this.baseUrl}/v1/audio/speech`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        input: text,
        voice: this.voice,
        response_format: "wav",
      }),
    });

    if (!response.ok) {
      throw new Error(
        `Kokoro error: ${response.status} ${response.statusText}`
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
