"use client";

import { useEffect, useState } from "react";
import { ShieldAlert, Plus, X, Loader2, ArrowUp, ArrowDown, Save } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/hooks/useAuth";
import { Spinner } from "@/components/ui/Spinner";

interface MotorFamily {
  id: string;
  family_key: string;
  label: string;
  domain: string;
  aliases: string[];
  modifier: boolean;
  adjacent_families: string[];
  enabled: boolean;
  sort_order: number;
}

interface Weights {
  motor_weight: number;
  price_weight: number;
  feature_weight: number;
}

const DOMAIN_LABELS: Record<string, string> = {
  clipper_trimmer_shaver: "Clippers, Trimmers & Shavers",
  beauty: "Beauty Tools",
};

export default function CompetitorMatchingAdminPage() {
  const { user, loading: authLoading } = useAuth();
  const [families, setFamilies] = useState<MotorFamily[]>([]);
  const [weights, setWeights] = useState<Weights | null>(null);
  const [weightInputs, setWeightInputs] = useState({ motor: "0.45", price: "0.35", feature: "0.20" });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [savingWeights, setSavingWeights] = useState(false);
  const [newFamilyText, setNewFamilyText] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const [famRes, weightRes] = await Promise.all([
        fetch("/api/admin/motor-families"),
        fetch("/api/admin/competitor-matching-config"),
      ]);
      const famData = await famRes.json();
      const weightData = await weightRes.json();
      if (!famRes.ok) throw new Error(famData.error || "Failed to load motor families");
      if (!weightRes.ok) throw new Error(weightData.error || "Failed to load weights");
      setFamilies(famData.families || []);
      setWeights(weightData.weights);
      setWeightInputs({
        motor: String(weightData.weights.motor_weight),
        price: String(weightData.weights.price_weight),
        feature: String(weightData.weights.feature_weight),
      });
    } catch (err: any) {
      setError(err.message || "Failed to load competitor matching config");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (user && (user.role === "OWNER" || user.role === "ADMIN")) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  async function handleSaveWeights() {
    setSavingWeights(true);
    try {
      const res = await fetch("/api/admin/competitor-matching-config", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ motor: Number(weightInputs.motor), price: Number(weightInputs.price), feature: Number(weightInputs.feature) }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to save weights");
      setWeights(data.weights);
      setWeightInputs({ motor: String(data.weights.motor_weight), price: String(data.weights.price_weight), feature: String(data.weights.feature_weight) });
      toast.success("Weights saved — normalized to sum to 1.0");
    } catch (err: any) {
      toast.error(err.message || "Failed to save weights");
    } finally {
      setSavingWeights(false);
    }
  }

  async function handleAddFamily(domain: string) {
    const text = (newFamilyText[domain] || "").trim();
    if (!text) return;
    const match = text.match(/^(.+?)\s*\(([^)]+)\)\s*$/);
    const label = match ? match[1].trim() : text;
    const aliases = match ? match[2].split(",").map(a => a.trim()).filter(Boolean) : [];
    const familyKey = label.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");

    try {
      const res = await fetch("/api/admin/motor-families", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ familyKey, label, domain, aliases }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to add motor family");
      setNewFamilyText(prev => ({ ...prev, [domain]: "" }));
      toast.success(`Added ${label}`);
      await load();
    } catch (err: any) {
      toast.error(err.message || "Failed to add motor family");
    }
  }

  async function handleToggleEnabled(family: MotorFamily) {
    setBusyId(family.id);
    try {
      const res = await fetch(`/api/admin/motor-families/${family.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: !family.enabled }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to update motor family");
      await load();
    } catch (err: any) {
      toast.error(err.message || "Failed to update motor family");
    } finally {
      setBusyId(null);
    }
  }

  async function handleRemove(id: string) {
    setBusyId(id);
    try {
      const res = await fetch(`/api/admin/motor-families/${id}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to remove motor family");
      await load();
    } catch (err: any) {
      toast.error(err.message || "Failed to remove motor family");
    } finally {
      setBusyId(null);
    }
  }

  async function handleMove(domainFamilies: MotorFamily[], index: number, direction: -1 | 1) {
    const targetIndex = index + direction;
    if (targetIndex < 0 || targetIndex >= domainFamilies.length) return;
    const reordered = [...domainFamilies];
    [reordered[index], reordered[targetIndex]] = [reordered[targetIndex], reordered[index]];

    try {
      const res = await fetch("/api/admin/motor-families/reorder", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderedIds: reordered.map(f => f.id) }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to reorder");
      await load();
    } catch (err: any) {
      toast.error(err.message || "Failed to reorder");
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

  const weightSum = (Number(weightInputs.motor) || 0) + (Number(weightInputs.price) || 0) + (Number(weightInputs.feature) || 0);
  const domains = Array.from(new Set(families.map(f => f.domain)));

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <ShieldAlert className="w-5 h-5 text-accent" />
        <h1 className="text-display">Competitor Matching</h1>
      </div>
      <p className="text-xs text-text-muted -mt-4">
        Motor type dominates competitor selection, then price, then comparable specs. Adjust the weights below or edit the motor-type families they&apos;re matched against — changes apply to future analyses only.
      </p>

      {loading ? (
        <div className="p-8 text-center text-text-muted text-xs">Loading…</div>
      ) : error ? (
        <div className="p-8 text-center text-danger text-xs">{error}</div>
      ) : (
        <>
          <div className="border border-border rounded-xl p-4 space-y-3">
            <h2 className="text-xs font-bold text-text-primary">Scoring Weights</h2>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="text-[10px] font-bold text-text-muted uppercase tracking-wider">Motor</label>
                <input
                  type="number" step="0.01" min="0" max="1"
                  value={weightInputs.motor}
                  onChange={e => setWeightInputs(prev => ({ ...prev, motor: e.target.value }))}
                  className="mt-1 w-full px-2.5 py-1.5 text-xs border border-border rounded-lg bg-surface-1 text-text-primary outline-none focus:border-accent"
                />
              </div>
              <div>
                <label className="text-[10px] font-bold text-text-muted uppercase tracking-wider">Price</label>
                <input
                  type="number" step="0.01" min="0" max="1"
                  value={weightInputs.price}
                  onChange={e => setWeightInputs(prev => ({ ...prev, price: e.target.value }))}
                  className="mt-1 w-full px-2.5 py-1.5 text-xs border border-border rounded-lg bg-surface-1 text-text-primary outline-none focus:border-accent"
                />
              </div>
              <div>
                <label className="text-[10px] font-bold text-text-muted uppercase tracking-wider">Features</label>
                <input
                  type="number" step="0.01" min="0" max="1"
                  value={weightInputs.feature}
                  onChange={e => setWeightInputs(prev => ({ ...prev, feature: e.target.value }))}
                  className="mt-1 w-full px-2.5 py-1.5 text-xs border border-border rounded-lg bg-surface-1 text-text-primary outline-none focus:border-accent"
                />
              </div>
            </div>
            <div className="flex items-center justify-between">
              <p className="text-[10px] text-text-muted">
                Sum: {weightSum.toFixed(2)} {Math.abs(weightSum - 1) > 0.001 ? "— will be normalized to 1.0 on save" : ""}
              </p>
              <button
                type="button"
                onClick={handleSaveWeights}
                disabled={savingWeights}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-accent hover:bg-accent-hover text-white text-[11px] font-bold rounded-lg transition-colors disabled:opacity-50"
              >
                {savingWeights ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                <span>Save weights</span>
              </button>
            </div>
          </div>

          <div className="space-y-5">
            {domains.map(domain => {
              const domainFamilies = families.filter(f => f.domain === domain);
              return (
                <div key={domain} className="border border-border rounded-xl overflow-hidden">
                  <div className="px-4 py-3 bg-surface-3/30 border-b border-border">
                    <h2 className="text-xs font-bold text-text-primary">{DOMAIN_LABELS[domain] || domain}</h2>
                  </div>
                  <div className="p-4 space-y-2">
                    {domainFamilies.map((family, i) => (
                      <div
                        key={family.id}
                        className={`flex items-center gap-2 px-3 py-2 rounded-lg border ${
                          family.enabled ? "border-border bg-surface-1" : "border-border/50 bg-surface-3/20 opacity-60"
                        }`}
                      >
                        <div className="flex flex-col -my-1">
                          <button type="button" onClick={() => handleMove(domainFamilies, i, -1)} disabled={i === 0} className="p-0.5 text-text-muted hover:text-text-primary disabled:opacity-30">
                            <ArrowUp className="w-3 h-3" />
                          </button>
                          <button type="button" onClick={() => handleMove(domainFamilies, i, 1)} disabled={i === domainFamilies.length - 1} className="p-0.5 text-text-muted hover:text-text-primary disabled:opacity-30">
                            <ArrowDown className="w-3 h-3" />
                          </button>
                        </div>
                        <div className="flex-1 min-w-0">
                          <span className="text-xs font-semibold text-text-primary">{family.label}</span>
                          {family.modifier && <span className="ml-2 text-[10px] text-accent">modifier</span>}
                          {family.aliases.length > 0 && <span className="ml-2 text-[10px] text-text-muted">aka {family.aliases.join(", ")}</span>}
                          {family.adjacent_families.length > 0 && <span className="ml-2 text-[10px] text-text-muted">adjacent: {family.adjacent_families.join(", ")}</span>}
                        </div>
                        <button
                          type="button"
                          onClick={() => handleToggleEnabled(family)}
                          disabled={busyId === family.id}
                          className={`px-2 py-0.5 rounded text-[10px] font-bold border transition-colors ${
                            family.enabled ? "border-success/30 text-success bg-success/10" : "border-border text-text-muted"
                          }`}
                        >
                          {family.enabled ? "Enabled" : "Disabled"}
                        </button>
                        <button
                          type="button"
                          onClick={() => handleRemove(family.id)}
                          disabled={busyId === family.id}
                          className="p-1 text-text-muted hover:text-danger transition-colors"
                          title="Remove family"
                        >
                          {busyId === family.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <X className="w-3.5 h-3.5" />}
                        </button>
                      </div>
                    ))}
                    <div className="flex items-center gap-2 pt-1">
                      <input
                        type="text"
                        value={newFamilyText[domain] || ""}
                        onChange={e => setNewFamilyText(prev => ({ ...prev, [domain]: e.target.value }))}
                        onKeyDown={e => e.key === "Enter" && handleAddFamily(domain)}
                        placeholder='Add a motor family — e.g. "Vector" or "Digital (Digital Motor, Smart Motor)"'
                        className="flex-1 px-2.5 py-1.5 text-[11px] border border-border rounded-lg bg-surface-1 text-text-primary outline-none focus:border-accent"
                      />
                      <button
                        type="button"
                        onClick={() => handleAddFamily(domain)}
                        className="flex items-center gap-1 px-2.5 py-1.5 bg-accent hover:bg-accent-hover text-white text-[11px] font-bold rounded-lg transition-colors"
                      >
                        <Plus className="w-3.5 h-3.5" /> Add
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
