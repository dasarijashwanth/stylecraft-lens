"use client";

import { useState, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, Loader2, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { ProgressPanel } from "@/components/analyze/ProgressPanel";
import { ResultsPanel } from "@/components/analyze/ResultsPanel";
import { STYLECRAFT_PRODUCTS, PRODUCT_CATEGORIES } from "@/lib/stylecraft-products";
import { ToolType, TOOL_TYPE_LABELS, toolTypesForIndustry, deriveToolTypeFromCatalogProduct } from "@/lib/tool-type-taxonomy";
import { parsePriceToNumber } from "@/lib/pricing-analysis";

const TARGET_MARKET_LABELS: Record<string, string> = { pro: "Pro / Salon", consumer: "Retail", both: "Both" };

interface MotorFamilyOption {
  family_key: string;
  label: string;
  domain: string;
  aliases: string[];
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
  const [motorTech, setMotorTech] = useState("");
  const [keyDiff, setKeyDiff] = useState("");
  const [motorFamilies, setMotorFamilies] = useState<MotorFamilyOption[]>([]);

  // Populates the Motor Technology <datalist> with the real taxonomy
  // (lib/motor-taxonomy.ts) instead of a fixed 5-option list — free text is
  // still fully accepted (an unrecognized entry is kept verbatim and
  // flagged for the taxonomy admin, see lib/motor-extraction.ts).
  useEffect(() => {
    fetch("/api/motor-families")
      .then(r => r.json())
      .then(data => setMotorFamilies(data.families || []))
      .catch(() => {});
  }, []);

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
      setMotorTech("");
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
    setToolType(deriveToolTypeFromCatalogProduct(product) || "");
    // Same reasoning as the "custom" branch above — the StyleCraft catalog
    // has no real BSR/target-customer data per product, so there's nothing
    // genuine to prefill; leave it for the user to fill in per-product.
    setCompanyContext("");
    setMotorTech(product.motorType);
    setKeyDiff(product.keyFeatures[0] || "");
    setPricePoint(`$${product.price}`);
  }

  // Completed Results State (Aggregated results object)
  const [analysisResult, setAnalysisResult] = useState<any>(null);
  const [savingReport, setSavingReport] = useState(false);
  const [savedReportId, setSavedReportId] = useState<string | null>(null);

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
            setMotorTech(p.motorTech || "");
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
              motorTech,
              keyDiff: keyDiff.trim(),
            }
          })
        }).catch(() => {});
      }

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
          // Never submit a motor type for Hair Care & Styling — the field
          // only applies to Grooming & Barbering, even if a catalog
          // auto-fill left a stale value sitting in state.
          motorTech: industry === "haircare-styling" ? undefined : (motorTech.trim() || undefined),
          keyDiff: keyDiff.trim() || undefined,
          pricePoint: pricePoint.trim() || undefined,
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
                    // Motor technology (rotary/magnetic/pivot clipper-style
                    // motors) only applies to Grooming & Barbering tools —
                    // clear any prior selection so a stale motor type never
                    // gets submitted for a Hair Care & Styling product.
                    if (e.target.value === "haircare-styling") setMotorTech("");
                    // Tool Type options are Industry-dependent (see
                    // toolTypesForIndustry) — a Tool Type valid under the
                    // old Industry (e.g. "Trimmer") is meaningless once the
                    // Industry no longer offers it.
                    setToolType(prev => (toolTypesForIndustry(e.target.value).includes(prev as ToolType) ? prev : ""));
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
                      setToolType(e.target.value as ToolType);
                      if (errors.toolType) setErrors(prev => { const n = { ...prev }; delete n.toolType; return n; });
                    }}
                    className={`w-full px-3 py-2 border rounded-lg bg-surface-1 outline-none text-text-primary focus:border-accent ${
                      errors.toolType ? "border-danger" : "border-border"
                    }`}
                  >
                    <option value="" disabled>Select exact tool type…</option>
                    {toolTypesForIndustry(industry).map((value) => (
                      <option key={value} value={value}>{TOOL_TYPE_LABELS[value]}</option>
                    ))}
                  </select>
                  {errors.toolType && <p className="text-[10px] text-danger">{errors.toolType}</p>}
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
              {/* Motor technology — Grooming & Barbering only (clipper/trimmer/
                  shaver-style motors); not applicable to Hair Care & Styling tools. */}
              {industry !== "haircare-styling" && (
                <div className="space-y-1">
                  <label className="font-semibold text-text-primary block">Motor technology</label>
                  <input
                    type="text"
                    list="motor-family-options"
                    value={motorTech}
                    onChange={(e) => setMotorTech(e.target.value)}
                    placeholder="e.g. Vector, Magnetic, Rotary, Brushless DC…"
                    className="w-full px-3 py-2 border border-border rounded-lg bg-surface-1 text-text-primary outline-none focus:border-accent"
                  />
                  <datalist id="motor-family-options">
                    {motorFamilies.map(f => (
                      <option key={f.family_key} value={f.label} />
                    ))}
                  </datalist>
                  <p className="text-[10px] text-text-muted">
                    Claude searches for {(toolType ? TOOL_TYPE_LABELS[toolType].toLowerCase() : "matching")} products with this motor technology first, then narrows by price. Free text is fine — an unrecognized entry is kept as-is, never guessed.
                  </p>
                </div>
              )}

              <div className={`space-y-1 ${industry === "haircare-styling" ? "md:col-span-2" : ""}`}>
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

          {/* Review-step summary — pure derived text, confirms every field's
              real value right before the run starts (no new state). */}
          {productName.trim() && toolType && (
            <p className="text-[11px] text-text-secondary bg-surface-3/30 border border-border rounded-lg px-4 py-2.5">
              Analyzing: <span className="font-semibold text-text-primary">{productName.trim()}</span> — {TOOL_TYPE_LABELS[toolType]}, {motorTech.trim() || "motor tech unspecified"}, {pricePoint.trim() || "price unspecified"}, {TARGET_MARKET_LABELS[targetMarket]} market
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
        />
      )}
    </div>
  );
}
