import Anthropic from "@anthropic-ai/sdk";
import { LlmClient, ExplanationResult } from "./llmClient";

export class ClaudeClient implements LlmClient {
  private client: Anthropic;

  constructor(apiKey: string) {
    this.client = new Anthropic({ apiKey });
  }

  async explain(
    systemPrompt: string,
    userPrompt: string,
    onChunk: (text: string) => void
  ): Promise<ExplanationResult> {
    let fullText = "";

    const stream = this.client.messages.stream({
      model: "claude-sonnet-4-20250514",
      max_tokens: 4096,
      system: systemPrompt,
      messages: [{ role: "user", content: userPrompt }],
    });

    for await (const event of stream) {
      if (
        event.type === "content_block_delta" &&
        event.delta.type === "text_delta"
      ) {
        fullText += event.delta.text;
        onChunk(event.delta.text);
      }
    }

    return parseExplanationJson(fullText);
  }
}

function parseExplanationJson(text: string): ExplanationResult {
  // Try to extract JSON from the response (handle possible markdown fences)
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
    // If JSON parsing fails, create a single segment from the full text
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
