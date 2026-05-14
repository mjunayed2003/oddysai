import { Link, useRouterState } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { BrandLogo } from "./brand";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/use-auth";
import { LanguageSwitcher } from "./language-switcher";

export function PublicHeader() {
  const { user } = useAuth();
  const { t } = useTranslation();
  const path = useRouterState({ select: (s) => s.location.pathname });
  const NAV = [
    { to: "/", label: t("nav.home") },
    { to: "/responsible-gambling", label: t("nav.responsibleGambling") },
  ];
  return (
    <header className="sticky top-0 z-40 border-b border-border/60 bg-background/80 backdrop-blur-xl">
      <div className="container mx-auto px-4 h-16 flex items-center justify-between">
        <BrandLogo />
        <nav className="hidden md:flex items-center gap-8">
          {NAV.map((n) => (
            <Link
              key={n.to}
              to={n.to}
              className={`text-sm transition-colors ${path === n.to ? "text-foreground font-medium" : "text-muted-foreground hover:text-foreground"}`}
            >
              {n.label}
            </Link>
          ))}
        </nav>
        <div className="flex items-center gap-2">
          <LanguageSwitcher />
          {user ? (
            <Button asChild size="sm" className="bg-gradient-primary text-primary-foreground">
              <Link to="/dashboard">{t("nav.dashboard")}</Link>
            </Button>
          ) : (
            <>
              <Button asChild variant="ghost" size="sm">
                <Link to="/login">{t("auth.signIn")}</Link>
              </Button>
              <Button asChild size="sm" className="bg-gradient-primary text-primary-foreground shadow-glow">
                <Link to="/login">{t("auth.getStarted")}</Link>
              </Button>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
