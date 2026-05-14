import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { Session, User } from "@supabase/supabase-js";
import { toast } from "sonner";

interface AuthCtx {
  user: User | null;
  session: Session | null;
  loading: boolean;
  signOut: () => Promise<void>;
}

const Ctx = createContext<AuthCtx>({ user: null, session: null, loading: true, signOut: async () => {} });

const PUBLIC_PATHS = new Set(["/", "/login", "/reset-password", "/pricing", "/contact", "/privacy", "/terms", "/responsible-gambling"]);

function redirectToLoginIfProtected(reason: "expired" | "signed_out") {
  if (typeof window === "undefined") return;
  const path = window.location.pathname;
  if (PUBLIC_PATHS.has(path)) return;
  if (reason === "expired") {
    toast.error("Your session has expired. Please sign in again.");
  }
  const next = encodeURIComponent(path + window.location.search);
  window.location.replace(`/login?redirect=${next}`);
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const hadSession = useRef(false);

  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
      setSession(s);
      setLoading(false);

      if (event === "SIGNED_IN" || event === "TOKEN_REFRESHED" || event === "INITIAL_SESSION") {
        if (s) hadSession.current = true;
      }
      if (event === "SIGNED_OUT") {
        const wasSignedIn = hadSession.current;
        hadSession.current = false;
        if (wasSignedIn) redirectToLoginIfProtected("signed_out");
      }
    });

    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      if (data.session) hadSession.current = true;
      setLoading(false);
    });

    // Periodic session-validity check: if access_token expired and refresh
    // failed silently, force a clean re-auth instead of silent 401s.
    const interval = window.setInterval(async () => {
      const { data } = await supabase.auth.getSession();
      const expiresAt = data.session?.expires_at;
      if (hadSession.current && (!data.session || (expiresAt && expiresAt * 1000 < Date.now()))) {
        hadSession.current = false;
        await supabase.auth.signOut().catch(() => {});
        redirectToLoginIfProtected("expired");
      }
    }, 60_000);

    return () => {
      sub.subscription.unsubscribe();
      window.clearInterval(interval);
    };
  }, []);

  return (
    <Ctx.Provider
      value={{
        user: session?.user ?? null,
        session,
        loading,
        signOut: async () => { await supabase.auth.signOut(); },
      }}
    >
      {children}
    </Ctx.Provider>
  );
}

export const useAuth = () => useContext(Ctx);
