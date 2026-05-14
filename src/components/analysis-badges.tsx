import { cn } from "@/lib/utils";
import type { RiskLevel } from "@/lib/types";

export function RiskBadge({ risk, className }: { risk: RiskLevel; className?: string }) {
  const styles: Record<RiskLevel, string> = {
    low: "bg-success/15 text-success border-success/30",
    medium: "bg-warning/15 text-warning border-warning/30",
    high: "bg-danger/15 text-danger border-danger/30",
  };
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-xs font-mono uppercase tracking-wider",
        styles[risk],
        className,
      )}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      {risk} risk
    </span>
  );
}

export function ConfidenceMeter({ value }: { value: number }) {
  const color = value >= 75 ? "text-success" : value >= 60 ? "text-warning" : "text-danger";
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between">
        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Confidence</span>
        <span className={cn("font-mono text-2xl font-bold", color)}>{value}<span className="text-sm text-muted-foreground">/100</span></span>
      </div>
      <div className="h-2 rounded-full bg-muted overflow-hidden">
        <div
          className={cn("h-full rounded-full transition-all", value >= 75 ? "bg-success" : value >= 60 ? "bg-warning" : "bg-danger")}
          style={{ width: `${value}%` }}
        />
      </div>
    </div>
  );
}

export function ValueBadge({ value }: { value: boolean }) {
  if (!value) return null;
  return (
    <span className="inline-flex items-center gap-1 rounded-md border border-success/40 bg-success/10 px-2 py-0.5 text-[10px] font-mono uppercase tracking-wider text-success">
      Value Signal
    </span>
  );
}
