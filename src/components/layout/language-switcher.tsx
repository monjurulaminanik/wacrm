"use client";

import { useLocale, useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import type { AppLocale } from "@/i18n/config";

export function LanguageSwitcher({ className }: { className?: string }) {
  const locale = useLocale() as AppLocale;
  const t = useTranslations("LanguageSwitcher");

  async function setLocale(next: AppLocale) {
    if (next === locale) return;
    await fetch("/api/locale", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ locale: next }),
    });
    window.location.reload();
  }

  return (
    <div
      role="group"
      aria-label={t("aria")}
      className={cn(
        "inline-flex items-center gap-0.5 rounded-full border border-white/15 bg-white/5 p-0.5 backdrop-blur-md",
        className,
      )}
    >
      {(["bn", "en"] as const).map((code) => {
        const active = locale === code;
        return (
          <button
            key={code}
            type="button"
            onClick={() => void setLocale(code)}
            className={cn(
              "rounded-full px-2.5 py-1 text-[11px] font-medium tracking-wide transition-all duration-200",
              active
                ? "bg-primary/90 text-primary-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {t(code)}
          </button>
        );
      })}
    </div>
  );
}
