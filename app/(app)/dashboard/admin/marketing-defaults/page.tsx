"use client";

import { useEffect, useState } from "react";
import { ShieldAlert, Globe, Save, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/hooks/useAuth";
import { Spinner } from "@/components/ui/Spinner";

export default function MarketingDefaultsAdminPage() {
  const { user, loading: authLoading } = useAuth();
  const [languages, setLanguages] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/marketing-defaults");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to load marketing defaults");
      setLanguages(data.defaults.languages);
    } catch (err: any) {
      setError(err.message || "Failed to load marketing defaults");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (user && (user.role === "OWNER" || user.role === "ADMIN")) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  async function handleSave() {
    if (!languages.trim()) {
      toast.error("Languages is required");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/admin/marketing-defaults", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ languages: languages.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to save marketing defaults");
      setLanguages(data.defaults.languages);
      toast.success("Marketing defaults saved");
    } catch (err: any) {
      toast.error(err.message || "Failed to save marketing defaults");
    } finally {
      setSaving(false);
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
    <div className="space-y-6 max-w-2xl">
      <div className="flex items-center gap-2">
        <Globe className="w-5 h-5 text-accent" />
        <h1 className="text-display">Marketing Defaults</h1>
      </div>
      <p className="text-xs text-text-muted -mt-4">
        Org-wide default for the Marketing Direction section&apos;s Languages field — seeded onto every new project&apos;s generated GTM sheet (never AI-guessed), still editable per-project afterward.
      </p>

      {loading ? (
        <div className="p-8 text-center text-text-muted text-xs">Loading…</div>
      ) : error ? (
        <div className="p-8 text-center text-danger text-xs">{error}</div>
      ) : (
        <div className="border border-border rounded-xl bg-surface-2 p-4 space-y-3">
          <label className="block text-[11px] font-bold text-text-primary">Languages</label>
          <textarea
            rows={3}
            value={languages}
            onChange={e => setLanguages(e.target.value)}
            className="w-full px-2.5 py-1.5 border border-border rounded-lg bg-surface-1 text-text-primary outline-none focus:border-accent resize-y text-[11px]"
          />
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-1 px-2.5 py-1.5 bg-accent hover:bg-accent-hover text-white text-[11px] font-bold rounded-lg disabled:opacity-50"
          >
            {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />} Save
          </button>
        </div>
      )}
    </div>
  );
}
