import { useMemo } from "react";
import { Check, X } from "lucide-react";
import { cn } from "@/lib/utils";

export interface PasswordStrength {
  score: 0 | 1 | 2 | 3 | 4;
  label: "Very weak" | "Weak" | "Fair" | "Strong" | "Excellent";
  color: string;
  checks: { label: string; met: boolean }[];
}

export function evaluatePassword(pw: string): PasswordStrength {
  const checks = [
    { label: "At least 8 characters", met: pw.length >= 8 },
    { label: "Upper & lowercase letters", met: /[a-z]/.test(pw) && /[A-Z]/.test(pw) },
    { label: "Includes a number", met: /\d/.test(pw) },
    { label: "Includes a symbol", met: /[^A-Za-z0-9]/.test(pw) },
  ];
  const passed = checks.filter((c) => c.met).length;
  let score: PasswordStrength["score"] = 0;
  if (pw.length === 0) score = 0;
  else if (pw.length < 6) score = 1;
  else if (passed <= 1) score = 1;
  else if (passed === 2) score = 2;
  else if (passed === 3) score = 3;
  else score = 4;
  if (pw.length >= 14 && passed >= 3) score = 4;

  const meta: Record<number, { label: PasswordStrength["label"]; color: string }> = {
    0: { label: "Very weak", color: "bg-destructive" },
    1: { label: "Weak", color: "bg-destructive" },
    2: { label: "Fair", color: "bg-warning" },
    3: { label: "Strong", color: "bg-success" },
    4: { label: "Excellent", color: "bg-success" },
  };
  return { score, label: meta[score].label, color: meta[score].color, checks };
}

export function PasswordStrengthMeter({ password }: { password: string }) {
  const s = useMemo(() => evaluatePassword(password), [password]);
  if (!password) return null;
  const segments = 4;
  return (
    <div className="mt-2 space-y-2">
      <div className="flex gap-1">
        {Array.from({ length: segments }).map((_, i) => (
          <div
            key={i}
            className={cn(
              "h-1.5 flex-1 rounded-full transition-colors",
              i < s.score ? s.color : "bg-muted",
            )}
          />
        ))}
      </div>
      <div className="flex items-center justify-between text-[11px]">
        <span className="font-mono uppercase tracking-wider text-muted-foreground">Strength</span>
        <span
          className={cn(
            "font-mono uppercase tracking-wider font-semibold",
            s.score <= 1 && "text-destructive",
            s.score === 2 && "text-warning",
            s.score >= 3 && "text-success",
          )}
        >
          {s.label}
        </span>
      </div>
      <ul className="grid grid-cols-2 gap-x-3 gap-y-1 text-[11px]">
        {s.checks.map((c) => (
          <li
            key={c.label}
            className={cn(
              "flex items-center gap-1.5",
              c.met ? "text-success" : "text-muted-foreground",
            )}
          >
            {c.met ? <Check className="h-3 w-3" /> : <X className="h-3 w-3 opacity-50" />}
            {c.label}
          </li>
        ))}
      </ul>
    </div>
  );
}
