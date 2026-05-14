export type PlanTier = "free" | "basic" | "pro" | "elite";
export type RiskLevel = "low" | "medium" | "high";
export type ValueSignal = "none" | "low" | "moderate" | "strong";
export type DataQuality = "low" | "medium" | "high";
export type MarketEfficiency = "efficient" | "slightly_mispriced" | "potentially_inefficient";

export interface AIAnalysisResult {
  matchId: string;
  summary: string;
  formAnalysis: string;
  injuriesImpact: string;
  motivation: string;
  h2hSummary: string;
  oddsMovement: string;
  bestMarket: string;
  probHome: number;
  probDraw: number;
  probAway: number;
  confidence: number; // 1-100
  risk: RiskLevel;
  valueBet: boolean;
  suggestedStakePct: number;
  suggestedStakeAmount: number;
  reasoning: string;
  warning: string;
  // New rich fields (optional for backward compatibility with cached rows)
  tacticalAngle?: string;
  homeAwayAnalysis?: string;
  valueSignal?: ValueSignal;
  /** Legacy plain string list (kept for old cached rows). */
  suggestedMarkets?: string[];
  /** Structured market suggestions: name + reason + risk + confidence. */
  suggestedMarketsDetailed?: SuggestedMarket[];
  /** Explicit list of data sources that were unavailable for this fixture. */
  missingData?: string[];
  dataQuality?: DataQuality;
  /** Did key market verification sources (injuries, cross-book odds snapshot) make it into the analysis? */
  marketVerification?: "full" | "partial" | "limited";
  /** How efficient the market price looks vs the model. */
  marketEfficiency?: MarketEfficiency;
  responsibleNote?: string;
  cached?: boolean;
  cachedAt?: string;
  fallback?: boolean;
  /** Verified-data layer surfaced to the UI. Populated when SportMonks (or any
   *  premium source) successfully enriched this fixture. */
  dataSources?: {
    sportMonks?: {
      enriched: boolean;
      contributed: Array<"odds" | "h2h" | "venue" | "lineups" | "injuries" | "prediction">;
      prediction?: { home: number | null; draw: number | null; away: number | null } | null;
      venue?: { name: string; city: string | null } | null;
      lineups?: Array<{ team: string; formation: string | null; starters: number }>;
      injuries?: { home: string[]; away: string[] };
    };
  };
}

export interface SuggestedMarket {
  market: string;
  reason: string;
  risk: RiskLevel;
  confidence: number; // 1-100
}


export const PLAN_LABELS: Record<PlanTier, string> = {
  free: "Free",
  basic: "Basic",
  pro: "Pro",
  elite: "Elite",
};

export const PLAN_RANK: Record<PlanTier, number> = {
  free: 0,
  basic: 1,
  pro: 2,
  elite: 3,
};

export function hasPlanAccess(current: PlanTier, required: PlanTier): boolean {
  return PLAN_RANK[current] >= PLAN_RANK[required];
}
