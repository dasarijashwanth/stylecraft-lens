"use client";

import { useState, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, Loader2, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { ProgressPanel } from "@/components/analyze/ProgressPanel";
import { ResultsPanel } from "@/components/analyze/ResultsPanel";
import { STYLECRAFT_PRODUCTS, PRODUCT_CATEGORIES } from "@/lib/stylecraft-products";
import { ToolType, getToolTypeLabel, toolTypesForIndustry, deriveToolTypeFromCatalogProduct } from "@/lib/tool-type-taxonomy";
import type { ToolTypeRow } from "@/lib/db/tool-types";
import { parsePriceToNumber } from "@/lib/pricing-analysis";

const TARGET_MARKET_LABELS: Record<string, string> = { pro: "Pro / Salon", consumer: "Retail", both: "Both" };

// Sentinel select value that opens the inline "add new tool type" mini-form
// below, instead of being a real tool type itself.
const ADD_NEW_TOOL_TYPE = "__add_new__";

interface MotorFamilyOption {
  family_key: string;
  label: string;
  domain: string;
  aliases: string[];
}

// The parallel Heat/Plate Technology option shape — a full parallel to
// MotorFamilyOption for motorless styling tools (flat iron/curling iron/
// hot brush), minus the domain field (not needed here).
interface HeatTechFamilyOption {
  family_key: string;
  label: string;
  aliases: string[];
}

const CRITERION_LABELS: Record<string, string> = {
  motor: "Motor",
  heat_technology: "Heat/Plate Technology",
  none: "None",
};

interface ScoringProfileOption {
  type_key: string | null;
  motor_weight: number;
  price_weight: number;
  feature_weight: number;
}

function normalizeMotorToken(s: string): string {
  return (s || "").toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9\s]/g, " ").trim();
}

// Lightweight, self-contained mirror of lib/motor-taxonomy.ts's
// matchMotorFamily (whole-word alias containment) — deliberately NOT
// importing that module here, since it transitively pulls in server-only
// code (Supabase admin client, Rainforest calls) that must never reach a
// "use client" bundle. Families arrive from GET /api/motor-families already
// sorted by sort_order, so iterating in array order approximates the same
// first-match-wins precedence.
function detectMotorFamilyFromText(text: string, families: MotorFamilyOption[]): string | null {
  const tokens = new Set(normalizeMotorToken(text).split(/\s+/).filter(Boolean));
  if (tokens.size === 0) return null;
  for (const f of families) {
    const candidates = [f.label, f.family_key.replace(/_/g, " "), ...f.aliases];
    for (const c of candidates) {
      const cTokens = normalizeMotorToken(c).split(/\s+/).filter(Boolean);
      if (cTokens.length > 0 && cTokens.every(t => tokens.has(t))) return f.family_key;
    }
  }
  return null;
}

// Full parallel to detectMotorFamilyFromText for the Heat/Plate Technology
// criterion — same whole-word alias containment, same reasoning for not
// importing lib/heat-tech-taxonomy.ts directly into a client bundle.
function detectHeatTechFamilyFromText(text: string, families: HeatTechFamilyOption[]): string | null {
  const tokens = new Set(normalizeMotorToken(text).split(/\s+/).filter(Boolean));
  if (tokens.size === 0) return null;
  for (const f of families) {
    const candidates = [f.label, f.family_key.replace(/_/g, " "), ...f.aliases];
    for (const c of candidates) {
      const cTokens = normalizeMotorToken(c).split(/\s+/).filter(Boolean);
      if (cTokens.length > 0 && cTokens.every(t => tokens.has(t))) return f.family_key;
    }
  }
  return null;
}

export default function AnalyzePage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  
  const projectIdParam = searchParams.get("projectId");
  const pastAnalysisId = searchParams.get("id");

  // App view state: 'form' | 'running' | 'results'
  const [viewState, setViewState] = useState<"form" | "running" | "results">("form");
  const [analysisId, setAnalysisId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [errors, setErrors] = useState<{ [key: string]: string }>({});

  // Form Fields State
  const [selectedProductId, setSelectedProductId] = useState("");
  const [industry, setIndustry] = useState("grooming-barbering");
  const [targetMarket, setTargetMarket] = useState<"pro" | "consumer" | "both">("both");
  const [productName, setProductName] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState("");
  // Strict tool-type isolation (lib/tool-type-taxonomy.ts) — required so a
  // trimmer analysis can never pull in clipper data (or vice versa). Kept
  // separate from the free-text "category" field above, which is not
  // reliable enough on its own to gate competitor/spec/review selection.
  const [toolType, setToolType] = useState<ToolType | "">("");
  const [pricePoint, setPricePoint] = useState("");
  const [companyContext, setCompanyContext] = useState("");
  // Canonical motor type — one of the 7 fixed families (lib/validations.ts's
  // MOTOR_FAMILY_VALUES); matching/grounding always uses this, never
  // motorBrandedName below. motorBrandedName is an optional, display-only
  // marketing name (e.g. "EON Digital Brushless Motor") shown in documents
  // alongside the canonical family, never used for matching.
  const [motorFamily, setMotorFamily] = useState("");
  const [motorBrandedName, setMotorBrandedName] = useState("");
  // Full parallel to motorFamily/motorBrandedName for the Heat/Plate
  // Technology criterion (flat iron/curling iron/hot brush) — see
  // CRITERION_LABELS / primaryCriterion below for which one actually shows.
  const [heatTechFamily, setHeatTechFamily] = useState("");
  const [heatTechBrandedName, setHeatTechBrandedName] = useState("");
  const [keyDiff, setKeyDiff] = useState("");
  const [motorFamilies, setMotorFamilies] = useState<MotorFamilyOption[]>([]);
  const [heatTechFamilies, setHeatTechFamilies] = useState<HeatTechFamilyOption[]>([]);
  const [toolTypes, setToolTypes] = useState<ToolTypeRow[]>([]);
  // "+ Add new tool type…" inline mini-form state.
  const [showAddToolType, setShowAddToolType] = useState(false);
  const [newToolTypeName, setNewToolTypeName] = useState("");
  const [newToolTypeSynonyms, setNewToolTypeSynonyms] = useState("");
  const [addingToolType, setAddingToolType] = useState(false);
  const [toolTypeDupSuggestion, setToolTypeDupSuggestion] = useState<{ label: string; type_key: string } | null>(null);

  // Populates the Motor Type <select> with the real, fixed 7-family
  // taxonomy (lib/motor-taxonomy.ts).
  useEffect(() => {
    fetch("/api/motor-families")
      .then(r => r.json())
      .then(data => setMotorFamilies(data.families || []))
      .catch(() => {});
  }, []);

  // Populates the Heat/Plate Technology <select> with the real taxonomy
  // (lib/heat-tech-taxonomy.ts) — full parallel to the Motor Type fetch
  // above, shown instead of it for motorless styling tools.
  useEffect(() => {
    fetch("/api/heat-tech-families")
      .then(r => r.json())
      .then(data => setHeatTechFamilies(data.families || []))
      .catch(() => {});
  }, []);

  // Populates the Tool Type <select> with the real, DB-backed taxonomy
  // (built-ins + any admin/user-added custom types) — lib/db/tool-types.ts.
  useEffect(() => {
    fetch("/api/tool-types")
      .then(r => r.json())
      .then(data => setToolTypes(data.toolTypes || []))
      .catch(() => {});
  }, []);

  // Which criterion drives matching for the SELECTED tool type
  // (lib/db/tool-types.ts's primary_criterion) — replaces the old
  // industry-based "Motor Type only for Grooming & Barbering" gate, which
  // wrongly hid Motor for Hair Dryer (a real motorized type that happens to
  // share the "haircare-styling" industry with motorless flat
  // irons/curling irons/hot brushes). Before a specific tool type is picked,
  // falls back to the old industry heuristic just so the right field isn't
  // jarringly absent while the user is still choosing.
  const selectedToolTypeRow = toolType ? toolTypes.find(t => t.type_key === toolType) : undefined;
  const primaryCriterion: "motor" | "heat_technology" | "none" = selectedToolTypeRow
    ? (selectedToolTypeRow.primary_criterion as "motor" | "heat_technology" | "none")
    : (industry === "haircare-styling" ? "none" : "motor");
  const criterionLabel = CRITERION_LABELS[primaryCriterion] || "Motor";

  // "Adjust weights for this analysis" — resolves the selected tool type's
  // scoring profile (own row, else the global default) via
  // lib/db/scoring-profiles.ts, purely for prefilling the expander; the
  // actual weights used server-side are resolved fresh at analysis time
  // (see lib/analysisEngine.ts), this is display-only.
  const [scoringProfiles, setScoringProfiles] = useState<ScoringProfileOption[]>([]);
  const [showWeightOverride, setShowWeightOverride] = useState(false);
  const [weightOverrideInputs, setWeightOverrideInputs] = useState({ motor: "45", price: "35", feature: "20" });
  const [savingProfile, setSavingProfile] = useState(false);

  useEffect(() => {
    fetch("/api/scoring-profiles")
      .then(r => r.json())
      .then(data => setScoringProfiles(data.profiles || []))
      .catch(() => {});
  }, []);

  const resolvedProfileForToolType = (() => {
    const own = toolType ? scoringProfiles.find(p => p.type_key === toolType) : undefined;
    return own || scoringProfiles.find(p => p.type_key === null) || { motor_weight: 45, price_weight: 35, feature_weight: 20 };
  })();

  // Re-prefills the expander's inputs from the newly-selected tool type's
  // profile whenever it's still closed (never clobbers a value the user is
  // actively adjusting).
  useEffect(() => {
    if (showWeightOverride) return;
    setWeightOverrideInputs({
      motor: String(resolvedProfileForToolType.motor_weight),
      price: String(resolvedProfileForToolType.price_weight),
      feature: String(resolvedProfileForToolType.feature_weight),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [toolType, scoringProfiles]);

  const weightOverrideSum = (Number(weightOverrideInputs.motor) || 0) + (Number(weightOverrideInputs.price) || 0) + (Number(weightOverrideInputs.feature) || 0);
  const weightOverridePct = (raw: string) => (weightOverrideSum > 0 ? Math.round(((Number(raw) || 0) / weightOverrideSum) * 100) : 0);

  async function handleSaveWeightsToProfile() {
    setSavingProfile(true);
    try {
      const res = await fetch("/api/admin/scoring-profiles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          typeKey: toolType || null,
          motor: Number(weightOverrideInputs.motor),
          price: Number(weightOverrideInputs.price),
          feature: Number(weightOverrideInputs.feature),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to save profile");
      toast.success("Saved as this tool type's default profile");
      const profilesRes = await fetch("/api/scoring-profiles");
      const profilesData = await profilesRes.json();
      setScoringProfiles(profilesData.profiles || []);
    } catch (err: any) {
      toast.error(err.message || "Failed to save profile — admin access required");
    } finally {
      setSavingProfile(false);
    }
  }

  async function handleAddToolType() {
    const label = newToolTypeName.trim();
    if (label.length < 3) {
      toast.error("Name must be at least 3 characters");
      return;
    }
    const aliases = newToolTypeSynonyms.split(",").map(s => s.trim()).filter(Boolean);
    const family = industry === "haircare-styling" ? "beauty" : "clipper_trimmer_shaver";
    setAddingToolType(true);
    try {
      const res = await fetch("/api/tool-types", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label, aliases, family, confirmDuplicate: !!toolTypeDupSuggestion }),
      });
      const data = await res.json();
      if (res.status === 409 && data.suggestion) {
        setToolTypeDupSuggestion(data.suggestion);
        return;
      }
      if (!res.ok) throw new Error(data.error || "Failed to add tool type");
      setToolTypes(prev => [...prev, data.toolType]);
      setToolType(data.toolType.type_key);
      setShowAddToolType(false);
      setNewToolTypeName("");
      setNewToolTypeSynonyms("");
      setToolTypeDupSuggestion(null);
      toast.success(`Added "${data.toolType.label}" as a new tool type`);
    } catch (err: any) {
      toast.error(err.message || "Failed to add tool type");
    } finally {
      setAddingToolType(false);
    }
  }

  // Live auto-detect: as soon as the branded-name text resolves to a real
  // family (e.g. pasting "EON Digital Brushless Motor" matches Brushless
  // Motor's own seeded aliases), auto-select it — but only while no family
  // is selected yet, so this never fights a choice the user already made or
  // confirmed. The user can always change the select manually afterward.
  useEffect(() => {
    if (motorFamily || !motorBrandedName.trim() || motorFamilies.length === 0) return;
    const detected = detectMotorFamilyFromText(motorBrandedName, motorFamilies);
    if (detected) setMotorFamily(detected);
  }, [motorBrandedName, motorFamilies, motorFamily]);

  // Same live auto-detect, mirrored for the Heat/Plate Technology criterion.
  useEffect(() => {
    if (heatTechFamily || !heatTechBrandedName.trim() || heatTechFamilies.length === 0) return;
    const detected = detectHeatTechFamilyFromText(heatTechBrandedName, heatTechFamilies);
    if (detected) setHeatTechFamily(detected);
  }, [heatTechBrandedName, heatTechFamilies, heatTechFamily]);

  // When product is selected from StylecraftUS catalog
  function handleProductSelect(productId: string) {
    setSelectedProductId(productId);
    if (!productId) return;

    if (productId === "custom") {
      setProductName("");
      setIndustry("grooming-barbering");
      setTargetMarket("both");
      setDescription("");
      setCategory("");
      setToolType("");
      // Positioning Context asks for THIS product's own positioning facts
      // (BSR, price tier, target customer), never a company/brand
      // description — nothing meaningful to prefill here.
      setCompanyContext("");
      setMotorFamily("");
      setMotorBrandedName("");
      setHeatTechFamily("");
      setHeatTechBrandedName("");
      setKeyDiff("");
      setPricePoint("");
      return;
    }

    const product = STYLECRAFT_PRODUCTS.find(p => p.id === productId);
    if (!product) return;

    setIndustry(product.industry);
    setTargetMarket(product.targetMarket as any);
    setProductName(product.name);
    setDescription(product.description);
    setCategory(product.amazonCategory);
    setToolType(deriveToolTypeFromCatalogProduct(product, toolTypes) || "");
    // Same reasoning as the "custom" branch above — the StyleCraft catalog
    // has no real BSR/target-customer data per product, so there's nothing
    // genuine to prefill; leave it for the user to fill in per-product.
    setCompanyContext("");
    setMotorBrandedName(product.motorType);
    setMotorFamily(detectMotorFamilyFromText(product.motorType, motorFamilies) || "");
    setKeyDiff(product.keyFeatures[0] || "");
    setPricePoint(`$${product.price}`);
  }

  // Completed Results State (Aggregated results object)
  const [analysisResult, setAnalysisResult] = useState<any>(null);
  const [savingReport, setSavingReport] = useState(false);
  const [savedReportId, setSavedReportId] = useState<string | null>(null);
  const [regeneratingSynthesis, setRegeneratingSynthesis] = useState(false);

  // Patches exactly the one competitor a CompetitorCard just replaced
  // (POST .../competitors/replace) into whichever of phase1/phase2 it
  // actually lives in — this page owns analysisResult, CompetitorCard
  // never mutates its own competitor prop directly.
  function handleCompetitorReplaced(oldAsin: string, updatedCompetitor: any, synthesisPossiblyStale: boolean) {
    setAnalysisResult((prev: any) => {
      if (!prev) return prev;
      const patchList = (list: any[]) => (list || []).map((c: any) => (c.asin === oldAsin ? updatedCompetitor : c));
      const inPhase1 = (prev.phase1?.competitors || []).some((c: any) => c.asin === oldAsin);
      return {
        ...prev,
        phase1: inPhase1 ? { ...prev.phase1, competitors: patchList(prev.phase1.competitors) } : prev.phase1,
        phase2: !inPhase1 ? { ...prev.phase2, competitors: patchList(prev.phase2.competitors) } : prev.phase2,
        phase3: synthesisPossiblyStale && prev.phase3 ? { ...prev.phase3, synthesis_possibly_stale: true } : prev.phase3,
      };
    });
  }

  // Resets Phase 3 server-side then hands control back to the same
  // ProgressPanel view a fresh analysis uses — it re-fetches phase0-2
  // results (already complete, instant) and re-runs only the synthesis
  // call, no new state-machine code needed.
  async function handleRegenerateSynthesis() {
    if (!analysisId) return;
    setRegeneratingSynthesis(true);
    try {
      const res = await fetch(`/api/analyses/${analysisId}/regenerate-synthesis`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "Failed to start synthesis regeneration");
      setViewState("running");
    } catch (err: any) {
      toast.error(err.message || "Failed to start synthesis regeneration");
    } finally {
      setRegeneratingSynthesis(false);
    }
  }

  // Pre-fill form if projectId is passed
  useEffect(() => {
    if (projectIdParam) {
      fetch(`/api/projects/${projectIdParam}`)
        .then((r) => r.json())
        .then((data) => {
          if (data.project) {
            const p = data.project;
            setProductName(p.productName || "");
            setIndustry(p.industry || "grooming");
            setTargetMarket(p.targetMarket || "both");
            setDescription(p.description || "");
            setCategory(p.category || "");
            setToolType(p.toolType || "");
            setPricePoint(p.pricePoint || "");
            setCompanyContext(p.companyContext || "");
            setMotorFamily(p.motorFamily || "");
            // Courtesy starting point for a legacy project that only ever
            // had free-text motorTech (no motorFamily yet) — the live
            // auto-detect effect above will try to resolve it into the
            // canonical select once motorFamilies has loaded.
            setMotorBrandedName(p.motorFamily ? p.motorBrandedName || "" : p.motorTech || "");
            setKeyDiff(p.keyDiff || "");
            toast.success(`Loaded specifications from project "${p.name}"`);
          }
        })
        .catch(() => {});
    }
  }, [projectIdParam]);

  // Load past analysis if id is passed — resumes it via the ProgressPanel if
  // still in progress (or stuck mid-phase from an earlier dropped
  // connection) instead of only handling the already-complete case.
  useEffect(() => {
    if (pastAnalysisId) {
      fetch(`/api/analyses/${pastAnalysisId}`)
        .then((r) => r.json())
        .then((data) => {
          const analysis = data.analysis;
          if (!analysis) {
            toast.error("Analysis not found");
            return;
          }

          const name = analysis.projects?.product_name || analysis.context?.productName || "Product Analysis";
          setProductName(name);

          if (analysis.status === "complete") {
            const identity = analysis.phase0_result || {};
            const p1 = analysis.phase1_result || {};
            const p2 = analysis.phase2_result || {};
            const p3 = analysis.phase3_result || {};
            const searches = (p1.web_searches_performed || 0) + (p2.web_searches_performed || 0) + (p3.web_searches_performed || 0);

            setAnalysisId(analysis.id);
            setAnalysisResult({ identity, phase1: p1, phase2: p2, phase3: p3, productName: name, totalSearches: searches });
            setViewState("results");
          } else if (analysis.status === "failed") {
            toast.error(analysis.error_message || "This analysis failed");
          } else {
            // pending/running — resume from whatever phase is persisted.
            setAnalysisId(analysis.id);
            setViewState("running");
          }
        })
        .catch(() => toast.error("Failed to load analysis"));
    }
  }, [pastAnalysisId]);

  const validate = (): boolean => {
    const errs: { [key: string]: string } = {};
    if (!productName.trim()) {
      errs.productName = "Product name is required";
    } else if (productName.trim().length < 3) {
      errs.productName = "Product name must be at least 3 characters";
    }
    if (!description.trim()) {
      errs.description = "Product description is required";
    } else if (description.trim().length < 10) {
      errs.description = "Add at least 10 characters for sharper results";
    }
    if (!toolType) errs.toolType = "Select the exact tool type";
    // Motor Type / Heat-Plate Technology are each shown only when the
    // selected tool type's primary_criterion actually calls for them —
    // required whenever the relevant one is actually shown, per
    // primaryCriterion above.
    if (primaryCriterion === "motor" && !motorFamily) {
      errs.motorFamily = "Select the motor type";
    }
    if (primaryCriterion === "heat_technology" && !heatTechFamily) {
      errs.heatTechFamily = "Select the plate/heat technology";
    }
    const priceNum = parsePriceToNumber(pricePoint);
    if (!pricePoint.trim() || priceNum === null || priceNum <= 0) {
      errs.pricePoint = "Enter a target price greater than $0";
    }
    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  function formatPriceOnBlur() {
    const n = parsePriceToNumber(pricePoint);
    if (n !== null && n > 0) setPricePoint(`$${n.toFixed(2)}`);
  }

  const handleRunAnalysis = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate()) return;
    if (submitting) return;

    setSubmitting(true);
    try {
      // Save project defaults if associated with a project
      if (projectIdParam) {
        fetch(`/api/projects/${projectIdParam}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            savedDefaults: {
              productName: productName.trim(),
              industry,
              targetMarket,
              description: description.trim(),
              category: category.trim(),
              toolType,
              pricePoint: pricePoint.trim(),
              companyContext: companyContext.trim(),
              motorFamily,
              motorBrandedName: motorBrandedName.trim(),
              keyDiff: keyDiff.trim(),
            }
          })
        }).catch(() => {});
      }

      // Legacy free-text fallback for any code path not yet updated to read
      // motorFamily/motorBrandedName directly — the branded name if given,
      // else the canonical family's own label, never blank when a family is
      // selected.
      const motorFamilyLabel = motorFamilies.find(f => f.family_key === motorFamily)?.label || "";
      const motorTechFallback = motorFamilyLabel
        ? (motorBrandedName.trim() ? `${motorFamilyLabel} (${motorBrandedName.trim()})` : motorFamilyLabel)
        : motorBrandedName.trim();
      // Same fallback construction, mirrored for Heat/Plate Technology.
      const heatTechFamilyLabel = heatTechFamilies.find(f => f.family_key === heatTechFamily)?.label || "";
      const heatTechRawFallback = heatTechFamilyLabel
        ? (heatTechBrandedName.trim() ? `${heatTechFamilyLabel} (${heatTechBrandedName.trim()})` : heatTechFamilyLabel)
        : heatTechBrandedName.trim();

      const res = await fetch("/api/analyses", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId: projectIdParam || undefined,
          industry,
          targetMarket,
          productName: productName.trim(),
          description: description.trim(),
          category: category.trim() || undefined,
          toolType,
          companyContext: companyContext.trim() || undefined,
          // Only submit whichever criterion actually applies to the
          // selected tool type — never both, never a stale value left over
          // from a prior tool-type selection.
          motorFamily: primaryCriterion === "motor" ? (motorFamily || undefined) : undefined,
          motorBrandedName: primaryCriterion === "motor" ? (motorBrandedName.trim() || undefined) : undefined,
          motorTech: primaryCriterion === "motor" ? (motorTechFallback || undefined) : undefined,
          heatTechFamily: primaryCriterion === "heat_technology" ? (heatTechFamily || undefined) : undefined,
          heatTechBrandedName: primaryCriterion === "heat_technology" ? (heatTechBrandedName.trim() || undefined) : undefined,
          heatTechRaw: primaryCriterion === "heat_technology" ? (heatTechRawFallback || undefined) : undefined,
          keyDiff: keyDiff.trim() || undefined,
          pricePoint: pricePoint.trim() || undefined,
          weightOverride: showWeightOverride && weightOverrideSum > 0 ? {
            motor: Number(weightOverrideInputs.motor) || 0,
            price: Number(weightOverrideInputs.price) || 0,
            feature: Number(weightOverrideInputs.feature) || 0,
          } : undefined,
        })
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "Failed to start analysis");

      setAnalysisId(data.analysisId);
      setViewState("running");
    } catch (err: any) {
      toast.error(err.message || "Failed to trigger analysis");
    } finally {
      setSubmitting(false);
    }
  };

  const handleSaveAsReport = async () => {
    if (savedReportId) {
      router.push(`/dashboard/reports/${savedReportId}`);
      return;
    }

    if (!analysisId || !analysisResult) return;
    
    setSavingReport(true);
    try {
      const res = await fetch("/api/reports", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: `Competitive Intelligence Report — ${productName}`,
          projectId: projectIdParam || undefined,
          analysisId,
          productName,
          industry,
          targetMarket,
          pricePoint,
        })
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.message);

      toast.success("Report saved");
      router.push(`/dashboard/reports/${data.report.id}`);
    } catch (err: any) {
      toast.error(err.message || "Failed to save report");
    } finally {
      setSavingReport(false);
    }
  };

  // Canonical family label + branded name in parens when given (e.g.
  // "Brushless Motor (EON Digital Brushless Motor)") — pure derived text for
  // the review-step summary below, mirrors how competitor comparisons
  // display motor_type/motor_branded_name (CompetitorCard.tsx).
  const motorSummaryLabel = (() => {
    const label = motorFamilies.find(f => f.family_key === motorFamily)?.label;
    if (!label) return "";
    return motorBrandedName.trim() ? `${label} (${motorBrandedName.trim()})` : label;
  })();
  // Same derivation, mirrored for Heat/Plate Technology.
  const heatTechSummaryLabel = (() => {
    const label = heatTechFamilies.find(f => f.family_key === heatTechFamily)?.label;
    if (!label) return "";
    return heatTechBrandedName.trim() ? `${label} (${heatTechBrandedName.trim()})` : label;
  })();
  // Whichever criterion applies to the currently-selected tool type, or a
  // neutral "not applicable" note for 'none' types — never shows a stale
  // Motor label for a motorless product or vice versa.
  const criterionSummaryLabel = primaryCriterion === "heat_technology"
    ? (heatTechSummaryLabel || `${criterionLabel.toLowerCase()} unspecified`)
    : primaryCriterion === "motor"
    ? (motorSummaryLabel || "motor type unspecified")
    : "not applicable for this tool type";

  return (
    <div className="space-y-6">
      {/* Dynamic Header */}
      {viewState === "form" && (
        <div className="flex flex-col gap-2">
          <h1 className="text-display">New competitive analysis</h1>
          <p className="text-xs text-text-secondary leading-normal max-w-2xl">
            Gemini searches the web and Amazon indices to discover 10 competing products (5 established, 5 emerging) then maps prices, specifications, and synthesises strategic intelligence recommendations. Takes 1–2 minutes.
          </p>
        </div>
      )}

      {/* VIEW 1: INPUT FORM */}
      {viewState === "form" && (
        <form onSubmit={handleRunAnalysis} className="space-y-6 text-xs">
          {/* StylecraftUS Quick-fill selector */}
          <div className="bg-surface-2 border border-accent/30 rounded-xl p-5 space-y-4 shadow-sm relative overflow-hidden">
            <div className="absolute top-0 right-0 w-24 h-24 bg-accent/5 rounded-full blur-xl pointer-events-none" />
            <div className="flex items-center gap-3">
              <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-accent/15 text-accent border border-accent/20">
                <Sparkles className="w-4 h-4 text-accent" />
              </div>
              <div>
                <h3 className="text-xs font-bold text-text-primary">Select a StylecraftUS product</h3>
                <p className="text-[10px] text-text-muted mt-0.5">Auto-fills the form with real product specifications</p>
              </div>
            </div>

            <select
              value={selectedProductId}
              onChange={e => handleProductSelect(e.target.value)}
              className="w-full px-3 py-2.5 border border-border rounded-lg bg-surface-1 text-text-primary outline-none focus:border-accent font-medium text-xs animate-pulse-once"
            >
              <option value="">Choose a product to analyze…</option>

              {PRODUCT_CATEGORIES.map(cat => {
                const products = STYLECRAFT_PRODUCTS.filter(p => p.category === cat);
                if (products.length === 0) return null;
                return (
                  <optgroup key={cat} label={`── ${cat} ──────────────────`}>
                    {products.map(p => (
                      <option key={p.id} value={p.id}>
                        {p.shortName} — ${p.price}
                      </option>
                    ))}
                  </optgroup>
                );
              })}

              <optgroup label="── Or type your own ──────────">
                <option value="custom">Enter custom product details…</option>
              </optgroup>
            </select>

            {selectedProductId && selectedProductId !== "custom" && (
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 p-3 rounded-lg bg-surface-3/50 border border-border text-[10px] text-text-secondary">
                {(() => {
                  const p = STYLECRAFT_PRODUCTS.find(x => x.id === selectedProductId)!;
                  return (
                    <>
                      <span className="font-semibold text-text-primary">{p.shortName}</span>
                      <span>•</span>
                      <span className="text-accent font-bold">${p.price}</span>
                      <span>•</span>
                      <span>{p.motorType}</span>
                      <span>•</span>
                      <a href={p.url} target="_blank" rel="noopener noreferrer" className="text-accent hover:underline ml-auto flex items-center gap-0.5">
                        View website ↗
                      </a>
                    </>
                  );
                })()}
              </div>
            )}
          </div>

          {/* Card 1: Product Specs */}
          <div className="bg-surface-2 border border-border rounded-xl p-5 space-y-4 shadow-sm">
            <h2 className="text-sm font-bold text-text-primary">Product details</h2>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-1">
                <label className="font-semibold text-text-primary block">Industry *</label>
                <select
                  value={industry}
                  onChange={(e) => {
                    setIndustry(e.target.value);
                    // Motor Type only applies to motorized tool types, Heat/
                    // Plate Technology only to motorless styling tools — the
                    // Industry switch itself doesn't determine which shows
                    // (the selected Tool Type does, see primaryCriterion
                    // above), but clear both here as a reasonable starting
                    // point so a stale value never gets submitted before the
                    // Tool Type re-selection below settles which one applies.
                    if (e.target.value === "haircare-styling") { setMotorFamily(""); setMotorBrandedName(""); }
                    else { setHeatTechFamily(""); setHeatTechBrandedName(""); }
                    // Tool Type options are Industry-dependent (see
                    // toolTypesForIndustry) — a Tool Type valid under the
                    // old Industry (e.g. "Trimmer") is meaningless once the
                    // Industry no longer offers it.
                    setToolType(prev => (toolTypesForIndustry(e.target.value, toolTypes).some(t => t.type_key === prev) ? prev : ""));
                  }}
                  className="w-full px-3 py-2 border border-border rounded-lg bg-surface-1 text-text-primary outline-none focus:border-accent"
                  required
                >
                  <option value="" disabled>Select industry…</option>
                  <option value="grooming-barbering">Grooming & Barbering</option>
                  <option value="haircare-styling">Hair Care & Styling</option>
                </select>
              </div>

              <div className="space-y-1">
                <label className="font-semibold text-text-primary block mb-1">Target Market *</label>
                <div className="grid grid-cols-3 gap-1 p-1 rounded-lg bg-surface-1 border border-border">
                  {[
                    { key: "pro", label: "Pro / Salon" },
                    { key: "consumer", label: "Retail" },
                    { key: "both", label: "Both" }
                  ].map(opt => (
                    <button
                      key={opt.key}
                      type="button"
                      onClick={() => setTargetMarket(opt.key as any)}
                      className={`py-1.5 rounded-md text-[10px] font-bold transition-all ${
                        targetMarket === opt.key
                          ? "bg-surface-3 text-text-primary border border-border-strong shadow-sm"
                          : "text-text-secondary hover:text-text-primary"
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
                <p className="text-[10px] text-text-muted">
                  Affects which competitor brands are searched — Pro/Salon and Retail use separate curated brand lists; Both merges and dedupes across both.
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-1">
                <label className="font-semibold text-text-primary block">Product Name *</label>
                <input
                  type="text"
                  value={productName}
                  onChange={(e) => {
                    setProductName(e.target.value);
                    if (errors.productName) setErrors(prev => { const n = { ...prev }; delete n.productName; return n; });
                  }}
                  placeholder="e.g. Apex Cordless Clipper"
                  className={`w-full px-3 py-2 border rounded-lg bg-surface-1 outline-none text-text-primary focus:border-accent ${
                    errors.productName ? "border-danger" : "border-border"
                  }`}
                />
                {errors.productName && <p className="text-[10px] text-danger">{errors.productName}</p>}
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div className="space-y-1">
                  <label className="font-semibold text-text-primary block">Tool Type *</label>
                  <select
                    value={toolType}
                    onChange={(e) => {
                      if (e.target.value === ADD_NEW_TOOL_TYPE) {
                        setShowAddToolType(true);
                        return;
                      }
                      setToolType(e.target.value as ToolType);
                      if (errors.toolType) setErrors(prev => { const n = { ...prev }; delete n.toolType; return n; });
                    }}
                    className={`w-full px-3 py-2 border rounded-lg bg-surface-1 outline-none text-text-primary focus:border-accent ${
                      errors.toolType ? "border-danger" : "border-border"
                    }`}
                  >
                    <option value="" disabled>Select exact tool type…</option>
                    {toolTypesForIndustry(industry, toolTypes).map((t) => (
                      <option key={t.type_key} value={t.type_key}>{t.label}</option>
                    ))}
                    <option value={ADD_NEW_TOOL_TYPE}>+ Add new tool type…</option>
                  </select>
                  {errors.toolType && <p className="text-[10px] text-danger">{errors.toolType}</p>}
                  {showAddToolType && (
                    <div className="mt-2 p-3 border border-border rounded-lg bg-surface-3/30 space-y-2">
                      <input
                        type="text"
                        value={newToolTypeName}
                        onChange={(e) => { setNewToolTypeName(e.target.value); setToolTypeDupSuggestion(null); }}
                        placeholder="New tool type name — e.g. Foil Shaper"
                        className="w-full px-2.5 py-1.5 text-xs border border-border rounded-lg bg-surface-1 text-text-primary outline-none focus:border-accent"
                      />
                      <input
                        type="text"
                        value={newToolTypeSynonyms}
                        onChange={(e) => setNewToolTypeSynonyms(e.target.value)}
                        placeholder="Also called (comma-separated, optional)"
                        className="w-full px-2.5 py-1.5 text-xs border border-border rounded-lg bg-surface-1 text-text-primary outline-none focus:border-accent"
                      />
                      {toolTypeDupSuggestion && (
                        <p className="text-[10px] text-warning">
                          Did you mean &quot;{toolTypeDupSuggestion.label}&quot;?{" "}
                          <button type="button" className="underline font-semibold" onClick={() => { setToolType(toolTypeDupSuggestion.type_key); setShowAddToolType(false); setNewToolTypeName(""); setNewToolTypeSynonyms(""); setToolTypeDupSuggestion(null); }}>
                            Use this instead
                          </button>
                          {" · "}
                          <button type="button" className="underline font-semibold" onClick={handleAddToolType} disabled={addingToolType}>
                            Add anyway
                          </button>
                        </p>
                      )}
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={handleAddToolType}
                          disabled={addingToolType}
                          className="flex items-center gap-1 px-2.5 py-1 bg-accent hover:bg-accent-hover text-white text-[11px] font-bold rounded-lg transition-colors disabled:opacity-50"
                        >
                          {addingToolType ? "Adding…" : "Add"}
                        </button>
                        <button
                          type="button"
                          onClick={() => { setShowAddToolType(false); setNewToolTypeName(""); setNewToolTypeSynonyms(""); setToolTypeDupSuggestion(null); }}
                          className="px-2.5 py-1 text-[11px] font-semibold text-text-muted hover:text-text-primary transition-colors"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}
                </div>
                <div className="space-y-1">
                  <label className="font-semibold text-text-primary block">Market Category</label>
                  <input
                    type="text"
                    value={category}
                    onChange={(e) => setCategory(e.target.value)}
                    placeholder="e.g. Hair Clippers"
                    className="w-full px-3 py-2 border border-border rounded-lg bg-surface-1 text-text-primary outline-none focus:border-accent"
                  />
                </div>
                <div className="space-y-1">
                  <label className="font-semibold text-text-primary block">Target Price *</label>
                  <input
                    type="text"
                    value={pricePoint}
                    onChange={(e) => {
                      setPricePoint(e.target.value);
                      if (errors.pricePoint) setErrors(prev => { const n = { ...prev }; delete n.pricePoint; return n; });
                    }}
                    onBlur={formatPriceOnBlur}
                    placeholder="e.g. $180"
                    className={`w-full px-3 py-2 border rounded-lg bg-surface-1 outline-none text-text-primary focus:border-accent ${
                      errors.pricePoint ? "border-danger" : "border-border"
                    }`}
                  />
                  {errors.pricePoint && <p className="text-[10px] text-danger">{errors.pricePoint}</p>}
                  <p className="text-[10px] text-text-muted">Competitors are matched by motor technology first, then closest to this price.</p>
                </div>
              </div>
            </div>

            <div className="space-y-1">
              <div className="flex justify-between items-center">
                <label className="font-semibold text-text-primary">Product Description *</label>
                <span className="text-[10px] text-text-muted">{description.length} chars {description.trim().length > 0 && description.trim().length < 10 ? `(${10 - description.trim().length} more needed)` : ""}</span>
              </div>
              <textarea
                rows={4}
                value={description}
                onChange={(e) => {
                  setDescription(e.target.value);
                  if (errors.description) setErrors(prev => { const n = { ...prev }; delete n.description; return n; });
                }}
                placeholder="Describe key specs, blade/motor type, battery life, target audience..."
                className={`w-full px-3 py-2 border rounded-lg bg-surface-1 outline-none text-text-primary focus:border-accent resize-y ${
                  errors.description ? "border-danger" : "border-border"
                }`}
              />
              {errors.description && <p className="text-[10px] text-danger">{errors.description}</p>}
            </div>
          </div>

          {/* Card 2: Positioning Context — product facts, not company/brand
              description (feeds AI positioning advice for THIS product). */}
          <div className="bg-surface-2 border border-border rounded-xl p-5 space-y-4 shadow-sm">
            <h2 className="text-sm font-bold text-text-primary">Positioning context</h2>
            <div className="space-y-1">
              <label className="font-semibold text-text-primary block">Positioning context</label>
              <textarea
                rows={2}
                value={companyContext}
                onChange={(e) => setCompanyContext(e.target.value)}
                placeholder="e.g. Currently #1,200 BSR in Beauty & Personal Care, priced mid-tier vs. competitors, popular with barbershop owners age 30-50..."
                className="w-full px-3 py-2 border border-border rounded-lg bg-surface-1 text-text-primary outline-none focus:border-accent resize-y"
              />
              <p className="text-[10px] text-text-muted">
                Product-specific facts that sharpen positioning — current BSR, standout reviews, who actually buys it. Not a company/brand description.
              </p>
            </div>
          </div>

          {/* Card 3: Precision specs */}
          <div className="bg-surface-2 border border-border rounded-xl p-5 space-y-4 shadow-sm">
            <h2 className="text-sm font-bold text-text-primary">Precision targeting</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Motor Type / Heat-Plate Technology — whichever criterion
                  actually applies to the SELECTED tool type
                  (primaryCriterion above, from lib/db/tool-types.ts's
                  primary_criterion), never both, never neither's stale
                  leftover value. Each is a fixed canonical list — our own
                  branding (e.g. "EON Digital Brushless Motor") maps to a
                  canonical family for matching purposes; the branded name is
                  a separate, optional display-only field below it. */}
              {primaryCriterion === "motor" && (
                <div className="space-y-1">
                  <label className="font-semibold text-text-primary block">Motor type *</label>
                  <select
                    value={motorFamily}
                    onChange={(e) => {
                      setMotorFamily(e.target.value);
                      if (errors.motorFamily) setErrors(prev => { const n = { ...prev }; delete n.motorFamily; return n; });
                    }}
                    className={`w-full px-3 py-2 border rounded-lg bg-surface-1 text-text-primary outline-none focus:border-accent ${
                      errors.motorFamily ? "border-danger" : "border-border"
                    }`}
                  >
                    <option value="">Select motor type…</option>
                    {motorFamilies.map(f => (
                      <option key={f.family_key} value={f.family_key}>{f.label}</option>
                    ))}
                  </select>
                  {errors.motorFamily && <p className="text-[10px] text-danger">{errors.motorFamily}</p>}
                  <input
                    type="text"
                    value={motorBrandedName}
                    onChange={(e) => setMotorBrandedName(e.target.value)}
                    placeholder="Branded motor name (optional) — e.g. EON Digital Brushless Motor"
                    className="w-full px-3 py-2 border border-border rounded-lg bg-surface-1 text-text-primary outline-none focus:border-accent"
                  />
                  <p className="text-[10px] text-text-muted">
                    Competitors are matched on the motor family. Your branded motor name appears in documents but matching uses the universal type.
                  </p>
                </div>
              )}

              {primaryCriterion === "heat_technology" && (
                <div className="space-y-1">
                  <label className="font-semibold text-text-primary block">Plate/heat technology *</label>
                  <select
                    value={heatTechFamily}
                    onChange={(e) => {
                      setHeatTechFamily(e.target.value);
                      if (errors.heatTechFamily) setErrors(prev => { const n = { ...prev }; delete n.heatTechFamily; return n; });
                    }}
                    className={`w-full px-3 py-2 border rounded-lg bg-surface-1 text-text-primary outline-none focus:border-accent ${
                      errors.heatTechFamily ? "border-danger" : "border-border"
                    }`}
                  >
                    <option value="">Select plate/heat technology…</option>
                    {heatTechFamilies.map(f => (
                      <option key={f.family_key} value={f.family_key}>{f.label}</option>
                    ))}
                  </select>
                  {errors.heatTechFamily && <p className="text-[10px] text-danger">{errors.heatTechFamily}</p>}
                  <input
                    type="text"
                    value={heatTechBrandedName}
                    onChange={(e) => setHeatTechBrandedName(e.target.value)}
                    placeholder="Branded plate/heat name (optional) — e.g. SoftTouch Titanium"
                    className="w-full px-3 py-2 border border-border rounded-lg bg-surface-1 text-text-primary outline-none focus:border-accent"
                  />
                  <p className="text-[10px] text-text-muted">
                    Competitors are matched on the plate/heat technology family. Your branded name appears in documents but matching uses the universal type.
                  </p>
                </div>
              )}

              <div className={`space-y-1 ${primaryCriterion === "none" ? "md:col-span-2" : ""}`}>
                <label className="font-semibold text-text-primary block">Key differentiating feature</label>
                <input
                  type="text"
                  value={keyDiff}
                  onChange={(e) => setKeyDiff(e.target.value)}
                  placeholder="e.g. full-metal body, zero-gap blade, 4-hour battery life"
                  className="w-full px-3 py-2 border border-border rounded-lg bg-surface-1 text-text-primary outline-none focus:border-accent"
                />
                <p className="text-[10px] text-text-muted">Optional — competitors sharing this feature are ranked slightly higher.</p>
              </div>
            </div>
          </div>

          {/* "Adjust weights for this analysis" — prefilled from the
              selected tool type's scoring profile (lib/db/scoring-profiles.ts);
              changes here apply to THIS run only unless "Save to profile" is
              clicked. Free-entry, no sum-to-1 constraint — normalization
              happens server-side at scoring time. */}
          <div className="bg-surface-2 border border-border rounded-xl p-5 space-y-3">
            <button
              type="button"
              onClick={() => setShowWeightOverride(v => !v)}
              className="flex items-center justify-between w-full text-left"
            >
              <span className="text-sm font-bold text-text-primary">Adjust weights for this analysis</span>
              <span className="text-[10px] text-text-muted">{showWeightOverride ? "Hide" : "Optional — click to expand"}</span>
            </button>
            {showWeightOverride && (
              <div className="space-y-3">
                <p className="text-[10px] text-text-muted">
                  Enter any non-negative numbers expressing RELATIVE importance — no need to sum to 1 or 100. Prefilled from this tool type&apos;s current profile.
                </p>
                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <label className="text-[10px] font-bold text-text-muted uppercase tracking-wider">{criterionLabel}</label>
                    <input
                      type="number" step="1" min="0"
                      value={weightOverrideInputs.motor}
                      onChange={e => setWeightOverrideInputs(prev => ({ ...prev, motor: e.target.value }))}
                      className="mt-1 w-full px-2.5 py-1.5 text-xs border border-border rounded-lg bg-surface-1 text-text-primary outline-none focus:border-accent"
                    />
                    <p className="mt-0.5 text-[10px] text-text-muted">→ {weightOverridePct(weightOverrideInputs.motor)}%</p>
                  </div>
                  <div>
                    <label className="text-[10px] font-bold text-text-muted uppercase tracking-wider">Price</label>
                    <input
                      type="number" step="1" min="0"
                      value={weightOverrideInputs.price}
                      onChange={e => setWeightOverrideInputs(prev => ({ ...prev, price: e.target.value }))}
                      className="mt-1 w-full px-2.5 py-1.5 text-xs border border-border rounded-lg bg-surface-1 text-text-primary outline-none focus:border-accent"
                    />
                    <p className="mt-0.5 text-[10px] text-text-muted">→ {weightOverridePct(weightOverrideInputs.price)}%</p>
                  </div>
                  <div>
                    <label className="text-[10px] font-bold text-text-muted uppercase tracking-wider">Features</label>
                    <input
                      type="number" step="1" min="0"
                      value={weightOverrideInputs.feature}
                      onChange={e => setWeightOverrideInputs(prev => ({ ...prev, feature: e.target.value }))}
                      className="mt-1 w-full px-2.5 py-1.5 text-xs border border-border rounded-lg bg-surface-1 text-text-primary outline-none focus:border-accent"
                    />
                    <p className="mt-0.5 text-[10px] text-text-muted">→ {weightOverridePct(weightOverrideInputs.feature)}%</p>
                  </div>
                </div>
                {weightOverrideSum <= 0 && <p className="text-[10px] text-danger">At least one criterion must be &gt; 0 — falling back to the profile default.</p>}
                <div className="flex items-center justify-between">
                  <p className="text-[10px] text-text-muted">
                    {criterionLabel} {weightOverrideInputs.motor || 0} → {weightOverridePct(weightOverrideInputs.motor)}% · Price {weightOverrideInputs.price || 0} → {weightOverridePct(weightOverrideInputs.price)}% · Features {weightOverrideInputs.feature || 0} → {weightOverridePct(weightOverrideInputs.feature)}%
                  </p>
                  <button
                    type="button"
                    onClick={handleSaveWeightsToProfile}
                    disabled={savingProfile}
                    className="px-2.5 py-1.5 text-[11px] font-semibold text-accent hover:underline disabled:opacity-50"
                  >
                    {savingProfile ? "Saving…" : "Save to profile"}
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Review-step summary — pure derived text, confirms every field's
              real value right before the run starts (no new state). */}
          {productName.trim() && toolType && (
            <p className="text-[11px] text-text-secondary bg-surface-3/30 border border-border rounded-lg px-4 py-2.5">
              Analyzing: <span className="font-semibold text-text-primary">{productName.trim()}</span> — {getToolTypeLabel(toolType, toolTypes)}, {criterionSummaryLabel}, {pricePoint.trim() || "price unspecified"}, {TARGET_MARKET_LABELS[targetMarket]} market
              {keyDiff.trim() && <> · differentiator: {keyDiff.trim()}</>}
            </p>
          )}

          {/* Action Row */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 border border-border bg-surface-2 rounded-xl">
            <div className="flex items-center gap-4">
              <button
                type="button"
                onClick={() => router.back()}
                disabled={submitting}
                className="flex items-center gap-1.5 text-xs text-text-muted hover:text-text-primary transition-colors disabled:opacity-50"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                <span>Cancel</span>
              </button>
              <span className="text-[10px] text-text-secondary">
                ⚡ Runs 3-phase AI search · crawls competitive web data · outputs strategic recommendations
              </span>
            </div>

            <button
              type="submit"
              disabled={submitting}
              className="flex items-center justify-center gap-1.5 px-6 py-2.5 bg-accent hover:bg-accent-hover disabled:opacity-50 text-white text-xs font-bold rounded-lg transition-all shadow shadow-accent/25 self-end sm:self-auto"
            >
              {submitting ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Starting analysis…</span>
                </>
              ) : (
                <>
                  <Sparkles className="w-4 h-4" />
                  <span>Run analysis</span>
                </>
              )}
            </button>
          </div>
        </form>
      )}

      {/* VIEW 2: RUNNING PROGRESS PANEL */}
      {viewState === "running" && analysisId && (
        <ProgressPanel
          analysisId={analysisId}
          productName={productName}
          onComplete={(res) => {
            setAnalysisResult(res);
            if (res.reportId) {
              setSavedReportId(res.reportId);
            }
            setViewState("results");
          }}
          onError={(msg) => {
            toast.error(msg || "Analysis failed");
            setViewState("form");
          }}
          onCancelled={() => {
            toast("Analysis cancelled");
            setViewState("form");
          }}
        />
      )}

      {/* VIEW 3: RESULTS PANEL */}
      {viewState === "results" && analysisResult && (
        <ResultsPanel
          analysis={{ ...analysisResult, pricePoint }}
          analysisId={analysisId}
          onSaveAsReport={handleSaveAsReport}
          savingReport={savingReport}
          onNewAnalysis={() => setViewState("form")}
          onCompetitorReplaced={handleCompetitorReplaced}
          onRegenerateSynthesis={handleRegenerateSynthesis}
          regeneratingSynthesis={regeneratingSynthesis}
        />
      )}
    </div>
  );
}
