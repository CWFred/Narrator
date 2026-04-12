import { CodeContext } from "./codeContext";
import { buildSystemPrompt, buildUserPrompt } from "./promptBuilder";
import { DepthLevel } from "../config/settings";
import { LlmClient, ExplanationResult } from "../llm/llmClient";

interface ConversationMessage {
  role: "user" | "assistant";
  content: string;
}

const MAX_TURNS = 10;

export class ConversationManager {
  private messages: ConversationMessage[] = [];
  private systemPrompt: string = "";
  private codeContext: CodeContext | undefined;

  reset(codeContext: CodeContext, depth: DepthLevel) {
    this.codeContext = codeContext;
    this.systemPrompt = buildSystemPrompt(depth);
    this.messages = [
      { role: "user", content: buildUserPrompt(codeContext) },
    ];
  }

  getCodeContext(): CodeContext | undefined {
    return this.codeContext;
  }

  getSystemPrompt(): string {
    return this.systemPrompt;
  }

  getInitialUserPrompt(): string {
    return this.messages[0]?.content ?? "";
  }

  addAssistantMessage(content: string) {
    this.messages.push({ role: "assistant", content });
    this.trimHistory();
  }

  addFollowUp(question: string) {
    this.messages.push({ role: "user", content: question });
    this.trimHistory();
  }

  async askFollowUp(
    llmClient: LlmClient,
    question: string,
    onChunk: (text: string) => void
  ): Promise<ExplanationResult> {
    this.addFollowUp(question);

    // Build a combined prompt with conversation history
    const historyPrompt = this.messages
      .map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.content}`)
      .join("\n\n");

    const followUpSystem = `${this.systemPrompt}

You are continuing a conversation about code. The conversation history is included.
When referencing specific lines, use highlight_lines and highlight_range in your JSON response.
Keep your answer focused on the follow-up question.`;

    const result = await llmClient.explain(followUpSystem, historyPrompt, onChunk);

    // Store the full response text as assistant message
    const fullNarration = result.segments.map((s) => s.narration).join(" ");
    this.addAssistantMessage(fullNarration);

    return result;
  }

  hasHistory(): boolean {
    return this.messages.length > 1;
  }

  private trimHistory() {
    // Keep system context (first message) + last MAX_TURNS exchanges
    if (this.messages.length > MAX_TURNS * 2 + 1) {
      const first = this.messages[0];
      this.messages = [first, ...this.messages.slice(-(MAX_TURNS * 2))];
    }
  }
}
