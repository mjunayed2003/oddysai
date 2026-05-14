// AI Router — picks a provider, walks the fallback chain, applies a simple
// in-isolate circuit breaker. Future providers (OpenAI direct, Anthropic,
// Gemini direct, Groq, Together) plug in here without touching call sites.
import type { AIProvider, AIRequest, AIResponse } from "./types";
import { AIProviderError } from "./types";
import { LovableProvider } from "./providers/lovable";

const PROVIDERS: Record<string, AIProvider> = {
  lovable: new LovableProvider(),
  // openai: new OpenAIProvider(),     // future
  // anthropic: new AnthropicProvider(),
  // gemini: new GeminiProvider(),
  // groq: new GroqProvider(),
  // together: new TogetherProvider(),
};

// Simple per-isolate circuit breaker: skip a provider for `cooldownMs`
// after `threshold` consecutive failures. Resets on success.
type BreakerState = { failures: number; openedAt: number };
const breakers = new Map<string, BreakerState>();
const BREAKER_THRESHOLD = 3;
const BREAKER_COOLDOWN_MS = 60_000;

function isBreakerOpen(id: string) {
  const s = breakers.get(id);
  if (!s) return false;
  if (s.failures < BREAKER_THRESHOLD) return false;
  if (Date.now() - s.openedAt > BREAKER_COOLDOWN_MS) {
    breakers.delete(id);
    return false;
  }
  return true;
}

function recordSuccess(id: string) {
  breakers.delete(id);
}

function recordFailure(id: string) {
  const s = breakers.get(id) ?? { failures: 0, openedAt: 0 };
  s.failures += 1;
  if (s.failures >= BREAKER_THRESHOLD) s.openedAt = Date.now();
  breakers.set(id, s);
}

function chain(): string[] {
  const primary = (process.env.AI_PRIMARY_PROVIDER ?? "lovable").trim();
  const extras = (process.env.AI_FALLBACK_CHAIN ?? "")
    .split(",").map((s) => s.trim()).filter(Boolean);
  // De-dupe, preserve order, primary first.
  const seen = new Set<string>();
  return [primary, ...extras].filter((id) => {
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

export async function generate(req: AIRequest): Promise<AIResponse> {
  const order = chain();
  let lastErr: unknown = null;
  for (const id of order) {
    const provider = PROVIDERS[id];
    if (!provider || !provider.isAvailable() || isBreakerOpen(id)) continue;
    try {
      const out = await provider.generate(req);
      recordSuccess(id);
      return out;
    } catch (err) {
      recordFailure(id);
      lastErr = err;
      const retryable = err instanceof AIProviderError ? err.retryable : true;
      if (!retryable) throw err;
      // Fall through to next provider.
      console.warn(`[ai-router] provider ${id} failed (${err instanceof Error ? err.message : err}) — trying next`);
    }
  }
  if (lastErr instanceof Error) throw lastErr;
  throw new AIProviderError("No AI provider available", "router", undefined, false);
}

export const aiRouter = { generate };
