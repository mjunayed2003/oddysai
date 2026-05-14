// Lovable AI Gateway provider — wraps the current Lovable / OpenAI fetch path
// behind the AIProvider interface. Behavior matches today's runMatchAnalysis.
import type { AIProvider, AIRequest, AIResponse } from "../types";
import { AIProviderError } from "../types";

const GATEWAY_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";
const OPENAI_URL = "https://api.openai.com/v1/chat/completions";

const TIER_TO_MODEL_GATEWAY: Record<NonNullable<AIRequest["tier"]>, string> = {
  fast: "google/gemini-3-flash-preview",
  balanced: "google/gemini-2.5-flash",
  deep: "google/gemini-2.5-pro",
};

const TIER_TO_MODEL_OPENAI: Record<NonNullable<AIRequest["tier"]>, string> = {
  fast: "gpt-4o-mini",
  balanced: "gpt-4o-mini",
  deep: "gpt-4o",
};

export class LovableProvider implements AIProvider {
  id = "lovable";

  isAvailable() {
    return !!(process.env.LOVABLE_API_KEY || process.env.OPENAI_API_KEY);
  }

  private useGateway() {
    return !!process.env.LOVABLE_API_KEY;
  }

  modelForTier(tier: AIRequest["tier"] = "fast"): string {
    return this.useGateway() ? TIER_TO_MODEL_GATEWAY[tier] : TIER_TO_MODEL_OPENAI[tier];
  }

  async generate(req: AIRequest): Promise<AIResponse> {
    const apiKey = process.env.LOVABLE_API_KEY ?? process.env.OPENAI_API_KEY;
    if (!apiKey) throw new AIProviderError("AI key not configured", this.id, undefined, false);

    const useGw = this.useGateway();
    const model = req.modelOverride ?? this.modelForTier(req.tier);
    const url = useGw ? GATEWAY_URL : OPENAI_URL;

    const body: Record<string, unknown> = {
      model,
      messages: req.messages,
    };
    if (req.tool) {
      body.tools = [{
        type: "function",
        function: {
          name: req.tool.name,
          description: req.tool.description,
          parameters: req.tool.parameters,
        },
      }];
      body.tool_choice = { type: "function", function: { name: req.tool.name } };
    }

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), req.timeoutMs ?? 30_000);

    let res: Response;
    try {
      res = await fetch(url, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: ctrl.signal,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new AIProviderError(
        msg.includes("abort") ? "AI request timed out" : `AI fetch failed: ${msg}`,
        this.id,
        undefined,
        true,
      );
    } finally {
      clearTimeout(timer);
    }

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      const retryable = res.status === 429 || res.status === 502 || res.status === 503 || res.status === 504;
      throw new AIProviderError(
        `AI gateway error ${res.status}: ${text.slice(0, 300)}`,
        this.id,
        res.status,
        retryable,
      );
    }

    const json = await res.json() as {
      choices?: Array<{
        finish_reason?: string;
        message: { tool_calls?: Array<{ function: { name: string; arguments: string } }>; content?: string };
      }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };

    const choice = json.choices?.[0];
    const call = choice?.message?.tool_calls?.[0];
    let parsed: unknown = null;
    let textContent: string | undefined = choice?.message?.content;

    if (call?.function.arguments) {
      try { parsed = JSON.parse(call.function.arguments); }
      catch (e) {
        throw new AIProviderError(
          `Malformed tool-call JSON: ${e instanceof Error ? e.message : e}`,
          this.id,
          undefined,
          false,
        );
      }
    }

    return {
      data: parsed,
      text: textContent,
      provider: this.id,
      model,
      finishReason: choice?.finish_reason,
      usage: {
        tokensIn: json.usage?.prompt_tokens,
        tokensOut: json.usage?.completion_tokens,
      },
    };
  }
}
