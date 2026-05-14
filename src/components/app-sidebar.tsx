import { Link, useRouterState } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { LayoutDashboard, Search, Radio, Users, Settings, Shield, LogOut } from "lucide-react";
import { BrandLogo } from "./brand";
import { useAuth } from "@/hooks/use-auth";
import { useIsAdmin } from "@/hooks/use-role";
import { cn } from "@/lib/utils";
import { LanguageSwitcher } from "./language-switcher";

export function AppSidebar() {
  const path = useRouterState({ select: (s) => s.location.pathname });
  const { user, signOut } = useAuth();
  const { isAdmin } = useIsAdmin();
  const { t } = useTranslation();

  const NAV = [
    { to: "/dashboard", label: t("nav.dashboard"), icon: LayoutDashboard },
    { to: "/analyzer", label: t("nav.analyzer"), icon: Search },
    { to: "/live", label: t("nav.live"), icon: Radio },
    { to: "/affiliate", label: t("nav.affiliate"), icon: Users },
    { to: "/settings", label: t("nav.settings"), icon: Settings },
  ];

  return (
    <aside className="hidden md:flex w-64 shrink-0 flex-col border-r border-sidebar-border bg-sidebar">
      <div className="px-5 py-5 border-b border-sidebar-border">
        <BrandLogo />
      </div>

      <nav className="flex-1 overflow-y-auto px-2 py-3 space-y-0.5">
        {NAV.map((n) => {
          const Icon = n.icon;
          const active = path === n.to;
          return (
            <Link
              key={n.to}
              to={n.to}
              className={cn(
                "flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors",
                active
                  ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium"
                  : "text-muted-foreground hover:text-foreground hover:bg-sidebar-accent/50"
              )}
            >
              <Icon className="h-4 w-4" />
              <span className="flex-1">{n.label}</span>
            </Link>
          );
        })}

        {isAdmin && (
          <Link
            to="/admin"
            className={cn(
              "flex items-center gap-3 px-3 py-2 rounded-md text-sm mt-4 transition-colors",
              path === "/admin"
                ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium"
                : "text-muted-foreground hover:text-foreground hover:bg-sidebar-accent/50"
            )}
          >
            <Shield className="h-4 w-4" />
            <span>{t("nav.admin")}</span>
          </Link>
        )}
      </nav>

      <div className="px-3 py-2 border-t border-sidebar-border">
        <LanguageSwitcher />
      </div>

      <div className="px-3 py-3 border-t border-sidebar-border">
        <div className="flex items-center gap-2 px-2 py-2">
          <div className="h-8 w-8 rounded-full bg-gradient-primary flex items-center justify-center text-xs font-bold text-primary-foreground">
            {user?.email?.[0]?.toUpperCase() ?? "?"}
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-xs font-medium truncate">{user?.email}</div>
          </div>
          <button onClick={() => signOut()} className="text-muted-foreground hover:text-foreground p-1" title="Sign out">
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      </div>
    </aside>
  );
}
