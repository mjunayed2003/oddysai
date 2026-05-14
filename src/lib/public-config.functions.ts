import { createServerFn } from "@tanstack/react-start";

export const getPublicConfig = createServerFn({ method: "GET" }).handler(async () => {
  return {
    turnstileSiteKey: process.env.TURNSTILE_SITE_KEY ?? "",
    sentryDsn: process.env.SENTRY_DSN ?? "",
  };
});
