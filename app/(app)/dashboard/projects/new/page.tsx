"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Save, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { ToolType, TOOL_TYPE_LABELS, toolTypesForIndustry } from "@/lib/tool-type-taxonomy";
import { parsePriceToNumber } from "@/lib/pricing-analysis";

const TARGET_MARKET_LABELS: Record<string, string> = { pro: "Pro / Salon", consumer: "Consumer", both: "Both" };

interface MotorFamilyOption {
  family_key: string;
  label: string;
  domain: string;
  aliases: string[];
}

export default function NewProjectPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState<{ [key: string]: string }>({});

  // Form Fields State
  const [name, setName] = useState("");
  const [industry, setIndustry] = useState("grooming-barbering");
  const [targetMarket, setTargetMarket] = useState<"pro" | "consumer" | "both">("both");
  const [productName, setProductName] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState("");
  // Strict tool-type isolation (lib/tool-type-taxonomy.ts) — required so a
  // trimmer project can never pull in clipper data (or vice versa) across
  // every analysis run from it.
  const [toolType, setToolType] = useState<ToolType | "">("");
  const [pricePoint, setPricePoint] = useState("");
  
  // Advanced / Precision fields
  const [companyContext, setCompanyContext] = useState("");
  const [motorTech, setMotorTech] = useState("");
  const [keyDiff, setKeyDiff] = useState("");

  // Product anchor — optional, drives the real-time TDS snapshot + GTM
  // auto-fill pipeline. The project name above stays a reference label
  // only; this is what actually identifies the product.
  const [productUrl, setProductUrl] = useState("");
  const [asin, setAsin] = useState("");
  const [motorFamilies, setMotorFamilies] = useState<MotorFamilyOption[]>([]);

  // Populates the Motor Technology <datalist> with the real taxonomy
  // (lib/motor-taxonomy.ts) — mirrors app/(app)/dashboard/analyze/page.tsx.
  useEffect(() => {
    fetch("/api/motor-families")
      .then(r => r.json())
      .then(data => setMotorFamilies(data.families || []))
      .catch(() => {});
  }, []);

  // Suggests the whole form from the most recent analysis that hasn't been
  // linked to a project yet — lets a user go straight from finishing an
  // analysis to creating its project without retyping anything they
  // already gave it. analysis.context is the exact form the analyze page
  // submitted (see AnalysisFormSchema/lib/validations.ts), so its field
  // names map 1:1 onto this form's own state. Every field is only set if
  // still empty when the fetch resolves, so this never clobbers anything
  // the user already typed while the request was in flight.
  useEffect(() => {
    fetch("/api/analyses")
      .then(r => r.json())
      .then(data => {
        const analyses = data.analyses || [];
        const recentUnlinked = analyses.find((a: any) => !a.project_id && a.context?.productName);
        if (!recentUnlinked) return;
        const ctx = recentUnlinked.context;

        setName(prev => prev.trim() ? prev : ctx.productName);
        setProductName(prev => prev.trim() ? prev : ctx.productName);
        setDescription(prev => prev.trim() ? prev : (ctx.description || ""));
        if (ctx.industry) setIndustry(prev => prev === "grooming-barbering" ? ctx.industry : prev);
        if (ctx.targetMarket) setTargetMarket(prev => prev === "both" ? ctx.targetMarket : prev);
        setCategory(prev => prev.trim() ? prev : (ctx.category || ""));
        if (ctx.toolType) setToolType(prev => prev ? prev : ctx.toolType);
        setPricePoint(prev => prev.trim() ? prev : (ctx.pricePoint || ""));
        setCompanyContext(prev => prev.trim() ? prev : (ctx.companyContext || ""));
        setMotorTech(prev => prev.trim() ? prev : (ctx.motorTech || ""));
        setKeyDiff(prev => prev.trim() ? prev : (ctx.keyDiff || ""));

        toast(`Suggested from your recent analysis: "${ctx.productName}"`);
      })
      .catch(() => {});
  }, []);

  const validate = (): boolean => {
    const errs: { [key: string]: string } = {};
    if (!name.trim()) errs.name = "Project name is required";
    if (!productName.trim()) {
      errs.productName = "Product name is required";
    } else if (productName.trim().length < 3) {
      errs.productName = "Product name must be at least 3 characters";
    }
    if (!description.trim()) {
      errs.description = "Product description is required";
    } else if (description.length < 10) {
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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate()) return;

    setLoading(true);
    try {
      const res = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          industry,
          targetMarket,
          productName: productName.trim(),
          description: description.trim(),
          category: category.trim() || undefined,
          toolType,
          pricePoint: pricePoint.trim() || undefined,
          companyContext: companyContext.trim() || undefined,
          // Never submit a motor type for Hair Care & Styling — the field
          // only applies to Grooming & Barbering, even if a catalog
          // auto-fill left a stale value sitting in state.
          motorTech: industry === "haircare-styling" ? undefined : (motorTech.trim() || undefined),
          keyDiff: keyDiff.trim() || undefined,
          productUrl: productUrl.trim() || undefined,
          asin: asin.trim() || undefined,
        })
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.message);

      // The snapshot -> TDS -> GTM pipeline is now seeded server-side by
      // POST /api/projects itself (atomic with creation, for every project
      // regardless of whether a product anchor was given) — no client-side
      // trigger needed here anymore. The project page picks up the
      // in-progress pipeline via ProjectGenerationProgress.
      toast.success("Project created");
      router.push(`/dashboard/projects/${data.project.id}`);
    } catch (err: any) {
      toast.error(err.message || "Failed to create project");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6 max-w-3xl">
      {/* Back link */}
      <div>
        <button
          onClick={() => router.back()}
          className="flex items-center gap-1.5 text-xs text-text-muted hover:text-text-primary transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Back to projects</span>
        </button>
      </div>

      <div className="flex flex-col gap-2">
        <h1 className="text-display">Create new project</h1>
        <p className="text-xs text-text-muted">
          Define your product offering and market context to align AI competitor analyses.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6 text-xs">
        
        {/* CARD 1: Core Details */}
        <div className="bg-surface-2 border border-border rounded-xl p-5 space-y-4">
          <h2 className="text-sm font-bold text-text-primary">Core project details</h2>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Project Name */}
            <div className="space-y-1">
              <label className="font-semibold text-text-primary block">Project Name *</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Apex Clipper launch"
                className={`w-full px-3 py-2 border rounded-lg bg-surface-1 outline-none text-text-primary placeholder-text-muted focus:border-accent ${
                  errors.name ? "border-danger" : "border-border"
                }`}
              />
              {errors.name && <p className="text-[10px] text-danger">{errors.name}</p>}
            </div>

            {/* Product Name */}
            <div className="space-y-1">
              <label className="font-semibold text-text-primary block">Product Name *</label>
              <input
                type="text"
                value={productName}
                onChange={(e) => setProductName(e.target.value)}
                placeholder="e.g. Apex Cordless Clipper"
                className={`w-full px-3 py-2 border rounded-lg bg-surface-1 outline-none text-text-primary placeholder-text-muted focus:border-accent ${
                  errors.productName ? "border-danger" : "border-border"
                }`}
              />
              {errors.productName && <p className="text-[10px] text-danger">{errors.productName}</p>}
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Industry selection */}
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
                  // toolTypesForIndustry) — a Tool Type valid under the old
                  // Industry is meaningless once the Industry no longer
                  // offers it.
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

            {/* Target market segmented buttons */}
            <div className="space-y-1">
              <label className="font-semibold text-text-primary block mb-1">Target Market *</label>
              <div className="grid grid-cols-3 gap-1 p-1 rounded-lg bg-surface-1 border border-border">
                {[
                  { key: "pro", label: "Pro / Salon" },
                  { key: "consumer", label: "Consumer" },
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
                Affects which competitor brands are searched — Pro/Salon and Consumer use separate curated brand lists; Both merges and dedupes across both.
              </p>
            </div>
          </div>

          {/* Product Description */}
          <div className="space-y-1">
            <div className="flex justify-between items-center">
              <label className="font-semibold text-text-primary">Product Description *</label>
              <span className="text-[10px] text-text-muted">{description.length} chars</span>
            </div>
            <textarea
              rows={4}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What do you sell? Who is the target demographic? What makes your blade/motor technology special?"
              className={`w-full px-3 py-2 border rounded-lg bg-surface-1 outline-none text-text-primary placeholder-text-muted resize-y focus:border-accent ${
                errors.description ? "border-danger" : "border-border"
              }`}
            />
            {errors.description && <p className="text-[10px] text-danger">{errors.description}</p>}
          </div>
        </div>

        {/* CARD 1B: Product Anchor — real product identity, drives TDS + GTM auto-fill */}
        <div className="bg-surface-2 border border-border rounded-xl p-5 space-y-4">
          <div>
            <h2 className="text-sm font-bold text-text-primary">Product anchor (optional)</h2>
            <p className="text-[10px] text-text-muted mt-1">
              Add the official product page URL and/or Amazon ASIN to automatically capture real specs into a live
              Technical Data Sheet and pre-fill the Go-To-Market sheet. The project name above is just a label — this
              is what identifies the actual product.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-1">
              <label className="font-semibold text-text-primary block">Product URL</label>
              <input
                type="text"
                value={productUrl}
                onChange={(e) => setProductUrl(e.target.value)}
                placeholder="https://brand.com/products/apex-clipper"
                className="w-full px-3 py-2 border border-border rounded-lg bg-surface-1 text-text-primary placeholder-text-muted outline-none focus:border-accent"
              />
            </div>

            <div className="space-y-1">
              <label className="font-semibold text-text-primary block">Amazon ASIN</label>
              <input
                type="text"
                value={asin}
                onChange={(e) => setAsin(e.target.value.toUpperCase())}
                placeholder="e.g. B0DTJLSTYM"
                maxLength={10}
                className="w-full px-3 py-2 border border-border rounded-lg bg-surface-1 text-text-primary placeholder-text-muted outline-none focus:border-accent font-mono"
              />
            </div>
          </div>
        </div>

        {/* CARD 2: Advanced Context */}
        <div className="bg-surface-2 border border-border rounded-xl p-5 space-y-4">
          <h2 className="text-sm font-bold text-text-primary">Advanced marketing positioning</h2>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Tool Type — strict, required (lib/tool-type-taxonomy.ts).
                Kept separate from the free-text Market/Amazon Category
                below, which alone isn't reliable enough to gate which
                competitors/specs/reviews an analysis pulls in. */}
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

            {/* Category */}
            <div className="space-y-1">
              <label className="font-semibold text-text-primary block">Market / Amazon Category</label>
              <input
                type="text"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                placeholder="e.g. Hair Clippers & Trimmers"
                className="w-full px-3 py-2 border border-border rounded-lg bg-surface-1 text-text-primary outline-none focus:border-accent"
              />
            </div>

            {/* Price Point */}
            <div className="space-y-1">
              <label className="font-semibold text-text-primary block">Target Price Point *</label>
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

          {/* Positioning Context — product facts, not company/brand
              description (feeds AI positioning advice for THIS product). */}
          <div className="space-y-1">
            <label className="font-semibold text-text-primary block">Positioning Context</label>
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

        {/* CARD 3: Hardware specs (Precision target) */}
        <div className="bg-surface-2 border border-border rounded-xl p-5 space-y-4">
          <h2 className="text-sm font-bold text-text-primary">Precision hardware targets</h2>
          
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

            {/* Key Differentiator */}
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
            real value right before the project is created (no new state). */}
        {productName.trim() && toolType && (
          <p className="text-[11px] text-text-secondary bg-surface-3/30 border border-border rounded-lg px-4 py-2.5">
            Analyzing: <span className="font-semibold text-text-primary">{productName.trim()}</span> — {TOOL_TYPE_LABELS[toolType]}, {motorTech.trim() || "motor tech unspecified"}, {pricePoint.trim() || "price unspecified"}, {TARGET_MARKET_LABELS[targetMarket]} market
            {keyDiff.trim() && <> · differentiator: {keyDiff.trim()}</>}
          </p>
        )}

        {/* Action Row */}
        <div className="flex justify-end gap-3 pt-2">
          <button
            type="button"
            onClick={() => router.push("/dashboard/projects")}
            disabled={loading}
            className="px-4 py-2.5 rounded-lg border border-border hover:bg-surface-3 font-semibold text-text-primary transition-colors"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={loading}
            className="px-4 py-2.5 rounded-lg bg-accent hover:bg-accent-hover font-semibold text-white flex items-center justify-center gap-1.5 transition-all shadow shadow-accent/25"
          >
            {loading ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                <span>Creating project...</span>
              </>
            ) : (
              <>
                <Save className="w-3.5 h-3.5" />
                <span>Save project</span>
              </>
            )}
          </button>
        </div>

      </form>
    </div>
  );
}
