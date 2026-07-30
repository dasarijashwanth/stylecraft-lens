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

interface MotorTechMiss {
  term: string;
  count: number;
  last_searched_at: string;
}

interface BrandedMotorName {
  id: string;
  brand_name: string;
  branded_term: string;
  family_key: string;
  enabled: boolean;
}

interface ToolTypeAdmin {
  id: string;
  type_key: string;
  label: string;
  aliases: string[];
  family: string | null;
  enabled: boolean;
  custom: boolean;
}

const TOOL_TYPE_FAMILY_LABELS: Record<string, string> = {
  clipper_trimmer_shaver: "Clippers, Trimmers & Shavers",
  beauty: "Beauty Tools",
};

interface BrandedMotorMiss {
  brand_name: string;
  term: string;
  count: number;
  last_searched_at: string;
  ai_guessed_family: string | null;
}

const DOMAIN_LABELS: Record<string, string> = {
  clipper_trimmer_shaver: "Clippers, Trimmers & Shavers",
  beauty: "Beauty Tools",
};

export default function CompetitorMatchingAdminPage() {
  const { user, loading: authLoading } = useAuth();
  const [families, setFamilies] = useState<MotorFamily[]>([]);
  const [misses, setMisses] = useState<MotorTechMiss[]>([]);
  const [brandedNames, setBrandedNames] = useState<BrandedMotorName[]>([]);
  const [weights, setWeights] = useState<Weights | null>(null);
  const [weightInputs, setWeightInputs] = useState({ motor: "0.45", price: "0.35", feature: "0.20" });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [savingWeights, setSavingWeights] = useState(false);
  const [newFamilyText, setNewFamilyText] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [newBranded, setNewBranded] = useState({ brandName: "", brandedTerm: "", familyKey: "" });
  const [savingBranded, setSavingBranded] = useState(false);
  const [brandedMisses, setBrandedMisses] = useState<BrandedMotorMiss[]>([]);
  const [classifying, setClassifying] = useState(false);
  const [dismissingMiss, setDismissingMiss] = useState<string | null>(null);
  const [toolTypesAdmin, setToolTypesAdmin] = useState<ToolTypeAdmin[]>([]);
  const [busyToolTypeId, setBusyToolTypeId] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const [famRes, weightRes, missRes, brandedRes, brandedMissRes, toolTypesRes] = await Promise.all([
        fetch("/api/admin/motor-families"),
        fetch("/api/admin/competitor-matching-config"),
        fetch("/api/admin/motor-families/misses"),
        fetch("/api/admin/branded-motor-map"),
        fetch("/api/admin/motor-families/branded-misses"),
        fetch("/api/admin/tool-types"),
      ]);
      const famData = await famRes.json();
      const weightData = await weightRes.json();
      const missData = await missRes.json();
      if (!famRes.ok) throw new Error(famData.error || "Failed to load motor families");
      if (!weightRes.ok) throw new Error(weightData.error || "Failed to load weights");
      setFamilies(famData.families || []);
      setWeights(weightData.weights);
      if (missRes.ok) setMisses(missData.misses || []);
      if (brandedRes.ok) {
        const brandedData = await brandedRes.json();
        setBrandedNames(brandedData.brandedNames || []);
      }
      if (brandedMissRes.ok) {
        const brandedMissData = await brandedMissRes.json();
        setBrandedMisses(brandedMissData.misses || []);
      }
      if (toolTypesRes.ok) {
        const toolTypesData = await toolTypesRes.json();
        setToolTypesAdmin(toolTypesData.toolTypes || []);
      }
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

  async function handleAddBranded() {
    if (!newBranded.brandName.trim() || !newBranded.brandedTerm.trim() || !newBranded.familyKey) {
      toast.error("Brand, branded term, and family are all required");
      return;
    }
    setSavingBranded(true);
    try {
      const res = await fetch("/api/admin/branded-motor-map", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(newBranded),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to add branded motor name");
      setNewBranded({ brandName: "", brandedTerm: "", familyKey: "" });
      toast.success(`Added ${newBranded.brandName} → ${newBranded.brandedTerm}`);
      await load();
    } catch (err: any) {
      toast.error(err.message || "Failed to add branded motor name");
    } finally {
      setSavingBranded(false);
    }
  }

  async function handleToggleBranded(entry: BrandedMotorName) {
    setBusyId(entry.id);
    try {
      const res = await fetch(`/api/admin/branded-motor-map/${entry.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: !entry.enabled }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to update branded motor name");
      await load();
    } catch (err: any) {
      toast.error(err.message || "Failed to update branded motor name");
    } finally {
      setBusyId(null);
    }
  }

  async function handleRemoveBranded(id: string) {
    setBusyId(id);
    try {
      const res = await fetch(`/api/admin/branded-motor-map/${id}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to remove branded motor name");
      await load();
    } catch (err: any) {
      toast.error(err.message || "Failed to remove branded motor name");
    } finally {
      setBusyId(null);
    }
  }

  // Prefills the Branded Motor Names add-form below (per-field state
  // already backs that form) — the admin still confirms/adjusts the family
  // and clicks Add themselves, this just saves the retyping.
  function handlePrefillBrandedFromMiss(miss: BrandedMotorMiss) {
    setNewBranded({ brandName: miss.brand_name, brandedTerm: miss.term, familyKey: miss.ai_guessed_family || "" });
    toast.success(`Prefilled the Branded Motor Names form below — review and click Add`);
  }

  async function handleClassifyBrandedMisses() {
    setClassifying(true);
    try {
      const res = await fetch("/api/admin/motor-families/branded-misses", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to classify branded motor misses");
      setBrandedMisses(data.misses || []);
      toast.success(data.updated > 0 ? `AI classified ${data.updated} term(s)` : "No new classifications — check back after more analyses run, or add manually");
    } catch (err: any) {
      toast.error(err.message || "Failed to classify branded motor misses");
    } finally {
      setClassifying(false);
    }
  }

  async function handleDismissBrandedMiss(miss: BrandedMotorMiss) {
    const key = `${miss.brand_name}|${miss.term}`;
    setDismissingMiss(key);
    try {
      const res = await fetch("/api/admin/motor-families/branded-misses", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ brandName: miss.brand_name, term: miss.term }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to dismiss");
      setBrandedMisses(prev => prev.filter(m => !(m.brand_name === miss.brand_name && m.term === miss.term)));
    } catch (err: any) {
      toast.error(err.message || "Failed to dismiss");
    } finally {
      setDismissingMiss(null);
    }
  }

  async function handleToggleToolType(toolType: ToolTypeAdmin) {
    setBusyToolTypeId(toolType.id);
    try {
      const res = await fetch(`/api/admin/tool-types/${toolType.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: !toolType.enabled }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to update tool type");
      await load();
    } catch (err: any) {
      toast.error(err.message || "Failed to update tool type");
    } finally {
      setBusyToolTypeId(null);
    }
  }

  async function handleRemoveToolType(id: string) {
    setBusyToolTypeId(id);
    try {
      const res = await fetch(`/api/admin/tool-types/${id}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to remove tool type");
      await load();
    } catch (err: any) {
      toast.error(err.message || "Failed to remove tool type");
    } finally {
      setBusyToolTypeId(null);
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

          <div className="space-y-5">
            <h2 className="text-sm font-bold text-text-primary">Tool Types</h2>
            <p className="text-xs text-text-muted -mt-3">
              The strict tool-type isolation vocabulary (lib/tool-type-taxonomy.ts) — built-ins plus any custom type added inline from the analyze/new-project forms. Disabling a type removes it from both forms&apos; selects without deleting its history.
            </p>
            {Array.from(new Set(toolTypesAdmin.map(t => t.family || "either"))).map(familyKey => {
              const familyTypes = toolTypesAdmin.filter(t => (t.family || "either") === familyKey);
              return (
                <div key={familyKey} className="border border-border rounded-xl overflow-hidden">
                  <div className="px-4 py-3 bg-surface-3/30 border-b border-border">
                    <h3 className="text-xs font-bold text-text-primary">{familyKey === "either" ? "Either Industry" : (TOOL_TYPE_FAMILY_LABELS[familyKey] || familyKey)}</h3>
                  </div>
                  <div className="p-4 space-y-2">
                    {familyTypes.map(t => (
                      <div
                        key={t.id}
                        className={`flex items-center gap-2 px-3 py-2 rounded-lg border ${
                          t.enabled ? "border-border bg-surface-1" : "border-border/50 bg-surface-3/20 opacity-60"
                        }`}
                      >
                        <div className="flex-1 min-w-0">
                          <span className="text-xs font-semibold text-text-primary">{t.label}</span>
                          {t.custom && <span className="ml-2 text-[10px] text-accent">custom</span>}
                          {t.aliases.length > 0 && <span className="ml-2 text-[10px] text-text-muted">aka {t.aliases.join(", ")}</span>}
                        </div>
                        <button
                          type="button"
                          onClick={() => handleToggleToolType(t)}
                          disabled={busyToolTypeId === t.id}
                          className={`px-2 py-0.5 rounded text-[10px] font-bold border transition-colors ${
                            t.enabled ? "border-success/30 text-success bg-success/10" : "border-border text-text-muted"
                          }`}
                        >
                          {t.enabled ? "Enabled" : "Disabled"}
                        </button>
                        {t.custom && (
                          <button
                            type="button"
                            onClick={() => handleRemoveToolType(t.id)}
                            disabled={busyToolTypeId === t.id}
                            className="p-1 text-text-muted hover:text-danger transition-colors"
                            title="Remove custom tool type"
                          >
                            {busyToolTypeId === t.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <X className="w-3.5 h-3.5" />}
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>

          <div className="border border-border rounded-xl overflow-hidden">
            <div className="px-4 py-3 bg-surface-3/30 border-b border-border">
              <h2 className="text-xs font-bold text-text-primary">Branded Motor Names</h2>
              <p className="text-[10px] text-text-muted mt-0.5">
                A brand&apos;s own proprietary marketing name for a motor (e.g. &quot;IN3&quot; → Vector Motor) — kept separate from the generic aliases above since a proprietary term only applies to the brand that owns it, never to every brand&apos;s products.
              </p>
            </div>
            <div className="p-4 space-y-2">
              {brandedNames.map(entry => {
                const family = families.find(f => f.family_key === entry.family_key);
                return (
                  <div
                    key={entry.id}
                    className={`flex items-center gap-2 px-3 py-2 rounded-lg border ${
                      entry.enabled ? "border-border bg-surface-1" : "border-border/50 bg-surface-3/20 opacity-60"
                    }`}
                  >
                    <div className="flex-1 min-w-0 text-xs">
                      <span className="font-semibold text-text-primary">{entry.brand_name}</span>
                      <span className="text-text-muted"> — &quot;{entry.branded_term}&quot; → </span>
                      <span className="font-semibold text-text-primary">{family?.label || entry.family_key}</span>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleToggleBranded(entry)}
                      disabled={busyId === entry.id}
                      className={`px-2 py-0.5 rounded text-[10px] font-bold border transition-colors ${
                        entry.enabled ? "border-success/30 text-success bg-success/10" : "border-border text-text-muted"
                      }`}
                    >
                      {entry.enabled ? "Enabled" : "Disabled"}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleRemoveBranded(entry.id)}
                      disabled={busyId === entry.id}
                      className="p-1 text-text-muted hover:text-danger transition-colors"
                      title="Remove"
                    >
                      {busyId === entry.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <X className="w-3.5 h-3.5" />}
                    </button>
                  </div>
                );
              })}
              <div className="flex items-center gap-2 pt-1">
                <input
                  type="text"
                  value={newBranded.brandName}
                  onChange={e => setNewBranded(prev => ({ ...prev, brandName: e.target.value }))}
                  placeholder="Brand — e.g. Wahl"
                  className="w-32 px-2.5 py-1.5 text-[11px] border border-border rounded-lg bg-surface-1 text-text-primary outline-none focus:border-accent"
                />
                <input
                  type="text"
                  value={newBranded.brandedTerm}
                  onChange={e => setNewBranded(prev => ({ ...prev, brandedTerm: e.target.value }))}
                  placeholder="Branded term — e.g. IN3"
                  className="flex-1 px-2.5 py-1.5 text-[11px] border border-border rounded-lg bg-surface-1 text-text-primary outline-none focus:border-accent"
                />
                <select
                  value={newBranded.familyKey}
                  onChange={e => setNewBranded(prev => ({ ...prev, familyKey: e.target.value }))}
                  className="px-2.5 py-1.5 text-[11px] border border-border rounded-lg bg-surface-1 text-text-primary outline-none focus:border-accent"
                >
                  <option value="">Family…</option>
                  {families.map(f => (
                    <option key={f.family_key} value={f.family_key}>{f.label}</option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={handleAddBranded}
                  disabled={savingBranded}
                  className="flex items-center gap-1 px-2.5 py-1.5 bg-accent hover:bg-accent-hover text-white text-[11px] font-bold rounded-lg transition-colors disabled:opacity-50"
                >
                  {savingBranded ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
                  <span>Add</span>
                </button>
              </div>
            </div>
          </div>

          {misses.length > 0 && (
            <div className="border border-border rounded-xl overflow-hidden">
              <div className="px-4 py-3 bg-surface-3/30 border-b border-border">
                <h2 className="text-xs font-bold text-text-primary">Unrecognized Motor Technology entries</h2>
                <p className="text-[10px] text-text-muted mt-0.5">
                  Free-text Motor Technology values submitted on the analyze/new-project forms that didn&apos;t match any family above — kept verbatim on their analysis, never guessed. Consider adding one as a new family or alias.
                </p>
              </div>
              <div className="p-4 space-y-1.5">
                {misses.map(m => (
                  <div key={m.term} className="flex items-center justify-between px-3 py-1.5 rounded-lg border border-border bg-surface-1 text-[11px]">
                    <span className="font-semibold text-text-primary">{m.term}</span>
                    <span className="text-text-muted">{m.count}x · last {new Date(m.last_searched_at).toLocaleDateString()}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {brandedMisses.length > 0 && (
            <div className="border border-border rounded-xl overflow-hidden">
              <div className="px-4 py-3 bg-surface-3/30 border-b border-border flex items-center justify-between gap-3">
                <div>
                  <h2 className="text-xs font-bold text-text-primary">Unclassified Branded Motor Names</h2>
                  <p className="text-[10px] text-text-muted mt-0.5">
                    Competitor listing text that named a proprietary motor phrase but matched neither the generic taxonomy nor a known brand entry above. &quot;Use this →&quot; prefills the Branded Motor Names form so you can confirm the family and add it in one click.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={handleClassifyBrandedMisses}
                  disabled={classifying}
                  className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 bg-surface-1 border border-border hover:border-accent text-text-primary text-[11px] font-bold rounded-lg transition-colors disabled:opacity-50"
                >
                  {classifying ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
                  <span>Classify with AI</span>
                </button>
              </div>
              <div className="p-4 space-y-1.5">
                {brandedMisses.map(m => {
                  const guessedFamily = families.find(f => f.family_key === m.ai_guessed_family);
                  const key = `${m.brand_name}|${m.term}`;
                  return (
                    <div key={key} className="flex items-center gap-2 px-3 py-2 rounded-lg border border-border bg-surface-1 text-[11px]">
                      <div className="flex-1 min-w-0">
                        <span className="font-semibold text-text-primary">{m.brand_name}</span>
                        <span className="text-text-muted"> — &quot;{m.term}&quot;</span>
                        {guessedFamily && (
                          <span className="text-text-muted"> · AI guess: <span className="font-semibold text-text-primary">{guessedFamily.label}</span></span>
                        )}
                        <span className="text-text-muted"> · {m.count}x · last {new Date(m.last_searched_at).toLocaleDateString()}</span>
                      </div>
                      <button
                        type="button"
                        onClick={() => handlePrefillBrandedFromMiss(m)}
                        className="shrink-0 px-2 py-1 rounded text-[10px] font-bold border border-accent/40 text-accent hover:bg-accent/10 transition-colors"
                      >
                        Use this →
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDismissBrandedMiss(m)}
                        disabled={dismissingMiss === key}
                        className="shrink-0 p-1 text-text-muted hover:text-danger transition-colors"
                        title="Dismiss"
                      >
                        {dismissingMiss === key ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <X className="w-3.5 h-3.5" />}
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
