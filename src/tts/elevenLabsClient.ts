import { TtsClient, TtsResult } from "./ttsClient";

export class ElevenLabsClient implements TtsClient {
  private apiKey: string;
  private voiceId: string;

  constructor(apiKey: string, voiceId: string) {
    this.apiKey = apiKey;
    this.voiceId = voiceId;
  }

  async synthesize(text: string): Promise<TtsResult> {
    const response = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${this.voiceId}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "xi-api-key": this.apiKey,
        },
        body: JSON.stringify({
          text,
          model_id: "eleven_turbo_v2_5",
          voice_settings: {
            stability: 0.5,
            similarity_boost: 0.75,
          },
        }),
      }
    );

    if (!response.ok) {
      throw new Error(
        `ElevenLabs error: ${response.status} ${response.statusText}`
      );
    }

    const arrayBuffer = await response.arrayBuffer();
    const audioBase64 = Buffer.from(arrayBuffer).toString("base64");

    return {
      audioBase64,
      mimeType: "audio/mpeg",
    };
  }
}
