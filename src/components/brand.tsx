import { Link } from "@tanstack/react-router";
import { ShieldAlert } from "lucide-react";
import { cn } from "@/lib/utils";
import logoUrl from "@/assets/oddysai-logo.png";

export function BrandLogo({ className }: { className?: string }) {
  return (
    <Link to="/" className={cn("flex items-center gap-2 group", className)}>
      <img
        src={logoUrl}
        alt="OddysAI logo"
        width={32}
        height={32}
        className="h-8 w-8 object-contain drop-shadow-[0_0_8px_hsl(var(--primary)/0.5)]"
      />
      <span className="font-display text-xl font-bold tracking-tight">
        Oddys<span className="text-gradient-primary">AI</span>
      </span>
    </Link>
  );
}

export function ResponsibleGamblingBanner() {
  return (
    <div className="flex items-center gap-2 rounded-md bg-warning/10 border border-warning/20 px-3 py-2 text-xs text-warning">
      <ShieldAlert className="h-3.5 w-3.5 shrink-0" />
      <span>AI analysis is informational. Betting carries risk. 18+ only. Never bet more than you can afford to lose.</span>
    </div>
  );
}
