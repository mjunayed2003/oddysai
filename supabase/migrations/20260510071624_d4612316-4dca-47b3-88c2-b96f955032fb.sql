
-- Security audit trail: append-only log of security-relevant user actions.
CREATE TABLE IF NOT EXISTS public.security_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid,
  action text NOT NULL,
  target text,
  ip_hash text,
  user_agent text,
  meta jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS security_audit_log_user_idx ON public.security_audit_log (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS security_audit_log_action_idx ON public.security_audit_log (action, created_at DESC);

ALTER TABLE public.security_audit_log ENABLE ROW LEVEL SECURITY;

-- Only admins can read the audit trail. Writes are server-side only (service role).
CREATE POLICY security_audit_log_admin_select ON public.security_audit_log
  FOR SELECT TO authenticated
  USING (private.has_role(auth.uid(), 'admin'::app_role));

-- Lock down all client-side writes; the table is append-only via service role.
REVOKE INSERT, UPDATE, DELETE ON public.security_audit_log FROM anon, authenticated;
