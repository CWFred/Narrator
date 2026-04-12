import { LlmClient, ExplanationResult } from "./llmClient";

/**
 * Supports both Ollama native API and OpenAI-compatible APIs (LM Studio, etc).
 * Auto-detects based on whether the URL contains "/v1".
 */
export class LocalLlmClient implements LlmClient {
  private baseUrl: string;
  private model: string;

  constructor(baseUrl: string, model: string) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.model = model;
  }

  private get isOpenAiCompatible(): boolean {
    return this.baseUrl.includes("/v1");
  }

  async explain(
    systemPrompt: string,
    userPrompt: string,
    onChunk: (text: string) => void
  ): Promise<ExplanationResult> {
    if (this.isOpenAiCompatible) {
      return this.explainOpenAi(systemPrompt, userPrompt, onChunk);
    }
    return this.explainOllama(systemPrompt, userPrompt, onChunk);
  }

  private async explainOpenAi(
    systemPrompt: string,
    userPrompt: string,
    onChunk: (text: string) => void
  ): Promise<ExplanationResult> {
    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...(this.model ? { model: this.model } : {}),
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        stream: true,
      }),
    });

    if (!response.ok) {
      throw new Error(`Local LLM error: ${response.status} ${response.statusText}`);
    }

    return this.readSseStream(response, onChunk);
  }

  private async explainOllama(
    systemPrompt: string,
    userPrompt: string,
    onChunk: (text: string) => void
  ): Promise<ExplanationResult> {
    const response = await fetch(`${this.baseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: this.model,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        stream: true,
        format: "json",
      }),
    });

    if (!response.ok) {
      throw new Error(`Ollama error: ${response.status} ${response.statusText}`);
    }

    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error("No response body from Ollama");
    }

    const decoder = new TextDecoder();
    let fullText = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value, { stream: true });
      for (const line of chunk.split("\n").filter(Boolean)) {
        try {
          const parsed = JSON.parse(line);
          if (parsed.message?.content) {
            fullText += parsed.message.content;
            onChunk(parsed.message.content);
          }
        } catch {
          // Skip malformed lines
        }
      }
    }

    return parseExplanationJson(fullText);
  }

  private async readSseStream(
    response: Response,
    onChunk: (text: string) => void
  ): Promise<ExplanationResult> {
    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error("No response body");
    }

    const decoder = new TextDecoder();
    let fullText = "";
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        const data = line.slice(6).trim();
        if (data === "[DONE]") continue;

        try {
          const parsed = JSON.parse(data);
          const content = parsed.choices?.[0]?.delta?.content;
          if (content) {
            fullText += content;
            onChunk(content);
          }
        } catch {
          // Skip malformed SSE lines
        }
      }
    }

    return parseExplanationJson(fullText);
  }
}

function parseExplanationJson(text: string): ExplanationResult {
  let jsonStr = text.trim();
  const fenceMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) {
    jsonStr = fenceMatch[1].trim();
  }

  try {
    const parsed = JSON.parse(jsonStr);
    return {
      segments: parsed.segments || [],
      summary: parsed.summary || "",
    };
  } catch {
    return {
      segments: [
        {
          narration: text.trim(),
          highlight_lines: [],
          highlight_range: { start: 0, end: 0 },
        },
      ],
      summary: "",
    };
  }
}
