import { useEffect } from "react";
import * as Sentry from "@sentry/react";
import { useServerFn } from "@tanstack/react-start";
import { getPublicConfig } from "@/lib/public-config.functions";

let initialized = false;

/**
 * Initializes Sentry only when SENTRY_DSN is a real, well-formed Sentry DSN.
 * Empty / placeholder values like "your-dsn-here" are silently skipped so
 * the app never crashes due to bad telemetry config.
 */
function isValidDsn(dsn: string | null | undefined): dsn is string {
  if (!dsn) return false;
  const trimmed = dsn.trim();
  if (trimmed.length < 20) return false;
  if (/placeholder|pending|your[-_]dsn|example|todo|xxx+/i.test(trimmed)) return false;
  try {
    const u = new URL(trimmed);
    if (u.protocol !== "https:") return false;
    if (!/sentry\.io$|ingest\.[\w.-]+sentry\.io$/.test(u.hostname)) return false;
    if (!u.username) return false; // public key is the URL username
    if (!u.pathname || u.pathname === "/") return false; // project id required
    return true;
  } catch {
    return false;
  }
}

export function SentryInit() {
  const fetchConfig = useServerFn(getPublicConfig);

  useEffect(() => {
    if (initialized || typeof window === "undefined") return;
    fetchConfig().then((cfg) => {
      if (initialized) return;
      if (!isValidDsn(cfg.sentryDsn)) {
        if (import.meta.env.DEV) console.info("[Sentry] DSN missing or placeholder — skipping init");
        return;
      }
      Sentry.init({
        dsn: cfg.sentryDsn,
        tracesSampleRate: 0.1,
        replaysSessionSampleRate: 0,
        replaysOnErrorSampleRate: 1.0,
        environment: import.meta.env.MODE,
      });
      initialized = true;
    }).catch(() => {});
  }, [fetchConfig]);

  return null;
}
