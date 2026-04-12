export interface ExplanationSegment {
  narration: string;
  highlight_lines: number[];
  highlight_range: { start: number; end: number };
}

export interface ExplanationResult {
  segments: ExplanationSegment[];
  summary: string;
}

export interface LlmClient {
  explain(
    systemPrompt: string,
    userPrompt: string,
    onChunk: (text: string) => void
  ): Promise<ExplanationResult>;
}
