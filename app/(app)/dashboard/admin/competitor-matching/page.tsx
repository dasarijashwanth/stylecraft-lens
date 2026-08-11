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

interface ScoringProfile {
  id: string;
  type_key: string | null; // null = the global default/fallback profile
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
  primary_criterion: "motor" | "heat_technology" | "none";
  enabled: boolean;
  custom: boolean;
}

const CRITERION_LABELS: Record<string, string> = {
  motor: "Motor",
  heat_technology: "Heat/Plate Technology",
  none: "None",
};

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

interface GroomingGateRule {
  id: string;
  rule_type: string;
  value: string;
  label: string | null;
  enabled: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

interface GroomingGateIncident {
  id: string;
  analysis_id: string | null;
  phase: string;
  candidate_name: string | null;
  candidate_asin: string | null;
  candidate_brand: string | null;
  category_path: string | null;
  failed_rule: string | null;
  detail: string | null;
  dismissed_at: string | null;
  created_at: string;
}

const RULE_TYPE_ORDER = [
  "allow_category_segment",
  "block_category_segment",
  "required_keyword",
  "disqualifying_keyword",
  "trimmer_cosignal_keyword",
  "cross_domain_use_phrase",
  "component_disqualifier",
  "confidence_threshold",
];

const RULE_TYPE_LABELS: Record<string, string> = {
  allow_category_segment: "Allow Category Segments",
  block_category_segment: "Block Category Segments",
  required_keyword: "Required Keywords",
  disqualifying_keyword: "Disqualifying Keywords",
  trimmer_cosignal_keyword: "Trimmer Co-signal Keywords",
  component_disqualifier: "Component Disqualifiers",
  cross_domain_use_phrase: "Cross-Domain Use Phrases",
  confidence_threshold: "Confidence Threshold",
};

const RULE_TYPE_DESCRIPTIONS: Record<string, string> = {
  allow_category_segment: 'Amazon category path segments that pass the gate outright — e.g. "Hair Clippers".',
  block_category_segment: 'Amazon category path segments that fail the gate outright — e.g. "Lawn & Garden".',
  required_keyword: "At least one of these must appear in the title/description/bullets whenever the category can't conclusively resolve the gate.",
  disqualifying_keyword: "Any of these appearing anywhere disqualifies the candidate outright.",
  trimmer_cosignal_keyword: 'When the only required-keyword hit is a bare "trimmer" plus an outdoor/garden signal, one of these must also appear (e.g. beard, hair, barber) or the candidate is rejected.',
  component_disqualifier: 'Phrases indicating a bare component/part rather than a finished appliance (e.g. "replacement motor") — disqualifies unless the text also names a real grooming appliance.',
  cross_domain_use_phrase: "Phrases indicating the product is marketed for a different domain's use case entirely.",
  confidence_threshold: "Singleton — minimum same-tool-kind confidence score (0–1) required post-enrichment. Default 0.4.",
};

export default function CompetitorMatchingAdminPage() {
  const { user, loading: authLoading } = useAuth();
  const [families, setFamilies] = useState<MotorFamily[]>([]);
  const [misses, setMisses] = useState<MotorTechMiss[]>([]);
  const [brandedNames, setBrandedNames] = useState<BrandedMotorName[]>([]);
  const [scoringProfiles, setScoringProfiles] = useState<ScoringProfile[]>([]);
  // "" (empty string, not null — <select> values can't be null) selects the
  // global default profile itself; any other value is a real type_key.
  const [selectedProfileTypeKey, setSelectedProfileTypeKey] = useState<string>("");
  const [profileInputs, setProfileInputs] = useState({ motor: "45", price: "35", feature: "20" });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [savingWeights, setSavingWeights] = useState(false);
  const [resettingProfile, setResettingProfile] = useState(false);
  const [newFamilyText, setNewFamilyText] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [newBranded, setNewBranded] = useState({ brandName: "", brandedTerm: "", familyKey: "" });
  const [savingBranded, setSavingBranded] = useState(false);
  const [brandedMisses, setBrandedMisses] = useState<BrandedMotorMiss[]>([]);
  const [classifying, setClassifying] = useState(false);
  const [dismissingMiss, setDismissingMiss] = useState<string | null>(null);
  const [toolTypesAdmin, setToolTypesAdmin] = useState<ToolTypeAdmin[]>([]);
  const [busyToolTypeId, setBusyToolTypeId] = useState<string | null>(null);
  const [groomingGateRules, setGroomingGateRules] = useState<GroomingGateRule[]>([]);
  const [groomingGateIncidents, setGroomingGateIncidents] = useState<GroomingGateIncident[]>([]);
  const [newGateRuleText, setNewGateRuleText] = useState<Record<string, { value: string; label: string }>>({});
  const [busyGateRuleId, setBusyGateRuleId] = useState<string | null>(null);
  const [savingGateRuleType, setSavingGateRuleType] = useState<string | null>(null);
  const [dismissingIncidentId, setDismissingIncidentId] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const [famRes, profilesRes, missRes, brandedRes, brandedMissRes, toolTypesRes, gateRulesRes, gateIncidentsRes] = await Promise.all([
        fetch("/api/admin/motor-families"),
        fetch("/api/scoring-profiles"),
        fetch("/api/admin/motor-families/misses"),
        fetch("/api/admin/branded-motor-map"),
        fetch("/api/admin/motor-families/branded-misses"),
        fetch("/api/admin/tool-types"),
        fetch("/api/admin/grooming-gate"),
        fetch("/api/admin/grooming-gate/incidents"),
      ]);
      const famData = await famRes.json();
      const profilesData = await profilesRes.json();
      const missData = await missRes.json();
      if (!famRes.ok) throw new Error(famData.error || "Failed to load motor families");
      if (!profilesRes.ok) throw new Error(profilesData.error || "Failed to load scoring profiles");
      setFamilies(famData.families || []);
      const profiles: ScoringProfile[] = profilesData.profiles || [];
      setScoringProfiles(profiles);
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
      if (gateRulesRes.ok) {
        const gateRulesData = await gateRulesRes.json();
        setGroomingGateRules(gateRulesData.rules || []);
      }
      if (gateIncidentsRes.ok) {
        const gateIncidentsData = await gateIncidentsRes.json();
        setGroomingGateIncidents(gateIncidentsData.incidents || []);
      }
      // Re-derive the currently-selected profile's inputs from the freshly
      // loaded list (own row if present, else the global default) — keeps
      // the editor in sync after every load()/save()/reset().
      const own = selectedProfileTypeKey ? profiles.find(p => p.type_key === selectedProfileTypeKey) : undefined;
      const resolved = own || profiles.find(p => p.type_key === null);
      if (resolved) {
        setProfileInputs({ motor: String(resolved.motor_weight), price: String(resolved.price_weight), feature: String(resolved.feature_weight) });
      }
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

  // Switches which profile the editor shows — own row if the type has one,
  // else the global default's current values (with an "using global
  // default" note in the UI, since saving here would CREATE that type's
  // own override row, not silently edit the shared default).
  function handleSelectProfile(typeKey: string) {
    setSelectedProfileTypeKey(typeKey);
    const own = typeKey ? scoringProfiles.find(p => p.type_key === typeKey) : undefined;
    const resolved = own || scoringProfiles.find(p => p.type_key === null);
    if (resolved) {
      setProfileInputs({ motor: String(resolved.motor_weight), price: String(resolved.price_weight), feature: String(resolved.feature_weight) });
    }
  }

  async function handleSaveWeights() {
    setSavingWeights(true);
    try {
      const res = await fetch("/api/admin/scoring-profiles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          typeKey: selectedProfileTypeKey || null,
          motor: Number(profileInputs.motor),
          price: Number(profileInputs.price),
          feature: Number(profileInputs.feature),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to save weights");
      toast.success(selectedProfileTypeKey ? "Profile saved for this tool type" : "Global default profile saved");
      await load();
    } catch (err: any) {
      toast.error(err.message || "Failed to save weights");
    } finally {
      setSavingWeights(false);
    }
  }

  // Deletes the type-specific override row so resolution falls back to the
  // global default — never available for the global default row itself.
  async function handleResetProfile() {
    if (!selectedProfileTypeKey) return;
    setResettingProfile(true);
    try {
      const res = await fetch("/api/admin/scoring-profiles", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ typeKey: selectedProfileTypeKey }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to reset profile");
      toast.success("Reset to global default");
      await load();
    } catch (err: any) {
      toast.error(err.message || "Failed to reset profile");
    } finally {
      setResettingProfile(false);
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

  async function handleAddGateRule(ruleType: string) {
    const entry = newGateRuleText[ruleType] || { value: "", label: "" };
    const value = entry.value.trim();
    if (!value) return;
    setSavingGateRuleType(ruleType);
    try {
      const res = await fetch("/api/admin/grooming-gate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ruleType, value, label: entry.label.trim() || undefined }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to add rule");
      setNewGateRuleText(prev => ({ ...prev, [ruleType]: { value: "", label: "" } }));
      toast.success(`Added to ${RULE_TYPE_LABELS[ruleType] || ruleType}`);
      await load();
    } catch (err: any) {
      toast.error(err.message || "Failed to add rule");
    } finally {
      setSavingGateRuleType(null);
    }
  }

  async function handleToggleGateRule(rule: GroomingGateRule) {
    setBusyGateRuleId(rule.id);
    try {
      const res = await fetch(`/api/admin/grooming-gate/${rule.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: !rule.enabled }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to update rule");
      await load();
    } catch (err: any) {
      toast.error(err.message || "Failed to update rule");
    } finally {
      setBusyGateRuleId(null);
    }
  }

  async function handleRemoveGateRule(id: string) {
    setBusyGateRuleId(id);
    try {
      const res = await fetch(`/api/admin/grooming-gate/${id}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to remove rule");
      await load();
    } catch (err: any) {
      toast.error(err.message || "Failed to remove rule");
    } finally {
      setBusyGateRuleId(null);
    }
  }

  async function handleMoveGateRule(typeRules: GroomingGateRule[], index: number, direction: -1 | 1) {
    const targetIndex = index + direction;
    if (targetIndex < 0 || targetIndex >= typeRules.length) return;
    const reordered = [...typeRules];
    [reordered[index], reordered[targetIndex]] = [reordered[targetIndex], reordered[index]];

    try {
      const res = await fetch("/api/admin/grooming-gate/reorder", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderedIds: reordered.map(r => r.id) }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to reorder");
      await load();
    } catch (err: any) {
      toast.error(err.message || "Failed to reorder");
    }
  }

  async function handleDismissGateIncident(id: string) {
    setDismissingIncidentId(id);
    try {
      const res = await fetch("/api/admin/grooming-gate/incidents", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to dismiss incident");
      setGroomingGateIncidents(prev => prev.filter(i => i.id !== id));
    } catch (err: any) {
      toast.error(err.message || "Failed to dismiss incident");
    } finally {
      setDismissingIncidentId(null);
    }
  }

  // Prefills the Block Category Segments add-form below from a manual_removal
  // incident's own category path — the admin still confirms and clicks Add
  // themselves, mirroring handlePrefillBrandedFromMiss's "AI/system suggests,
  // admin confirms" convention used for branded motor misses above.
  function handlePrefillBlockCategoryFromIncident(incident: GroomingGateIncident) {
    if (!incident.category_path) return;
    setNewGateRuleText(prev => ({ ...prev, block_category_segment: { value: incident.category_path || "", label: incident.candidate_name || "" } }));
    toast.success("Prefilled the Block Category Segments form below — review and click Add");
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

  const weightSum = (Number(profileInputs.motor) || 0) + (Number(profileInputs.price) || 0) + (Number(profileInputs.feature) || 0);
  const effectivePct = (raw: string) => (weightSum > 0 ? Math.round(((Number(raw) || 0) / weightSum) * 100) : 0);
  const selectedToolType = toolTypesAdmin.find(t => t.type_key === selectedProfileTypeKey);
  const criterionLabel = selectedProfileTypeKey ? (CRITERION_LABELS[selectedToolType?.primary_criterion || "motor"] || "Motor") : "Motor";
  const hasOwnProfile = !!selectedProfileTypeKey && scoringProfiles.some(p => p.type_key === selectedProfileTypeKey);
  const domains = Array.from(new Set(families.map(f => f.domain)));
  const knownRuleTypes = new Set(RULE_TYPE_ORDER);
  const extraRuleTypes = Array.from(new Set(groomingGateRules.map(r => r.rule_type).filter(rt => !knownRuleTypes.has(rt))));
  const gateRuleGroups = [...RULE_TYPE_ORDER, ...extraRuleTypes].map(ruleType => ({
    ruleType,
    rules: groomingGateRules.filter(r => r.rule_type === ruleType).sort((a, b) => a.sort_order - b.sort_order),
  }));

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
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-xs font-bold text-text-primary">Scoring Weights</h2>
              <select
                value={selectedProfileTypeKey}
                onChange={e => handleSelectProfile(e.target.value)}
                className="px-2.5 py-1.5 text-[11px] border border-border rounded-lg bg-surface-1 text-text-primary outline-none focus:border-accent"
              >
                <option value="">Global default</option>
                {toolTypesAdmin.map(t => (
                  <option key={t.type_key} value={t.type_key}>{t.label}</option>
                ))}
              </select>
            </div>
            <p className="text-[10px] text-text-muted">
              Enter any non-negative numbers expressing RELATIVE importance — no need to sum to 1 or 100, the effective share is computed automatically.
              {selectedProfileTypeKey && !hasOwnProfile && " This type has no profile of its own yet — showing the global default; saving here creates its own override."}
            </p>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="text-[10px] font-bold text-text-muted uppercase tracking-wider">{criterionLabel}</label>
                <input
                  type="number" step="1" min="0"
                  value={profileInputs.motor}
                  onChange={e => setProfileInputs(prev => ({ ...prev, motor: e.target.value }))}
                  className="mt-1 w-full px-2.5 py-1.5 text-xs border border-border rounded-lg bg-surface-1 text-text-primary outline-none focus:border-accent"
                />
                <p className="mt-0.5 text-[10px] text-text-muted">→ {effectivePct(profileInputs.motor)}%</p>
              </div>
              <div>
                <label className="text-[10px] font-bold text-text-muted uppercase tracking-wider">Price</label>
                <input
                  type="number" step="1" min="0"
                  value={profileInputs.price}
                  onChange={e => setProfileInputs(prev => ({ ...prev, price: e.target.value }))}
                  className="mt-1 w-full px-2.5 py-1.5 text-xs border border-border rounded-lg bg-surface-1 text-text-primary outline-none focus:border-accent"
                />
                <p className="mt-0.5 text-[10px] text-text-muted">→ {effectivePct(profileInputs.price)}%</p>
              </div>
              <div>
                <label className="text-[10px] font-bold text-text-muted uppercase tracking-wider">Features</label>
                <input
                  type="number" step="1" min="0"
                  value={profileInputs.feature}
                  onChange={e => setProfileInputs(prev => ({ ...prev, feature: e.target.value }))}
                  className="mt-1 w-full px-2.5 py-1.5 text-xs border border-border rounded-lg bg-surface-1 text-text-primary outline-none focus:border-accent"
                />
                <p className="mt-0.5 text-[10px] text-text-muted">→ {effectivePct(profileInputs.feature)}%</p>
              </div>
            </div>
            <div className="flex items-center justify-between">
              {weightSum <= 0 ? (
                <p className="text-[10px] text-danger">At least one criterion must be &gt; 0</p>
              ) : (
                <p className="text-[10px] text-text-muted">
                  {criterionLabel} {profileInputs.motor || 0} → {effectivePct(profileInputs.motor)}% · Price {profileInputs.price || 0} → {effectivePct(profileInputs.price)}% · Features {profileInputs.feature || 0} → {effectivePct(profileInputs.feature)}%
                </p>
              )}
              <div className="flex items-center gap-2">
                {selectedProfileTypeKey && hasOwnProfile && (
                  <button
                    type="button"
                    onClick={handleResetProfile}
                    disabled={resettingProfile}
                    className="px-2.5 py-1.5 text-[11px] font-semibold text-text-muted hover:text-danger transition-colors disabled:opacity-50"
                  >
                    {resettingProfile ? "Resetting…" : "Reset to default"}
                  </button>
                )}
                <button
                  type="button"
                  onClick={handleSaveWeights}
                  disabled={savingWeights || weightSum <= 0}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-accent hover:bg-accent-hover text-white text-[11px] font-bold rounded-lg transition-colors disabled:opacity-50"
                >
                  {savingWeights ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                  <span>Save {selectedProfileTypeKey ? "profile" : "global default"}</span>
                </button>
              </div>
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

          <div className="space-y-5">
            <h2 className="text-sm font-bold text-text-primary">Grooming Industry Gate Rules</h2>
            <p className="text-xs text-text-muted -mt-3">
              The hard, fail-closed grooming/beauty industry gate (lib/grooming-industry-gate.ts) that runs before motor/price scoring — rejects out-of-industry candidates (e.g. a weed-wacker showing up as a &quot;competitor&quot; for a hair clipper) using the rules below. Changes apply to future analyses only.
            </p>
            {gateRuleGroups.map(({ ruleType, rules }) => (
              <div key={ruleType} className="border border-border rounded-xl overflow-hidden">
                <div className="px-4 py-3 bg-surface-3/30 border-b border-border">
                  <h3 className="text-xs font-bold text-text-primary">{RULE_TYPE_LABELS[ruleType] || ruleType}</h3>
                  {RULE_TYPE_DESCRIPTIONS[ruleType] && (
                    <p className="text-[10px] text-text-muted mt-0.5">{RULE_TYPE_DESCRIPTIONS[ruleType]}</p>
                  )}
                </div>
                <div className="p-4 space-y-2">
                  {rules.map((rule, i) => (
                    <div
                      key={rule.id}
                      className={`flex items-center gap-2 px-3 py-2 rounded-lg border ${
                        rule.enabled ? "border-border bg-surface-1" : "border-border/50 bg-surface-3/20 opacity-60"
                      }`}
                    >
                      <div className="flex flex-col -my-1">
                        <button type="button" onClick={() => handleMoveGateRule(rules, i, -1)} disabled={i === 0} className="p-0.5 text-text-muted hover:text-text-primary disabled:opacity-30">
                          <ArrowUp className="w-3 h-3" />
                        </button>
                        <button type="button" onClick={() => handleMoveGateRule(rules, i, 1)} disabled={i === rules.length - 1} className="p-0.5 text-text-muted hover:text-text-primary disabled:opacity-30">
                          <ArrowDown className="w-3 h-3" />
                        </button>
                      </div>
                      <div className="flex-1 min-w-0">
                        <span className="text-xs font-semibold text-text-primary">{rule.value}</span>
                        {rule.label && <span className="ml-2 text-[10px] text-text-muted">{rule.label}</span>}
                      </div>
                      <button
                        type="button"
                        onClick={() => handleToggleGateRule(rule)}
                        disabled={busyGateRuleId === rule.id}
                        className={`px-2 py-0.5 rounded text-[10px] font-bold border transition-colors ${
                          rule.enabled ? "border-success/30 text-success bg-success/10" : "border-border text-text-muted"
                        }`}
                      >
                        {rule.enabled ? "Enabled" : "Disabled"}
                      </button>
                      <button
                        type="button"
                        onClick={() => handleRemoveGateRule(rule.id)}
                        disabled={busyGateRuleId === rule.id}
                        className="p-1 text-text-muted hover:text-danger transition-colors"
                        title="Remove rule"
                      >
                        {busyGateRuleId === rule.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <X className="w-3.5 h-3.5" />}
                      </button>
                    </div>
                  ))}
                  <div className="flex items-center gap-2 pt-1">
                    <input
                      type="text"
                      value={newGateRuleText[ruleType]?.value || ""}
                      onChange={e => setNewGateRuleText(prev => ({ ...prev, [ruleType]: { value: e.target.value, label: prev[ruleType]?.label || "" } }))}
                      onKeyDown={e => e.key === "Enter" && handleAddGateRule(ruleType)}
                      placeholder={ruleType === "confidence_threshold" ? "Threshold — e.g. 0.4" : "Value — e.g. Lawn & Garden"}
                      className="flex-1 px-2.5 py-1.5 text-[11px] border border-border rounded-lg bg-surface-1 text-text-primary outline-none focus:border-accent"
                    />
                    <input
                      type="text"
                      value={newGateRuleText[ruleType]?.label || ""}
                      onChange={e => setNewGateRuleText(prev => ({ ...prev, [ruleType]: { value: prev[ruleType]?.value || "", label: e.target.value } }))}
                      onKeyDown={e => e.key === "Enter" && handleAddGateRule(ruleType)}
                      placeholder="Label (optional)"
                      className="w-40 px-2.5 py-1.5 text-[11px] border border-border rounded-lg bg-surface-1 text-text-primary outline-none focus:border-accent"
                    />
                    <button
                      type="button"
                      onClick={() => handleAddGateRule(ruleType)}
                      disabled={savingGateRuleType === ruleType}
                      className="flex items-center gap-1 px-2.5 py-1.5 bg-accent hover:bg-accent-hover text-white text-[11px] font-bold rounded-lg transition-colors disabled:opacity-50"
                    >
                      {savingGateRuleType === ruleType ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
                      <span>Add</span>
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>

          <div className="border border-border rounded-xl overflow-hidden">
            <div className="px-4 py-3 bg-surface-3/30 border-b border-border">
              <h2 className="text-xs font-bold text-text-primary">Gate Anomalies</h2>
              <p className="text-[10px] text-text-muted mt-0.5">
                Candidates rejected by the grooming/beauty industry gate — logged from the automated post-selection sweep (phase1/phase2) and from manual &quot;wrong industry&quot; removals. Dismiss once reviewed.
              </p>
            </div>
            {groomingGateIncidents.length === 0 ? (
              <div className="p-4 text-[11px] text-text-muted">No anomalies logged.</div>
            ) : (
              <div className="p-4 space-y-1.5">
                {groomingGateIncidents.map(incident => (
                  <div key={incident.id} className="flex items-start gap-2 px-3 py-2 rounded-lg border border-border bg-surface-1 text-[11px]">
                    <div className="flex-1 min-w-0 space-y-0.5">
                      <div>
                        <span className="font-semibold text-text-primary">{incident.candidate_name || "(unnamed candidate)"}</span>
                        {incident.candidate_brand && <span className="text-text-muted"> · {incident.candidate_brand}</span>}
                        {incident.candidate_asin && <span className="text-text-muted"> · {incident.candidate_asin}</span>}
                      </div>
                      {incident.category_path && <div className="text-text-muted">Category: {incident.category_path}</div>}
                      <div className="text-text-muted">
                        {incident.phase}
                        {incident.failed_rule && <> · failed: <span className="font-semibold text-text-primary">{incident.failed_rule}</span></>}
                        {incident.detail && <> · {incident.detail}</>}
                        {" · "}{new Date(incident.created_at).toLocaleDateString()}
                      </div>
                    </div>
                    {incident.phase === "manual_removal" && incident.category_path && (
                      <button
                        type="button"
                        onClick={() => handlePrefillBlockCategoryFromIncident(incident)}
                        className="shrink-0 px-2 py-1 rounded text-[10px] font-bold border border-accent/40 text-accent hover:bg-accent/10 transition-colors"
                      >
                        Add category to blocklist →
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => handleDismissGateIncident(incident.id)}
                      disabled={dismissingIncidentId === incident.id}
                      className="shrink-0 p-1 text-text-muted hover:text-danger transition-colors"
                      title="Dismiss"
                    >
                      {dismissingIncidentId === incident.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <X className="w-3.5 h-3.5" />}
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
