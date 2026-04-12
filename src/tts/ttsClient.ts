export interface TtsResult {
  audioBase64: string;
  mimeType: string;
}

export interface TtsClient {
  synthesize(text: string): Promise<TtsResult>;
}
