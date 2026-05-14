// AI Provider Abstraction Layer (Phase 2 skeleton)
//
// Goal: keep the rest of the codebase agnostic of which AI vendor is in use,
// so we can later switch between Lovable AI Gateway, OpenAI direct, Claude,
// Gemini direct, Groq, Together AI, etc. without touching analysis logic.

export type AIRole = "system" | "user" | "assistant";

export interface AIMessage {
  role: AIRole;
  content: string;
}

export interface AIToolDefinition {
  name: string;
  description?: string;
  // JSON Schema for the tool's parameters (structured output).
  parameters: Record<string, unknown>;
}

export interface AIRequest {
  // Logical model id, e.g. "fast", "balanced", "deep".
  // Each provider maps it to a concrete vendor model.
  tier?: "fast" | "balanced" | "deep";
  messages: AIMessage[];
  // When set, the provider MUST call this tool (forced structured output).
  tool?: AIToolDefinition;
  // Hard cap in milliseconds. Default 30s.
  timeoutMs?: number;
  // Optional vendor-specific override of model id.
  modelOverride?: string;
}

export interface AIUsage {
  tokensIn?: number;
  tokensOut?: number;
  costCents?: number;
}

export interface AIResponse {
  // Parsed structured output from the forced tool call.
  data: unknown;
  // Raw text content if no tool was used (rare).
  text?: string;
  provider: string;
  model: string;
  usage?: AIUsage;
  finishReason?: string;
}

export interface AIProvider {
  id: string;
  // Returns true when the necessary credentials/env are present.
  isAvailable(): boolean;
  // Maps a logical tier to a concrete model id for this provider.
  modelForTier(tier: AIRequest["tier"]): string;
  // Performs the chat-completion call.
  generate(req: AIRequest): Promise<AIResponse>;
}

export class AIProviderError extends Error {
  constructor(
    message: string,
    public readonly provider: string,
    public readonly status?: number,
    public readonly retryable: boolean = false,
  ) {
    super(message);
    this.name = "AIProviderError";
  }
}
