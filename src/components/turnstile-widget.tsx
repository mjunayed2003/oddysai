import { useEffect, useState } from "react";
import { Turnstile } from "@marsidev/react-turnstile";
import { useServerFn } from "@tanstack/react-start";
import { getPublicConfig } from "@/lib/public-config.functions";

interface Props {
  onVerify: (token: string) => void;
  onExpire?: () => void;
}

export function TurnstileWidget({ onVerify, onExpire }: Props) {
  const fetchConfig = useServerFn(getPublicConfig);
  const [siteKey, setSiteKey] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchConfig()
      .then((c) => {
        if (cancelled) return;
        setSiteKey(c.turnstileSiteKey ?? null);
      })
      .catch(() => {
        if (!cancelled) setSiteKey(null);
      });
    return () => {
      cancelled = true;
    };
  }, [fetchConfig]);

  // If no site key is configured, fall back to auto-pass so the form still works.
  useEffect(() => {
    if (siteKey === null) return;
    if (siteKey === "") onVerify("disabled");
  }, [siteKey, onVerify]);

  if (!siteKey) return null;

  return (
    <Turnstile
      siteKey={siteKey}
      onSuccess={(token: string) => onVerify(token)}
      onExpire={() => onExpire?.()}
      options={{ theme: "dark", size: "flexible" }}
    />
  );
}
