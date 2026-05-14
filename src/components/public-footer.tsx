import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { BrandLogo } from "./brand";

export function PublicFooter() {
  const { t } = useTranslation();
  return (
    <footer className="border-t border-border bg-card/30 mt-20">
      <div className="container mx-auto px-4 py-12 grid gap-8 md:grid-cols-4">
        <div className="space-y-3 md:col-span-2">
          <BrandLogo />
          <p className="text-sm text-muted-foreground max-w-xs">{t("footer.tagline")}</p>
          <p className="text-[11px] text-muted-foreground/70 max-w-xs">{t("footer.disclaimer")}</p>
        </div>
        <div>
          <h4 className="text-sm font-semibold mb-3">{t("footer.product")}</h4>
          <ul className="space-y-2 text-sm text-muted-foreground">
            <li><Link to="/dashboard" className="hover:text-foreground">{t("nav.dashboard")}</Link></li>
            <li><Link to="/analyzer" className="hover:text-foreground">{t("nav.analyzer")}</Link></li>
          </ul>
        </div>
        <div>
          <h4 className="text-sm font-semibold mb-3">{t("footer.legal")}</h4>
          <ul className="space-y-2 text-sm text-muted-foreground">
            <li><Link to="/terms" className="hover:text-foreground">{t("footer.terms")}</Link></li>
            <li><Link to="/privacy" className="hover:text-foreground">{t("footer.privacy")}</Link></li>
            <li><Link to="/responsible-gambling" className="hover:text-foreground">{t("nav.responsibleGambling")}</Link></li>
            <li><Link to="/contact" className="hover:text-foreground">{t("footer.contact")}</Link></li>
            <li><a href="mailto:mail@oddysai.com" className="hover:text-foreground">{t("footer.support")}</a></li>
          </ul>
        </div>
      </div>
      <div className="border-t border-border py-4 px-4 text-center text-xs text-muted-foreground">
        {t("footer.copyright", { year: new Date().getFullYear() })}
      </div>
    </footer>
  );
}
