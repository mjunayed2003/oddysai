import { Link, useRouterState } from "@tanstack/react-router";
import { Home, LayoutDashboard, Radio, Users, Settings } from "lucide-react";
import { cn } from "@/lib/utils";

const NAV = [
  { to: "/", icon: Home, label: "Main" },
  { to: "/dashboard", icon: LayoutDashboard, label: "Dash" },
  { to: "/live", icon: Radio, label: "Live" },
  { to: "/affiliate", icon: Users, label: "Refer" },
  { to: "/settings", icon: Settings, label: "Acct" },
];

export function MobileTabBar() {
  const path = useRouterState({ select: (s) => s.location.pathname });
  return (
    <nav className="md:hidden fixed bottom-0 inset-x-0 z-30 border-t border-border bg-background/95 backdrop-blur-xl">
      <div className="grid grid-cols-5">
        {NAV.map((n) => {
          const Icon = n.icon;
          const active = path === n.to;
          return (
            <Link
              key={n.to}
              to={n.to}
              className={cn(
                "flex flex-col items-center gap-0.5 py-2 text-[10px]",
                active ? "text-primary" : "text-muted-foreground"
              )}
            >
              <Icon className="h-4 w-4" />
              <span>{n.label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
