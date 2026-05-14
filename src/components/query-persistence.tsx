import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { persistQueryClient } from "@tanstack/react-query-persist-client";
import { createSyncStoragePersister } from "@tanstack/query-sync-storage-persister";

const CACHE_KEY = "oddysai-query-cache-v4";
// Persist for 24h — covers AI analysis (server TTL 30min) plus general queries
const MAX_AGE = 24 * 60 * 60 * 1000;

// Only persist queries that are safe + valuable to keep across reloads.
const PERSISTED_PREFIXES = ["ai-analysis", "fixtures-upcoming", "matches-all", "ai-preview-usage", "bankroll"];

export function QueryPersistence() {
  const queryClient = useQueryClient();
  useEffect(() => {
    if (typeof window === "undefined") return;
    const persister = createSyncStoragePersister({
      storage: window.localStorage,
      key: CACHE_KEY,
      throttleTime: 1000,
    });
    const [unsubscribe] = persistQueryClient({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      queryClient: queryClient as any,
      persister,
      maxAge: MAX_AGE,
      dehydrateOptions: {
        shouldDehydrateQuery: (q) => {
          if (q.state.status !== "success") return false;
          const root = Array.isArray(q.queryKey) ? String(q.queryKey[0] ?? "") : String(q.queryKey);
          return PERSISTED_PREFIXES.includes(root);
        },
      },
    });
    return () => unsubscribe();
  }, [queryClient]);
  return null;
}
