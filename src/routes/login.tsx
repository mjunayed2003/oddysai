import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Checkbox } from "@/components/ui/checkbox";
import { BrandLogo } from "@/components/brand";
import { PasswordStrengthMeter } from "@/components/password-strength";
import { TurnstileWidget } from "@/components/turnstile-widget";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSlot,
  InputOTPSeparator,
} from "@/components/ui/input-otp";

export const Route = createFileRoute("/login")({
  head: () => ({ meta: [{ title: "Sign in — OddysAI" }, { name: "description", content: "Sign in or create your OddysAI account." }] }),
  component: LoginPage,
});

function LoginPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [tab, setTab] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [promoCode, setPromoCode] = useState("");
  const [age18, setAge18] = useState(false);
  const [loading, setLoading] = useState(false);
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);

  // Forgot password state
  const [forgotOpen, setForgotOpen] = useState(false);
  const [forgotEmail, setForgotEmail] = useState("");
  const [forgotLoading, setForgotLoading] = useState(false);
  const [forgotCaptcha, setForgotCaptcha] = useState<string | null>(null);

  // Resend verification state
  const [resendOpen, setResendOpen] = useState(false);
  const [resendEmail, setResendEmail] = useState("");
  const [resendLoading, setResendLoading] = useState(false);
  const [resendCaptcha, setResendCaptcha] = useState<string | null>(null);

  // OTP verification state (after signup)
  const [otpOpen, setOtpOpen] = useState(false);
  const [otpEmail, setOtpEmail] = useState("");
  const [otpCode, setOtpCode] = useState("");
  const [otpLoading, setOtpLoading] = useState(false);
  const [otpResending, setOtpResending] = useState(false);

  async function onResendVerification(e: React.FormEvent) {
    e.preventDefault();
    if (!resendEmail) return toast.error("Enter your email address");
    if (!resendCaptcha) return toast.error("Please complete the security check.");
    setResendLoading(true);
    const { error } = await supabase.auth.resend({
      type: "signup",
      email: resendEmail,
      options: {
        emailRedirectTo: window.location.origin,
        captchaToken: resendCaptcha === "disabled" ? undefined : resendCaptcha,
      },
    });
    setResendLoading(false);
    if (error) return toast.error(error.message);
    toast.success("If that account needs verification, a new code is on its way.");
    setResendOpen(false);
    setResendEmail("");
    setResendCaptcha(null);
    // Open OTP dialog so the user can paste the new code immediately.
    setOtpEmail(resendEmail);
    setOtpCode("");
    setOtpOpen(true);
  }

  async function onVerifyOtp(e?: React.FormEvent) {
    e?.preventDefault();
    if (otpCode.length !== 8) return toast.error("Enter the 8-digit code from your email");
    setOtpLoading(true);
    const { error } = await supabase.auth.verifyOtp({
      email: otpEmail,
      token: otpCode,
      type: "email",
    });
    setOtpLoading(false);
    if (error) return toast.error(error.message);
    toast.success("Email verified. Welcome!");
    setOtpOpen(false);
    navigate({ to: "/dashboard" });
  }

  async function onResendOtp() {
    if (!otpEmail) return;
    setOtpResending(true);
    const { error } = await supabase.auth.resend({
      type: "signup",
      email: otpEmail,
      options: { emailRedirectTo: window.location.origin },
    });
    setOtpResending(false);
    if (error) return toast.error(error.message);
    toast.success("New code sent. Check your inbox.");
  }

  useEffect(() => { if (user) navigate({ to: "/dashboard" }); }, [user, navigate]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const ref = params.get("ref");
    const t = params.get("tab");
    if (ref) setPromoCode(ref.toUpperCase());
    if (t === "signup" || ref) setTab("signup");
    // Track the affiliate click once per browser session per code.
    if (ref) {
      const key = `aff_click_${ref.toUpperCase()}`;
      if (!sessionStorage.getItem(key)) {
        sessionStorage.setItem(key, "1");
        supabase.rpc("track_affiliate_click", {
          _code: ref.toUpperCase(),
          _user_agent: navigator.userAgent.slice(0, 256),
        }).then(({ error }) => { if (error) console.warn("affiliate click track failed", error.message); });
      }
    }
  }, []);

  async function onSignIn(e: React.FormEvent) {
    e.preventDefault();
    if (!captchaToken) return toast.error("Please complete the security check.");
    setLoading(true);
    const { error } = await supabase.auth.signInWithPassword({
      email, password,
      options: { captchaToken: captchaToken === "disabled" ? undefined : captchaToken },
    });
    setLoading(false);
    if (error) {
      if (/confirm/i.test(error.message)) {
        // Email not confirmed yet → prompt for OTP code instead.
        setOtpEmail(email);
        setOtpCode("");
        setOtpOpen(true);
        toast.message("Verify your email to sign in", {
          description: "Enter the verification code we sent to your inbox.",
        });
        return;
      }
      return toast.error(error.message);
    }
    toast.success("Welcome back");
    navigate({ to: "/dashboard" });
  }

  async function onSignUp(e: React.FormEvent) {
    e.preventDefault();
    if (!age18) return toast.error("You must confirm you are 18+ to use OddysAI.");
    if (!captchaToken) return toast.error("Please complete the security check.");
    setLoading(true);
    const { data, error } = await supabase.auth.signUp({
      email, password,
      options: {
        emailRedirectTo: window.location.origin,
        data: { display_name: name, promo_code: promoCode.trim().toUpperCase() || null },
        captchaToken: captchaToken === "disabled" ? undefined : captchaToken,
      },
    });
    setLoading(false);
    if (error) return toast.error(error.message);
    // If email confirmation is required, Supabase returns no session → ask for OTP.
    if (!data.session) {
      setOtpEmail(email);
      setOtpCode("");
      setOtpOpen(true);
      toast.success("Check your email for the verification code.");
      return;
    }
    toast.success("Account created. You're in.");
    navigate({ to: "/dashboard" });
  }

  async function onForgotPassword(e: React.FormEvent) {
    e.preventDefault();
    if (!forgotEmail) return toast.error("Enter your email address");
    if (!forgotCaptcha) return toast.error("Please complete the security check.");
    setForgotLoading(true);
    const { error } = await supabase.auth.resetPasswordForEmail(forgotEmail, {
      redirectTo: `${window.location.origin}/reset-password`,
      captchaToken: forgotCaptcha === "disabled" ? undefined : forgotCaptcha,
    });
    setForgotLoading(false);
    if (error) return toast.error(error.message);
    toast.success("If that email exists, a reset link is on its way.");
    setForgotOpen(false);
    setForgotEmail("");
    setForgotCaptcha(null);
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-4 bg-grid">
      <div className="absolute inset-0 bg-hero pointer-events-none" />
      <div className="relative w-full max-w-md">
        <div className="text-center mb-6">
          <BrandLogo className="justify-center" />
        </div>
        <div className="glass rounded-2xl p-6 shadow-elevated">
          <Tabs value={tab} onValueChange={(v) => setTab(v as "signin" | "signup")}>
            <TabsList className="grid grid-cols-2 w-full">
              <TabsTrigger value="signin">Sign in</TabsTrigger>
              <TabsTrigger value="signup">Create account</TabsTrigger>
            </TabsList>

            <TabsContent value="signin" className="mt-5">
              <form onSubmit={onSignIn} className="space-y-4">
                <div>
                  <Label htmlFor="e1">Email</Label>
                  <Input id="e1" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} className="mt-1" />
                </div>
                <div>
                  <div className="flex items-center justify-between">
                    <Label htmlFor="p1">Password</Label>
                    <button
                      type="button"
                      onClick={() => { setForgotEmail(email); setForgotOpen(true); }}
                      className="text-xs text-primary hover:underline"
                    >
                      Forgot password?
                    </button>
                  </div>
                  <Input id="p1" type="password" required value={password} onChange={(e) => setPassword(e.target.value)} className="mt-1" />
                  <PasswordStrengthMeter password={password} />
                </div>
                <TurnstileWidget onVerify={setCaptchaToken} onExpire={() => setCaptchaToken(null)} />
                <Button type="submit" disabled={loading} className="w-full bg-gradient-primary text-primary-foreground">
                  {loading && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                  Sign in
                </Button>
                <p className="text-center text-xs text-muted-foreground">
                  Didn't receive the verification email?{" "}
                  <button
                    type="button"
                    onClick={() => { setResendEmail(email); setResendOpen(true); }}
                    className="text-primary hover:underline"
                  >
                    Resend it
                  </button>
                </p>
              </form>
            </TabsContent>

            <TabsContent value="signup" className="mt-5">
              <form onSubmit={onSignUp} className="space-y-4">
                <div>
                  <Label htmlFor="n">Display name</Label>
                  <Input id="n" required value={name} onChange={(e) => setName(e.target.value)} className="mt-1" />
                </div>
                <div>
                  <Label htmlFor="e2">Email</Label>
                  <Input id="e2" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} className="mt-1" />
                </div>
                <div>
                  <Label htmlFor="p2">Password</Label>
                  <Input id="p2" type="password" required value={password} onChange={(e) => setPassword(e.target.value)} className="mt-1" />
                  <PasswordStrengthMeter password={password} />
                </div>
                <div>
                  <Label htmlFor="promo">Promo code <span className="text-muted-foreground font-normal">(optional)</span></Label>
                  <Input
                    id="promo"
                    value={promoCode}
                    onChange={(e) => setPromoCode(e.target.value.toUpperCase())}
                    placeholder="Enter code"
                    maxLength={32}
                    className="mt-1 uppercase tracking-wider"
                  />
                </div>
                <label className="flex items-start gap-2 text-sm text-muted-foreground">
                  <Checkbox checked={age18} onCheckedChange={(c) => setAge18(!!c)} className="mt-0.5" />
                  <span>I confirm I am 18+ and accept the <Link to="/terms" className="text-primary hover:underline">Terms</Link> and <Link to="/responsible-gambling" className="text-primary hover:underline">Responsible Gambling policy</Link>.</span>
                </label>
                <TurnstileWidget onVerify={setCaptchaToken} onExpire={() => setCaptchaToken(null)} />
                <Button type="submit" disabled={loading} className="w-full bg-gradient-primary text-primary-foreground">
                  {loading && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                  Create account
                </Button>
                <p className="text-center text-xs text-muted-foreground">
                  Didn't receive the verification email?{" "}
                  <button
                    type="button"
                    onClick={() => { setResendEmail(email); setResendOpen(true); }}
                    className="text-primary hover:underline"
                  >
                    Resend it
                  </button>
                </p>
              </form>
            </TabsContent>
          </Tabs>
        </div>
        <p className="mt-4 text-center text-xs text-muted-foreground">
          <Link to="/" className="hover:text-foreground">← Back to home</Link>
        </p>
      </div>

      <Dialog open={forgotOpen} onOpenChange={setForgotOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Reset your password</DialogTitle>
            <DialogDescription>
              Enter the email associated with your account and we'll send you a secure reset link.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={onForgotPassword} className="space-y-4">
            <div>
              <Label htmlFor="fe">Email</Label>
              <Input
                id="fe"
                type="email"
                required
                value={forgotEmail}
                onChange={(e) => setForgotEmail(e.target.value)}
                className="mt-1"
              />
            </div>
            <TurnstileWidget onVerify={setForgotCaptcha} onExpire={() => setForgotCaptcha(null)} />
            <DialogFooter>
              <Button
                type="submit"
                disabled={forgotLoading}
                className="w-full bg-gradient-primary text-primary-foreground"
              >
                {forgotLoading && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                Send reset link
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={resendOpen} onOpenChange={setResendOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Resend verification code</DialogTitle>
            <DialogDescription>
              Enter the email you signed up with and we'll send a fresh verification code.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={onResendVerification} className="space-y-4">
            <div>
              <Label htmlFor="re">Email</Label>
              <Input
                id="re"
                type="email"
                required
                value={resendEmail}
                onChange={(e) => setResendEmail(e.target.value)}
                className="mt-1"
              />
            </div>
            <TurnstileWidget onVerify={setResendCaptcha} onExpire={() => setResendCaptcha(null)} />
            <DialogFooter>
              <Button
                type="submit"
                disabled={resendLoading}
                className="w-full bg-gradient-primary text-primary-foreground"
              >
                {resendLoading && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                Send new verification code
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={otpOpen} onOpenChange={setOtpOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Enter your verification code</DialogTitle>
            <DialogDescription>
              We sent a verification code to <strong>{otpEmail}</strong>. Enter
              it below to activate your account.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={onVerifyOtp} className="space-y-5">
            <div className="flex justify-center py-2">
              <InputOTP
                maxLength={8}
                value={otpCode}
                onChange={(v) => setOtpCode(v)}
                autoFocus
              >
                <InputOTPGroup>
                  <InputOTPSlot index={0} />
                  <InputOTPSlot index={1} />
                  <InputOTPSlot index={2} />
                  <InputOTPSlot index={3} />
                </InputOTPGroup>
                <InputOTPSeparator />
                <InputOTPGroup>
                  <InputOTPSlot index={4} />
                  <InputOTPSlot index={5} />
                  <InputOTPSlot index={6} />
                  <InputOTPSlot index={7} />
                </InputOTPGroup>
              </InputOTP>
            </div>
            <Button
              type="submit"
              disabled={otpLoading || otpCode.length !== 8}
              className="w-full bg-gradient-primary text-primary-foreground"
            >
              {otpLoading && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              Verify & continue
            </Button>
            <p className="text-center text-xs text-muted-foreground">
              Didn't get it?{" "}
              <button
                type="button"
                onClick={onResendOtp}
                disabled={otpResending}
                className="text-primary hover:underline disabled:opacity-50"
              >
                {otpResending ? "Sending..." : "Send a new code"}
              </button>
            </p>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
