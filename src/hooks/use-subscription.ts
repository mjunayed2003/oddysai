// Subscription system has been removed in favor of one-time analysis unlocks.
// This stub keeps any lingering imports compiling but always reports a free,
// inactive state. Feature gating now happens via per-match analysis_unlocks rows.
import type { PlanTier } from "@/lib/types";

export function useSubscription() {
  return {
    subscription: null as null,
    plan: "free" as PlanTier,
    isActive: false,
    canAccess: (_required: PlanTier) => false,
    loading: false,
    refetch: async () => {},
  };
}
