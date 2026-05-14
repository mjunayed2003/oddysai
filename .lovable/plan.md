# OddysAI — Scalability & AI Cost Optimization Plan

Goal: prepare OddysAI to handle thousands of analyses/day at low cost, without breaking the current launch. Lovable stays for frontend, deploy, UI, orchestration. AI generation becomes pluggable and reusable.

The current code already has good foundations:
- `analyses` table caches per `match_id` (TTL 30min in `ai-analysis.functions.ts`)
- In-memory Worker cache in `src/routes/api/analyze-match.ts` (60s live / 10min pre-match)
- `consume_ai_quota` RPC for hourly safety caps
- Single AI entry point in `src/lib/ai-analysis.server.ts`

We build on these — no rewrite, no breaking changes.

---

## Phase 1 — Shared analyses (1 generation per fixture, reused by everyone)

Today: cache is keyed on `match_id` but bound to 30 min and not aware of odds/lineup changes. Each user's request can still trigger a new AI call if cache expired.

Changes:
1. Add columns to `analyses`: `odds_fingerprint text`, `lineup_fingerprint text`, `generated_by text` (provider id), `model text`, `tokens_in int`, `tokens_out int`, `cost_cents int`, `expires_at timestamptz`.
2. Lookup logic: select latest row where `match_id = ?` AND `odds_fingerprint = ?` AND `expires_at > now()`. If found → return to ALL users (no AI call, no quota burn).
3. TTL strategy:
   - pre-match (>2h to kickoff): 6h
   - pre-match (<2h): 30 min
   - live: 60s
4. Single-flight: when a fixture has no fresh analysis, only the FIRST request runs the AI; concurrent requests wait on the same Promise (Worker isolate) and DB row-lock fallback (`pg_advisory_xact_lock` on `match_id`). Eliminates thundering-herd duplicate generations.

Effect: with N users analyzing the same hot match, AI runs once instead of N times.

---

## Phase 2 — AI provider abstraction layer

Create `src/lib/ai/` with a clean interface, so swapping providers is a one-line change.

```text
src/lib/ai/
  types.ts          # AIProvider interface, AIRequest, AIResponse
  router.ts         # picks provider by env/feature flag, handles fallback chain
  providers/
    lovable.ts      # current Lovable AI Gateway impl (default)
    openai.ts       # direct OpenAI (uses OPENAI_API_KEY already in secrets)
    anthropic.ts    # Claude
    gemini.ts       # Google direct
    groq.ts         # Groq (cheap, fast)
    together.ts     # Together AI (open-source models)
```

Interface:
```ts
interface AIProvider {
  id: string;
  generate(req: AIRequest): Promise<AIResponse>; // structured output via tool calls
  estimateCostCents(req: AIRequest): number;
}
```

Router rules:
- Primary provider from `AI_PRIMARY_PROVIDER` env (default `lovable`).
- Fallback chain from `AI_FALLBACK_CHAIN` (e.g. `lovable,groq,openai`).
- On 429/402/5xx → try next provider, log to `api_usage` with `cost`, `provider`, `model`.
- Per-provider circuit breaker (skip provider for 60s after 3 consecutive failures).

`runMatchAnalysis` in `ai-analysis.server.ts` calls `aiRouter.generate(...)` instead of Lovable directly. Zero change to the rest of the pipeline.

---

## Phase 3 — Long-term caching layer

Today: in-memory Map per Worker isolate (lost on cold start, not shared across regions).

Add a `CacheStore` abstraction with two implementations:
1. `db` (default, works today) — uses the `analyses` table.
2. `kv` (future) — Cloudflare KV or Upstash Redis when we need it.

```ts
interface CacheStore {
  get(key: string): Promise<unknown | null>;
  set(key: string, value: unknown, ttlSec: number): Promise<void>;
  invalidate(pattern: string): Promise<void>;
}
```

Cache keys: `analysis:{matchId}:{oddsFp}:{lineupFp}`.
Invalidation triggers (next phase): odds delta >5%, lineup published, match status change.

---

## Phase 4 — Scheduled pre-generation

New cron route `src/routes/api/public/hooks/pregenerate-analyses.ts` (called every 15 min via `pg_cron` + `pg_net`):
- Pull fixtures starting in next 6h from Sportmonks.
- For each: check cache — if missing or stale, generate now using the cheapest provider (`groq` or `gemini-flash`).
- Result: by the time users open hot matches, analysis is already cached. Zero perceived latency, zero peak-hour spikes.

Budget cap: max N pre-generations per cron run (env-tunable, default 50) to control spend.

---

## Phase 5 — Cost & observability

- New table `ai_generations`: `provider`, `model`, `match_id`, `tokens_in`, `tokens_out`, `cost_cents`, `latency_ms`, `cached` boolean, `created_at`. Lets us answer "what did AI cost yesterday, by provider, by match".
- Admin dashboard widget (later) showing daily AI spend, cache hit rate, provider mix.

---

## Implementation order (incremental, non-breaking)

1. **Now (this PR if approved):** Phase 1 (shared analyses) + Phase 2 skeleton (provider interface + Lovable provider only). No behavior change for users; AI calls drop sharply for hot matches.
2. **Next:** add OpenAI + Groq providers + router fallback. Flip `AI_PRIMARY_PROVIDER=groq` for cheap models, keep Lovable as fallback.
3. **Later:** Phase 3 KV cache when traffic justifies it.
4. **Later:** Phase 4 pre-generation cron.
5. **Ongoing:** Phase 5 cost tracking from day one of Phase 2.

---

## What does NOT change
- Frontend, routes, auth, payments, RLS, Stripe flow.
- Existing `analyses` table contents (only additive columns).
- Existing rate-limit / unlock / subscription gating in `analyze-match.ts` and `ai-analysis.functions.ts`.
- Current Lovable AI is still the default provider — production stays on the path it's on today.

---

## Decisions needed from you before I start coding

1. **Start point** — do I implement Phase 1 + Phase 2 skeleton now, or just Phase 1 first?
2. **Cheap-model preference** — for the future fallback chain, priority order? (My suggestion: `groq/llama-3.3-70b` → `gemini-2.5-flash` → `openai/gpt-5-mini` → Lovable.)
3. **Pre-generation budget** — comfortable with ~50 fixtures pre-analyzed per 15 min window when we get to Phase 4?
