"use client";

import { useState, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Sparkles } from "lucide-react";
import { toast } from "sonner";
import { ProgressPanel } from "@/components/analyze/ProgressPanel";
import { ResultsPanel } from "@/components/analyze/ResultsPanel";

export default function AnalyzePage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  
  const projectIdParam = searchParams.get("projectId");
  const pastAnalysisId = searchParams.get("id");

  // App view state: 'form' | 'running' | 'results'
  const [viewState, setViewState] = useState<"form" | "running" | "results">("form");
  const [analysisId, setAnalysisId] = useState<string | null>(null);

  // Form Fields State
  const [industry, setIndustry] = useState("grooming");
  const [targetMarket, setTargetMarket] = useState<"pro" | "consumer" | "both">("both");
  const [productName, setProductName] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState("");
  const [pricePoint, setPricePoint] = useState("");
  const [companyContext, setCompanyContext] = useState("");
  const [motorTech, setMotorTech] = useState("");
  const [keyDiff, setKeyDiff] = useState("");

  // Completed Results State (Aggregated results object)
  const [analysisResult, setAnalysisResult] = useState<any>(null);
  const [savingReport, setSavingReport] = useState(false);

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

  // Load past analysis if id is passed
  useEffect(() => {
    if (pastAnalysisId) {
      fetch(`/api/analyses/${pastAnalysisId}`)
        .then((r) => r.json())
        .then((data) => {
          if (data.analysis && data.analysis.status === "COMPLETE") {
            setAnalysisId(data.analysis.id);
            setProductName(data.analysis.project?.productName || "Product Analysis");
            
            const p1 = data.analysis.phase1Result || {};
            const p2 = data.analysis.phase2Result || {};
            const p3 = data.analysis.phase3Result || {};
            const searches = (p1.web_searches_performed || 0) + (p2.web_searches_performed || 0) + (p3.web_searches_performed || 0);

            setAnalysisResult({
              phase1: p1,
              phase2: p2,
              phase3: p3,
              productName: data.analysis.project?.productName || "Product Analysis",
              totalSearches: searches
            });
            setViewState("results");
          } else {
            toast.error("Analysis not found or incomplete");
          }
        })
        .catch(() => {});
    }
  }, [pastAnalysisId]);

  const handleRunAnalysis = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!productName.trim()) {
      toast.error("Product name is required");
      return;
    }
    if (description.trim().length < 10) {
      toast.error("Please add at least 10 characters in product description");
      return;
    }

    try {
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
          companyContext: companyContext.trim() || undefined,
          motorTech: motorTech || undefined,
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
    }
  };

  const handleSaveAsReport = async () => {
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
            Claude searches the web and Amazon indices to discover 10 competing products (5 established, 5 emerging) then maps prices, specifications, and synthesises strategic intelligence recommendations. Takes 1–2 minutes.
          </p>
        </div>
      )}

      {/* VIEW 1: INPUT FORM */}
      {viewState === "form" && (
        <form onSubmit={handleRunAnalysis} className="space-y-6 text-xs">
          {/* Card 1: Product Specs */}
          <div className="bg-surface-2 border border-border rounded-xl p-5 space-y-4 shadow-sm">
            <h2 className="text-xs font-bold text-text-muted uppercase tracking-wider">Product details</h2>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-1">
                <label className="font-semibold text-text-primary block">Industry *</label>
                <select
                  value={industry}
                  onChange={(e) => setIndustry(e.target.value)}
                  className="w-full px-3 py-2 border border-border rounded-lg bg-surface-1 text-text-primary outline-none focus:border-accent"
                >
                  <option value="grooming">Grooming & Barbering</option>
                  <option value="haircare">Hair Care & Styling</option>
                  <option value="beauty">Beauty & Cosmetics</option>
                  <option value="fashion">Fashion & Apparel</option>
                  <option value="other">Other Creative Category</option>
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
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-1">
                <label className="font-semibold text-text-primary block">Product Name *</label>
                <input
                  type="text"
                  value={productName}
                  onChange={(e) => setProductName(e.target.value)}
                  placeholder="e.g. Apex Cordless Clipper"
                  className="w-full px-3 py-2 border border-border rounded-lg bg-surface-1 text-text-primary outline-none focus:border-accent"
                  required
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
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
                  <label className="font-semibold text-text-primary block">Target Price</label>
                  <input
                    type="text"
                    value={pricePoint}
                    onChange={(e) => setPricePoint(e.target.value)}
                    placeholder="e.g. $180"
                    className="w-full px-3 py-2 border border-border rounded-lg bg-surface-1 text-text-primary outline-none focus:border-accent"
                  />
                </div>
              </div>
            </div>

            <div className="space-y-1">
              <div className="flex justify-between items-center">
                <label className="font-semibold text-text-primary">Product Description *</label>
                <span className="text-[10px] text-text-muted">{description.length} chars</span>
              </div>
              <textarea
                rows={4}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Describe key specs, blade material, batteries, target audience..."
                className="w-full px-3 py-2 border border-border rounded-lg bg-surface-1 text-text-primary outline-none focus:border-accent resize-y"
                required
              />
            </div>
          </div>

          {/* Card 2: Company Context */}
          <div className="bg-surface-2 border border-border rounded-xl p-5 space-y-4 shadow-sm">
            <h2 className="text-xs font-bold text-text-muted uppercase tracking-wider">Company context</h2>
            <div className="space-y-1">
              <label className="font-semibold text-text-primary block">Company context</label>
              <textarea
                rows={2}
                value={companyContext}
                onChange={(e) => setCompanyContext(e.target.value)}
                placeholder="Describe your brand positioning, current distribution channels, or strategic business goals..."
                className="w-full px-3 py-2 border border-border rounded-lg bg-surface-1 text-text-primary outline-none focus:border-accent resize-y"
              />
            </div>
          </div>

          {/* Card 3: Precision specs */}
          <div className="bg-surface-2 border border-border rounded-xl p-5 space-y-4 shadow-sm">
            <h2 className="text-xs font-bold text-text-muted uppercase tracking-wider">Precision targeting</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-1">
                <label className="font-semibold text-text-primary block">Motor technology</label>
                <select
                  value={motorTech}
                  onChange={(e) => setMotorTech(e.target.value)}
                  className="w-full px-3 py-2 border border-border rounded-lg bg-surface-1 text-text-primary outline-none focus:border-accent"
                >
                  <option value="">Select motor type</option>
                  <option value="Brushless DC">Brushless DC (BLDC)</option>
                  <option value="Rotary">Rotary motor</option>
                  <option value="Magnetic/Pivot">Magnetic / Pivot motor</option>
                  <option value="Universal/Corded">Universal corded motor</option>
                  <option value="Cordless Li-ion">Cordless / Lithium-ion</option>
                </select>
              </div>

              <div className="space-y-1">
                <label className="font-semibold text-text-primary block">Key differentiating feature</label>
                <input
                  type="text"
                  value={keyDiff}
                  onChange={(e) => setKeyDiff(e.target.value)}
                  placeholder="e.g. interchangeable custom bodies, 4-hour battery life"
                  className="w-full px-3 py-2 border border-border rounded-lg bg-surface-1 text-text-primary outline-none focus:border-accent"
                />
              </div>
            </div>
          </div>

          {/* Action Row */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 border border-border bg-surface-2 rounded-xl">
            <span className="text-[10px] text-text-secondary">
              ⚡ Runs 3-phase AI search · crawls competitive web data · outputs strategic recommendations
            </span>
            
            <button
              type="submit"
              className="flex items-center justify-center gap-1.5 px-6 py-2.5 bg-accent hover:bg-accent-hover text-white text-xs font-bold rounded-lg transition-all shadow shadow-accent/25 self-end sm:self-auto"
            >
              <Sparkles className="w-4 h-4" />
              <span>Run analysis</span>
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
            setViewState("results");
          }}
          onError={(msg) => {
            toast.error(msg || "Analysis failed");
            setViewState("form");
          }}
        />
      )}

      {/* VIEW 3: RESULTS PANEL */}
      {viewState === "results" && analysisResult && (
        <ResultsPanel
          analysis={analysisResult}
          onSaveAsReport={handleSaveAsReport}
          savingReport={savingReport}
          onNewAnalysis={() => setViewState("form")}
        />
      )}
    </div>
  );
}
