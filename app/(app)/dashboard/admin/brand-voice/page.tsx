"use client";

import { useEffect, useMemo, useState } from "react";
import { ShieldAlert, Plus, Loader2, CheckCircle2, Mic, SearchCheck } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/hooks/useAuth";
import { Spinner } from "@/components/ui/Spinner";

interface VoiceCheckSummary {
  checked: number;
  skippedHumanEdited: number;
  flagged: number;
  flaggedFieldIds: string[];
}

interface BrandVoiceGuide {
  id: string;
  brand: string;
  content: string;
  version: number;
  is_active: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export default function BrandVoiceAdminPage() {
  const { user, loading: authLoading } = useAuth();
  const [guides, setGuides] = useState<BrandVoiceGuide[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activatingId, setActivatingId] = useState<string | null>(null);

  const [selectedBrand, setSelectedBrand] = useState<string | null>(null);
  const [draftContent, setDraftContent] = useState("");
  const [saving, setSaving] = useState(false);

  const [newBrandName, setNewBrandName] = useState("");
  const [showNewBrand, setShowNewBrand] = useState(false);

  const [voiceCheckProjectId, setVoiceCheckProjectId] = useState("");
  const [voiceChecking, setVoiceChecking] = useState(false);
  const [voiceCheckResult, setVoiceCheckResult] = useState<VoiceCheckSummary | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/brand-voice-guides");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to load brand voice guides");
      setGuides(data.guides || []);
    } catch (err: any) {
      setError(err.message || "Failed to load brand voice guides");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (user && (user.role === "OWNER" || user.role === "ADMIN")) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  const brands = useMemo(() => Array.from(new Set(guides.map(g => g.brand))).sort(), [guides]);
  const versionsForSelected = useMemo(
    () => (selectedBrand ? guides.filter(g => g.brand === selectedBrand).sort((a, b) => b.version - a.version) : []),
    [guides, selectedBrand]
  );
  const activeForSelected = versionsForSelected.find(g => g.is_active);

  useEffect(() => {
    if (!selectedBrand && brands.length > 0) setSelectedBrand(brands[0]);
  }, [brands, selectedBrand]);

  useEffect(() => {
    setDraftContent(activeForSelected?.content ?? versionsForSelected[0]?.content ?? "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedBrand, guides]);

  async function handleActivate(id: string) {
    setActivatingId(id);
    try {
      const res = await fetch(`/api/admin/brand-voice-guides/${id}/activate`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to activate");
      toast.success("Version activated — new generations will use it");
      await load();
    } catch (err: any) {
      toast.error(err.message || "Failed to activate version");
    } finally {
      setActivatingId(null);
    }
  }

  async function handleSaveNewVersion() {
    if (!selectedBrand || !draftContent.trim()) return;
    setSaving(true);
    try {
      const res = await fetch("/api/admin/brand-voice-guides", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ brand: selectedBrand, content: draftContent }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to save");
      toast.success(`Saved as version ${data.guide.version} (inactive — activate it below to use it)`);
      await load();
    } catch (err: any) {
      toast.error(err.message || "Failed to save new version");
    } finally {
      setSaving(false);
    }
  }

  async function handleCreateBrand() {
    const brand = newBrandName.trim();
    if (!brand) {
      toast.error("Brand name is required");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/admin/brand-voice-guides", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ brand, content: `# ${brand} Brand Voice Guide\n\n(Add voice attributes, tone spectrum, and terminology here.)` }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to create brand");
      toast.success(`Created "${brand}" — activate its first version below once you've filled it in`);
      setNewBrandName("");
      setShowNewBrand(false);
      setSelectedBrand(brand);
      await load();
    } catch (err: any) {
      toast.error(err.message || "Failed to create brand");
    } finally {
      setSaving(false);
    }
  }

  async function handleVoiceCheck() {
    const projectId = voiceCheckProjectId.trim();
    if (!projectId) return;
    setVoiceChecking(true);
    setVoiceCheckResult(null);
    try {
      const res = await fetch("/api/admin/gtm-voice-check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Voice check failed");
      setVoiceCheckResult(data.summary);
      toast.success(data.summary.flagged > 0 ? `${data.summary.flagged} field(s) flagged for voice review` : "No voice issues found");
    } catch (err: any) {
      toast.error(err.message || "Voice check failed");
    } finally {
      setVoiceChecking(false);
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
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Mic className="w-5 h-5 text-accent" />
          <h1 className="text-display">Brand Voice Guides</h1>
        </div>
        <button type="button" onClick={() => setShowNewBrand(v => !v)} className="flex items-center gap-1 px-2.5 py-1.5 bg-accent hover:bg-accent-hover text-white text-[11px] font-bold rounded-lg">
          <Plus className="w-3.5 h-3.5" /> Add brand
        </button>
      </div>
      <p className="text-xs text-text-muted -mt-4">
        Injected into every AI call that produces user-facing prose (GTM narrative fields, Product FAQs, Sales Kit, deck-copy condensation, analysis synthesis). Every edit saves as a new version — activate one to make new generations use it; older versions stay queryable, and every generated document records which version it was written against. A brand with no active guide falls back to a neutral-professional voice and is flagged &quot;no brand voice guide on file.&quot;
      </p>

      {showNewBrand && (
        <div className="border border-accent/30 bg-surface-2 rounded-xl p-4 space-y-3">
          <h2 className="text-xs font-bold text-text-primary">Add brand (e.g. Gamma+)</h2>
          <input type="text" placeholder="Brand name" value={newBrandName} onChange={e => setNewBrandName(e.target.value)} className="w-full px-2.5 py-1.5 text-[11px] border border-border rounded-lg bg-surface-1 text-text-primary outline-none focus:border-accent" />
          <div className="flex items-center gap-2">
            <button type="button" onClick={handleCreateBrand} disabled={saving} className="flex items-center gap-1 px-2.5 py-1.5 bg-accent hover:bg-accent-hover text-white text-[11px] font-bold rounded-lg disabled:opacity-50">
              {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />} Create
            </button>
            <button type="button" onClick={() => { setShowNewBrand(false); setNewBrandName(""); }} className="px-2.5 py-1.5 text-[11px] text-text-muted hover:text-danger">Cancel</button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="p-8 text-center text-text-muted text-xs">Loading…</div>
      ) : error ? (
        <div className="p-8 text-center text-danger text-xs">{error}</div>
      ) : brands.length === 0 ? (
        <div className="p-8 text-center text-text-muted text-xs">No brand voice guides yet — add one to get started.</div>
      ) : (
        <div className="grid grid-cols-[160px_1fr] gap-4">
          <div className="space-y-1">
            {brands.map(b => {
              const hasActive = guides.some(g => g.brand === b && g.is_active);
              return (
                <button
                  key={b}
                  type="button"
                  onClick={() => setSelectedBrand(b)}
                  className={`w-full text-left px-2.5 py-2 rounded-lg text-[11px] font-semibold border ${
                    selectedBrand === b ? "border-accent bg-accent-bg text-accent-text" : "border-border text-text-secondary hover:border-border-strong"
                  }`}
                >
                  {b}
                  {!hasActive && <span className="block text-[9px] font-normal text-warning mt-0.5">No active guide</span>}
                </button>
              );
            })}
          </div>

          <div className="space-y-4">
            <div className="border border-border rounded-xl p-4 space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-bold text-text-primary">{selectedBrand} — edit content</h3>
                <button
                  type="button"
                  onClick={handleSaveNewVersion}
                  disabled={saving || !draftContent.trim()}
                  className="flex items-center gap-1 px-2.5 py-1 bg-accent hover:bg-accent-hover text-white text-[10px] font-bold rounded disabled:opacity-50"
                >
                  {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : "Save as new version"}
                </button>
              </div>
              <textarea
                rows={20}
                value={draftContent}
                onChange={e => setDraftContent(e.target.value)}
                className="w-full px-3 py-2 text-[11px] font-mono border border-border rounded-lg bg-surface-1 text-text-primary outline-none focus:border-accent resize-y"
              />
            </div>

            <div className="border border-border rounded-xl overflow-hidden">
              <div className="grid grid-cols-[80px_1fr_160px_100px] gap-3 px-4 py-2.5 bg-surface-3/30 border-b border-border text-[10px] font-bold text-text-muted uppercase tracking-wider">
                <span>Version</span>
                <span>Created By</span>
                <span>Saved</span>
                <span></span>
              </div>
              <div className="divide-y divide-border/60">
                {versionsForSelected.map(g => (
                  <div key={g.id} className="grid grid-cols-[80px_1fr_160px_100px] gap-3 px-4 py-3 items-center text-xs">
                    <span className="font-mono text-text-secondary">v{g.version}</span>
                    <span className="text-text-secondary truncate">{g.created_by || "—"}</span>
                    <span className="text-text-muted text-[11px]">{new Date(g.updated_at).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</span>
                    {g.is_active ? (
                      <span className="inline-flex items-center gap-1 text-success font-semibold text-[10px]">
                        <CheckCircle2 className="w-3.5 h-3.5" /> Active
                      </span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => handleActivate(g.id)}
                        disabled={activatingId === g.id}
                        className="flex items-center gap-1 px-2 py-1 border border-border hover:border-border-strong text-text-secondary text-[10px] font-bold rounded-md transition-colors disabled:opacity-50 justify-self-start"
                      >
                        {activatingId === g.id ? <Loader2 className="w-3 h-3 animate-spin" /> : "Activate"}
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="border border-border rounded-xl p-4 space-y-3">
        <div className="flex items-center gap-2">
          <SearchCheck className="w-4 h-4 text-accent" />
          <h2 className="text-xs font-bold text-text-primary">Voice check a project&apos;s GTM document</h2>
        </div>
        <p className="text-[11px] text-text-muted">
          Re-lints an already-generated GTM document&apos;s written fields against the current voice guide. Flags off-voice fields for manual regeneration — never rewrites anything, and always skips any field you&apos;ve hand-edited since it was generated.
        </p>
        <div className="flex items-center gap-2">
          <input
            type="text"
            placeholder="Project ID"
            value={voiceCheckProjectId}
            onChange={e => setVoiceCheckProjectId(e.target.value)}
            className="flex-1 px-2.5 py-1.5 text-[11px] font-mono border border-border rounded-lg bg-surface-1 text-text-primary outline-none focus:border-accent"
          />
          <button
            type="button"
            onClick={handleVoiceCheck}
            disabled={voiceChecking || !voiceCheckProjectId.trim()}
            className="flex items-center gap-1 px-2.5 py-1.5 bg-accent hover:bg-accent-hover text-white text-[11px] font-bold rounded-lg disabled:opacity-50"
          >
            {voiceChecking ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : "Run Voice Check"}
          </button>
        </div>
        {voiceCheckResult && (
          <div className="text-[11px] text-text-secondary bg-surface-2 rounded-lg p-3">
            Checked {voiceCheckResult.checked} field(s) · skipped {voiceCheckResult.skippedHumanEdited} hand-edited · flagged {voiceCheckResult.flagged}
            {voiceCheckResult.flaggedFieldIds.length > 0 && (
              <div className="mt-1.5 font-mono text-text-muted">{voiceCheckResult.flaggedFieldIds.join(", ")}</div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
