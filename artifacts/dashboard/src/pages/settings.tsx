import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { AppLayout } from "@/components/layout/app-layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { useTranslation } from "react-i18next";
import { Save, RotateCcw, Brain, HardDrive, Shield, Settings2, Database, Globe, Mail, Send } from "lucide-react";
import { cn } from "@/lib/utils";

interface SystemSetting {
  id: string;
  key: string;
  value: string;
  value_type: string;
  label: string;
  description: string | null;
  category: string;
  updated_at: string;
  updated_by: string | null;
}

interface SettingsResponse {
  settings: SystemSetting[];
  grouped: Record<string, SystemSetting[]>;
}

const CATEGORY_ICONS: Record<string, React.ElementType> = {
  ai: Brain,
  hardware: HardDrive,
  access: Shield,
  storage: Database,
  system: Settings2,
  general: Globe,
  email: Mail,
};

const CATEGORY_ORDER = ["general", "email", "access", "ai", "hardware", "storage", "system"];

function SettingField({
  setting,
  value,
  onChange,
}: {
  setting: SystemSetting;
  value: string;
  onChange: (key: string, val: string) => void;
}) {
  const { t } = useTranslation();
  const label = t(`settings.labels.${setting.key}`, { defaultValue: setting.label });
  const description = t(`settings.descriptions.${setting.key}`, {
    defaultValue: setting.description ?? "",
  });

  if (setting.value_type === "boolean") {
    return (
      <div className="flex items-center justify-between py-3 border-b border-border/40 last:border-0">
        <div className="flex-1 pr-4">
          <Label className="text-sm font-medium text-foreground">{label}</Label>
          {description && (
            <p className="text-xs text-muted-foreground mt-0.5">{description}</p>
          )}
        </div>
        <Switch
          checked={value === "true"}
          onCheckedChange={(checked) => onChange(setting.key, String(checked))}
        />
      </div>
    );
  }

  if (setting.value_type === "number") {
    return (
      <div className="py-3 border-b border-border/40 last:border-0">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1">
            <Label className="text-sm font-medium text-foreground">{label}</Label>
            {description && (
              <p className="text-xs text-muted-foreground mt-0.5">{description}</p>
            )}
          </div>
          <Input
            type="number"
            value={value}
            onChange={(e) => onChange(setting.key, e.target.value)}
            className="w-32 text-right font-mono"
            step="any"
          />
        </div>
      </div>
    );
  }

  if (setting.value_type === "password") {
    return (
      <div className="py-3 border-b border-border/40 last:border-0">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1">
            <Label className="text-sm font-medium text-foreground">{label}</Label>
            {description && (
              <p className="text-xs text-muted-foreground mt-0.5">{description}</p>
            )}
          </div>
          <Input
            type="password"
            value={value}
            onChange={(e) => onChange(setting.key, e.target.value)}
            placeholder="••••••••"
            autoComplete="new-password"
            className="w-48"
          />
        </div>
      </div>
    );
  }

  return (
    <div className="py-3 border-b border-border/40 last:border-0">
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1">
          <Label className="text-sm font-medium text-foreground">{label}</Label>
          {description && (
            <p className="text-xs text-muted-foreground mt-0.5">{description}</p>
          )}
        </div>
        <Input
          value={value}
          onChange={(e) => onChange(setting.key, e.target.value)}
          className="w-48"
        />
      </div>
    </div>
  );
}

export default function SettingsPage() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [dirty, setDirty] = useState<Set<string>>(new Set());
  const [testingEmail, setTestingEmail] = useState(false);

  const { data, isLoading } = useQuery<SettingsResponse>({
    queryKey: ["settings"],
    queryFn: () => api.get("/settings"),
  });

  useEffect(() => {
    if (data?.settings) {
      const initial: Record<string, string> = {};
      for (const s of data.settings) initial[s.key] = s.value;
      setDraft(initial);
      setDirty(new Set());
    }
  }, [data]);

  const saveMut = useMutation({
    mutationFn: (updates: Record<string, string>) =>
      api.patch<any>("/settings", updates),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ["settings"] });
      setDirty(new Set());
      toast({ title: t("settings.saved"), description: `${res.updated} ${t("settings.settingsUpdated")}` });
    },
    onError: (e: any) => toast({ title: t("common.error"), description: e.message, variant: "destructive" }),
  });

  function handleChange(key: string, val: string) {
    setDraft((d) => ({ ...d, [key]: val }));
    setDirty((d) => new Set([...d, key]));
  }

  function handleSave() {
    const updates: Record<string, string> = {};
    for (const key of dirty) {
      if (draft[key] !== undefined) updates[key] = draft[key];
    }
    saveMut.mutate(updates);
  }

  function handleReset() {
    if (data?.settings) {
      const initial: Record<string, string> = {};
      for (const s of data.settings) initial[s.key] = s.value;
      setDraft(initial);
      setDirty(new Set());
    }
  }

  async function handleTestEmail() {
    setTestingEmail(true);
    try {
      const res = await api.post<{ message: string }>("/settings/test-email", {});
      toast({ title: "✅ Тест изпратен", description: res.message });
    } catch (err: any) {
      toast({ variant: "destructive", title: "Грешка при изпращане", description: err?.detail ?? err?.message });
    } finally {
      setTestingEmail(false);
    }
  }

  const orderedCategories = [
    ...CATEGORY_ORDER.filter((c) => data?.grouped[c]),
    ...Object.keys(data?.grouped ?? {}).filter((c) => !CATEGORY_ORDER.includes(c)),
  ];

  return (
    <AppLayout
      title={t("settings.title")}
      subtitle={t("settings.subtitle")}
      actions={
        <div className="flex gap-2">
          {dirty.size > 0 && (
            <Button variant="outline" size="sm" onClick={handleReset}>
              <RotateCcw className="w-4 h-4 mr-2" />
              {t("common.cancel")}
            </Button>
          )}
          <Button
            size="sm"
            onClick={handleSave}
            disabled={dirty.size === 0 || saveMut.isPending}
          >
            <Save className="w-4 h-4 mr-2" />
            {saveMut.isPending
              ? t("common.saving")
              : dirty.size > 0
              ? `${t("common.save")} (${dirty.size})`
              : t("common.save")}
          </Button>
        </div>
      }
    >
      <div className="max-w-3xl mx-auto space-y-6">
        {isLoading ? (
          <div className="space-y-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-48 w-full rounded-xl" />
            ))}
          </div>
        ) : (
          orderedCategories.map((category) => {
            const settings = data?.grouped[category] ?? [];
            const Icon = CATEGORY_ICONS[category] ?? Settings2;
            return (
              <Card key={category}>
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-sm font-semibold flex items-center gap-2 capitalize">
                      <Icon className="w-4 h-4 text-primary" />
                      {t(`settings.categories.${category}`, { defaultValue: category })}
                    </CardTitle>
                    {category === "email" && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={handleTestEmail}
                        disabled={testingEmail}
                        className="text-xs h-7"
                      >
                        <Send className="w-3 h-3 mr-1.5" />
                        {testingEmail ? "Изпращане..." : "Тест имейл"}
                      </Button>
                    )}
                  </div>
                </CardHeader>
                <CardContent>
                  {settings.map((s) => (
                    <SettingField
                      key={s.key}
                      setting={s}
                      value={draft[s.key] ?? s.value}
                      onChange={handleChange}
                    />
                  ))}
                </CardContent>
              </Card>
            );
          })
        )}

        {dirty.size > 0 && (
          <div className="fixed bottom-6 right-6 flex gap-2 bg-card border border-border rounded-xl shadow-2xl p-3">
            <span className="text-sm text-muted-foreground self-center px-2">
              {dirty.size} {t("settings.unsavedChanges")}
            </span>
            <Button variant="outline" size="sm" onClick={handleReset}>
              {t("common.cancel")}
            </Button>
            <Button size="sm" onClick={handleSave} disabled={saveMut.isPending}>
              <Save className="w-3.5 h-3.5 mr-1.5" />
              {saveMut.isPending ? t("common.saving") : t("common.saveChanges")}
            </Button>
          </div>
        )}
      </div>
    </AppLayout>
  );
}
