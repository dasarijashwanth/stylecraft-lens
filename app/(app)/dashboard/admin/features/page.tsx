"use client";

import { useEffect, useState } from "react";
import { ShieldAlert, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/hooks/useAuth";
import { Spinner } from "@/components/ui/Spinner";

interface FeatureFlag {
  flag_name: string;
  enabled: boolean;
  updated_at: string;
}

const FLAG_LABELS: Record<string, { title: string; description: string }> = {
  tds_enabled: {
    title: "Technical Data Sheet (TDS)",
    description:
      "Turn off to hide the TDS tab/section, buttons, and FAQ entries everywhere, and stop generating it for new projects. GTM generation is unaffected — its spec fields already fall back to the product snapshot/Amazon data directly. Existing TDS documents are preserved and reappear immediately if you turn this back on.",
  },
  buyer_sentiment_enabled: {
    title: "Recent Buyer Sentiment",
    description:
      "Off by default — the last-90-days sentiment trend/theme block on competitor cards is hidden and the extra review fetch is skipped (Weaknesses stays fully visible either way). Turn on to show it again; existing sentiment data is preserved and reappears immediately, no regeneration needed.",
  },
  news_updates_enabled: {
    title: "News Updates",
    description:
      "Off by default — the News Updates section on competitor cards is hidden and the product-news search is skipped entirely. Turn on to show it again; existing cached news data is preserved and reappears immediately, no regeneration needed.",
  },
};

export default function AdminFeaturesPage() {
  const { user, loading: authLoading } = useAuth();
  const [flags, setFlags] = useState<FeatureFlag[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [savingFlag, setSavingFlag] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/features");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to load feature flags");
      setFlags(data.flags || []);
    } catch (err: any) {
      setError(err.message || "Failed to load feature flags");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (user && (user.role === "OWNER" || user.role === "ADMIN")) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  async function handleToggle(flag: FeatureFlag) {
    setSavingFlag(flag.flag_name);
    try {
      const res = await fetch("/api/admin/features", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ flagName: flag.flag_name, enabled: !flag.enabled }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to update feature flag");
      setFlags(data.flags || []);
      toast.success(`${FLAG_LABELS[flag.flag_name]?.title || flag.flag_name} ${!flag.enabled ? "enabled" : "disabled"}`);
    } catch (err: any) {
      toast.error(err.message || "Failed to update feature flag");
    } finally {
      setSavingFlag(null);
    }
  }

  if (authLoading) {
    return (
      <div className="flex items-center justify-center min-h-[300px]">
        <Spinner size="lg" className="text-accent" />
      </div>
    );
  }

  if (!user || (user.role !== "OWNER" && user.role !== "ADMIN")) {
    return (
      <div className="max-w-md mx-auto mt-16 text-center space-y-3">
        <ShieldAlert className="w-8 h-8 mx-auto text-text-muted" />
        <h1 className="text-sm font-bold text-text-primary">Not authorized</h1>
        <p className="text-xs text-text-muted">This page is restricted to workspace owners/admins.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <ShieldAlert className="w-5 h-5 text-accent" />
        <h1 className="text-display">Features</h1>
      </div>
      <p className="text-xs text-text-muted -mt-4">
        Turn optional features on or off app-wide. Changes apply immediately, no deploy needed.
      </p>

      {loading ? (
        <div className="p-8 text-center text-text-muted text-xs">Loading…</div>
      ) : error ? (
        <div className="p-8 text-center text-danger text-xs">{error}</div>
      ) : (
        <div className="space-y-3">
          {flags.map(flag => {
            const info = FLAG_LABELS[flag.flag_name] || { title: flag.flag_name, description: "" };
            return (
              <div key={flag.flag_name} className="flex items-start justify-between gap-4 p-4 border border-border rounded-xl">
                <div className="space-y-1">
                  <h2 className="text-xs font-bold text-text-primary">{info.title}</h2>
                  {info.description && <p className="text-[11px] text-text-muted leading-relaxed max-w-xl">{info.description}</p>}
                </div>
                <button
                  type="button"
                  onClick={() => handleToggle(flag)}
                  disabled={savingFlag === flag.flag_name}
                  className={`shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-bold border transition-colors disabled:opacity-50 ${
                    flag.enabled ? "border-success/30 text-success bg-success/10" : "border-border text-text-muted"
                  }`}
                >
                  {savingFlag === flag.flag_name ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
                  <span>{flag.enabled ? "Enabled" : "Disabled"}</span>
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
