import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { BrandLogo } from "@/components/brand";
import { PasswordStrengthMeter, evaluatePassword } from "@/components/password-strength";
import { TurnstileWidget } from "@/components/turnstile-widget";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";

export const Route = createFileRoute("/reset-password")({
  head: () => ({ meta: [{ title: "Reset password — OddysAI" }] }),
  component: ResetPasswordPage,
});

function ResetPasswordPage() {
  const navigate = useNavigate();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [ready, setReady] = useState(false);
  const [captcha, setCaptcha] = useState<string | null>(null);

  useEffect(() => {
    // Supabase places the recovery session in the URL hash and exchanges it on load.
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY" || event === "SIGNED_IN") setReady(true);
    });
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) setReady(true);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (password !== confirm) return toast.error("Passwords do not match");
    if (evaluatePassword(password).score < 2)
      return toast.error("Please choose a stronger password");
    void captcha;
    setLoading(true);
    const { error } = await supabase.auth.updateUser({ password });
    setLoading(false);
    if (error) return toast.error(error.message);
    toast.success("Password updated");
    navigate({ to: "/dashboard" });
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-4 bg-grid">
      <div className="absolute inset-0 bg-hero pointer-events-none" />
      <div className="relative w-full max-w-md">
        <div className="text-center mb-6">
          <BrandLogo className="justify-center" />
        </div>
        <div className="glass rounded-2xl p-6 shadow-elevated">
          <h1 className="font-display text-xl font-semibold mb-1">Set a new password</h1>
          <p className="text-sm text-muted-foreground mb-5">
            {ready
              ? "Choose a new password for your account."
              : "Validating your reset link..."}
          </p>
          <form onSubmit={onSubmit} className="space-y-4">
            <div>
              <Label htmlFor="np">New password</Label>
              <Input
                id="np"
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="mt-1"
                disabled={!ready}
              />
              <PasswordStrengthMeter password={password} />
            </div>
            <div>
              <Label htmlFor="cp">Confirm password</Label>
              <Input
                id="cp"
                type="password"
                required
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                className="mt-1"
                disabled={!ready}
              />
            </div>
            {ready && <TurnstileWidget onVerify={setCaptcha} onExpire={() => setCaptcha(null)} />}
            <Button
              type="submit"
              disabled={loading || !ready}
              className="w-full bg-gradient-primary text-primary-foreground"
            >
              {loading && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              Update password
            </Button>
          </form>
        </div>
      </div>
    </div>
  );
}
