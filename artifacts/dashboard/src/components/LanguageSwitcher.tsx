import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";

const LANGS = [
  { code: "en", flag: "🇬🇧", label: "EN" },
  { code: "bg", flag: "🇧🇬", label: "БГ" },
] as const;

export function LanguageSwitcher() {
  const { i18n } = useTranslation();
  const current = i18n.language;

  return (
    <div className="flex items-center gap-1 px-3 pb-2">
      {LANGS.map(({ code, flag, label }) => (
        <Button
          key={code}
          variant="ghost"
          size="sm"
          onClick={() => i18n.changeLanguage(code)}
          className={
            current === code
              ? "h-8 px-2 text-xs font-semibold bg-primary/15 text-primary hover:bg-primary/20"
              : "h-8 px-2 text-xs font-medium text-muted-foreground hover:text-foreground"
          }
        >
          <span className="mr-1">{flag}</span>
          {label}
        </Button>
      ))}
    </div>
  );
}
