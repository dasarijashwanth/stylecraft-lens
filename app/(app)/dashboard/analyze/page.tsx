"use client";

import { useState, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { 
  Sparkles, 
  Play, 
  Loader2, 
  CheckCircle2, 
  XCircle, 
  ArrowRight,
  TrendingUp, 
  DollarSign, 
  Award,
  ChevronDown,
  ChevronUp,
  FileText,
  Target
} from "lucide-react";
import { toast } from "sonner";

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

  // Running Progress State
  const [currentPhase, setCurrentPhase] = useState(1);
  const [phase1Status, setPhase1Status] = useState<"waiting" | "active" | "done" | "error">("waiting");
  const [phase2Status, setPhase2Status] = useState<"waiting" | "active" | "done" | "error">("waiting");
  const [phase3Status, setPhase3Status] = useState<"waiting" | "active" | "done" | "error">("waiting");
  
  const [phase1Message, setPhase1Message] = useState("Waiting to start...");
  const [phase2Message, setPhase2Message] = useState("Waiting to start...");
  const [phase3Message, setPhase3Message] = useState("Waiting to start...");
  
  const [phase1Progress, setPhase1Progress] = useState(0);
  const [phase2Progress, setPhase2Progress] = useState(0);
  const [phase3Progress, setPhase3Progress] = useState(0);

  // Completed Results State
  const [phase1Result, setPhase1Result] = useState<any>(null);
  const [phase2Result, setPhase2Result] = useState<any>(null);
  const [phase3Result, setPhase3Result] = useState<any>(null);
  const [savingReport, setSavingReport] = useState(false);

  // Collapsed sections for results view
  const [p1Collapsed, setP1Collapsed] = useState(false);
  const [p2Collapsed, setP2Collapsed] = useState(false);

  // Pre-fill form if projectId is passed
  useEffect(() => {
    if (projectIdParam) {
      fetch(`/api/projects/${projectIdParam}`)
        .then(r => r.json())
        .then(data => {
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
        });
    }
  }, [projectIdParam]);

  // Load past analysis if id is passed
  useEffect(() => {
    if (pastAnalysisId) {
      fetch(`/api/analyses/${pastAnalysisId}`)
        .then(r => r.json())
        .then(data => {
          if (data.analysis && data.analysis.status === "COMPLETE") {
            setAnalysisId(data.analysis.id);
            setPhase1Result(data.analysis.phase1Result);
            setPhase2Result(data.analysis.phase2Result);
            setPhase3Result(data.analysis.phase3Result);
            setViewState("results");
          } else {
            toast.error("Analysis not found or incomplete");
          }
        });
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

    setViewState("running");
    setCurrentPhase(1);
    setPhase1Status("active");
    setPhase1Message("Initializing AI research...");
    setPhase1Progress(15);
    
    setPhase2Status("waiting");
    setPhase2Message("Waiting to start...");
    setPhase2Progress(0);
    
    setPhase3Status("waiting");
    setPhase3Message("Waiting to start...");
    setPhase3Progress(0);

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

      const currentAnalysisId = data.analysisId;
      setAnalysisId(currentAnalysisId);
      
      // Connect to Server-Sent Events stream
      const eventSource = new EventSource(data.streamUrl);
      
      eventSource.onmessage = (event) => {
        const streamData = JSON.parse(event.data);
        
        switch (streamData.type) {
          case "phase_start":
            if (streamData.phase === 1) {
              setPhase1Status("active");
              setPhase1Message(streamData.message);
              setPhase1Progress(30);
            } else if (streamData.phase === 2) {
              setPhase1Status("done");
              setPhase1Progress(100);
              setCurrentPhase(2);
              setPhase2Status("active");
              setPhase2Message(streamData.message);
              setPhase2Progress(20);
            } else if (streamData.phase === 3) {
              setPhase2Status("done");
              setPhase2Progress(100);
              setCurrentPhase(3);
              setPhase3Status("active");
              setPhase3Message(streamData.message);
              setPhase3Progress(30);
            }
            break;
            
          case "phase_progress":
            if (streamData.phase === 1) {
              setPhase1Message(streamData.message);
              setPhase1Progress(streamData.progress);
            } else if (streamData.phase === 2) {
              setPhase2Message(streamData.message);
              setPhase2Progress(streamData.progress);
            } else if (streamData.phase === 3) {
              setPhase3Message(streamData.message);
              setPhase3Progress(streamData.progress);
            }
            break;
            
          case "phase_complete":
            if (streamData.phase === 1) {
              setPhase1Status("done");
              setPhase1Message("Completed discovery");
              setPhase1Progress(100);
              setPhase1Result(streamData.result);
            } else if (streamData.phase === 2) {
              setPhase2Status("done");
              setPhase2Message("Completed intelligence mapping");
              setPhase2Progress(100);
              setPhase2Result(streamData.result);
            } else if (streamData.phase === 3) {
              setPhase3Status("done");
              setPhase3Message("Completed synthesis");
              setPhase3Progress(100);
              setPhase3Result(streamData.result);
            }
            break;
            
          case "analysis_complete":
            eventSource.close();
            toast.success("Analysis complete — 10 competitors found");
            setViewState("results");
            break;
            
          case "error":
            eventSource.close();
            setPhase1Status("error");
            setPhase2Status("error");
            setPhase3Status("error");
            toast.error(streamData.message || "Analysis failed");
            break;
        }
      };

      eventSource.onerror = () => {
        eventSource.close();
        setPhase3Status("error");
        setPhase3Message("Disconnected from analysis stream.");
      };

    } catch (err: any) {
      toast.error(err.message || "Failed to trigger analysis");
      setViewState("form");
    }
  };

  const handleSaveAsReport = async () => {
    if (!analysisId || !phase3Result) return;
    
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

  const competitiveScore = phase3Result?.competitive_score || 50;
  const strokeDashoffset = 251.2 - (251.2 * competitiveScore) / 100;
  const scoreColor = 
    competitiveScore >= 75 ? "text-success stroke-success" : 
    competitiveScore >= 50 ? "text-warning stroke-warning" : 
    "text-danger stroke-danger";

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-2">
        <h1 className="text-display">New competitive analysis</h1>
        <p className="text-xs text-text-secondary leading-normal max-w-2xl">
          Claude searches the web and Amazon indices to discover 10 competing products (5 established, 5 emerging) then maps prices, specifications, and synthesises strategic intelligence recommendations. Takes 1–2 minutes.
        </p>
      </div>

      {/* PHASE INDICATOR STRIP */}
      <div className="grid grid-cols-3 gap-3 p-4 bg-surface-2 border border-border rounded-xl text-xs">
        {[
          { phase: 1, title: "1 Discovery", desc: "Finding competitors", status: phase1Status },
          { phase: 2, title: "2 Research", desc: "Intelligence mapping", status: phase2Status },
          { phase: 3, title: "3 Synthesis", desc: "Strategic advice", status: phase3Status }
        ].map((p) => {
          const isActive = p.status === "active";
          const isDone = p.status === "done";
          const isError = p.status === "error";
          
          return (
            <div 
              key={p.phase}
              className={`flex items-center gap-3 p-2 rounded-lg border transition-all ${
                isActive ? "bg-accent-bg border-accent/40 animate-pulse-soft" :
                isDone ? "bg-success/5 border-success/20" :
                isError ? "bg-danger/5 border-danger/25" :
                "bg-surface-3/30 border-transparent opacity-65"
              }`}
            >
              <div className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold ${
                isActive ? "bg-accent text-white" :
                isDone ? "bg-success text-white" :
                isError ? "bg-danger text-white" :
                "bg-surface-3 text-text-muted"
              }`}>
                {isDone ? "✓" : p.phase}
              </div>
              <div className="min-w-0">
                <p className={`font-bold leading-none ${isActive ? "text-accent-text" : isDone ? "text-success" : isError ? "text-danger" : "text-text-secondary"}`}>
                  {p.title}
                </p>
                <p className="text-[9px] text-text-muted mt-1 truncate">{p.desc}</p>
              </div>
            </div>
          );
        })}
      </div>

      {/* VIEW 1: INPUT FORM */}
      {viewState === "form" && (
        <form onSubmit={handleRunAnalysis} className="space-y-6 text-xs">
          {/* Card 1: Product Specs */}
          <div className="bg-surface-2 border border-border rounded-xl p-5 space-y-4">
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
          <div className="bg-surface-2 border border-border rounded-xl p-5 space-y-4">
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
          <div className="bg-surface-2 border border-border rounded-xl p-5 space-y-4">
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
      {viewState === "running" && (
        <div className="bg-surface-2 border border-border rounded-xl p-6 md:p-8 space-y-6">
          <div className="flex items-center gap-3">
            <Loader2 className="w-5 h-5 text-accent animate-spin" />
            <h2 className="text-sm font-bold text-text-primary">Running Analysis: &quot;{productName}&quot;...</h2>
            <span className="ml-auto bg-accent-bg border border-accent-border text-accent-text text-[10px] font-bold px-2 py-0.5 rounded-full animate-pulse">
              Running
            </span>
          </div>

          <div className="space-y-5">
            {/* Phase 1 Progress */}
            <div className="space-y-1.5 text-xs">
              <div className="flex justify-between items-center">
                <span className="font-semibold text-text-primary">Phase 1: Discovery</span>
                <span className="font-mono text-text-muted">{phase1Progress}%</span>
              </div>
              <div className="w-full h-2 bg-surface-3 rounded-full overflow-hidden border border-border">
                <div 
                  className={`h-full bg-accent transition-all duration-300 ${phase1Status === "done" ? "bg-success" : ""}`}
                  style={{ width: `${phase1Progress}%` }}
                />
              </div>
              <p className="text-[10px] text-text-muted">{phase1Message}</p>
            </div>

            {/* Phase 2 Progress */}
            <div className="space-y-1.5 text-xs">
              <div className="flex justify-between items-center">
                <span className="font-semibold text-text-primary">Phase 2: Research Intelligence</span>
                <span className="font-mono text-text-muted">{phase2Progress}%</span>
              </div>
              <div className="w-full h-2 bg-surface-3 rounded-full overflow-hidden border border-border">
                <div 
                  className={`h-full bg-accent transition-all duration-300 ${phase2Status === "done" ? "bg-success" : ""}`}
                  style={{ width: `${phase2Progress}%` }}
                />
              </div>
              <p className="text-[10px] text-text-muted">{phase2Message}</p>
            </div>

            {/* Phase 3 Progress */}
            <div className="space-y-1.5 text-xs">
              <div className="flex justify-between items-center">
                <span className="font-semibold text-text-primary">Phase 3: Strategic Synthesis</span>
                <span className="font-mono text-text-muted">{phase3Progress}%</span>
              </div>
              <div className="w-full h-2 bg-surface-3 rounded-full overflow-hidden border border-border">
                <div 
                  className={`h-full bg-accent transition-all duration-300 ${phase3Status === "done" ? "bg-success" : ""}`}
                  style={{ width: `${phase3Progress}%` }}
                />
              </div>
              <p className="text-[10px] text-text-muted">{phase3Message}</p>
            </div>
          </div>
        </div>
      )}

      {/* VIEW 3: RESULTS PANEL */}
      {viewState === "results" && (
        <div className="space-y-6">
          {/* Success Bar / Actions */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 border border-success/20 bg-success-bg/10 rounded-xl">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-5 h-5 text-success" />
              <span className="text-xs font-semibold text-text-primary">
                Analysis complete. Found 10 competitors (5 established, 5 emerging)
              </span>
            </div>
            
            <div className="flex items-center gap-2 self-end sm:self-auto">
              <button
                onClick={() => setViewState("form")}
                className="px-3.5 py-2 border border-border bg-surface-2 hover:bg-surface-3 text-text-primary text-xs font-bold rounded-lg transition-colors"
              >
                Start Over
              </button>
              <button
                onClick={handleSaveAsReport}
                disabled={savingReport}
                className="flex items-center gap-1.5 px-4 py-2 bg-accent hover:bg-accent-hover text-white text-xs font-bold rounded-lg transition-colors shadow shadow-accent/20 disabled:opacity-50"
              >
                {savingReport ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <FileText className="w-3.5 h-3.5" />
                )}
                <span>Save as report</span>
              </button>
            </div>
          </div>

          {/* Phase 3 Panel: Strategic Synthesis (Highest Priority) */}
          {phase3Result && (
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
              {/* Executive Summary & Details (8/12) */}
              <div className="lg:col-span-8 bg-surface-2 border border-border rounded-xl p-5 space-y-5">
                <div className="flex items-center gap-2 pb-3 border-b border-border/60">
                  <Sparkles className="w-5 h-5 text-accent" />
                  <h2 className="text-sm font-bold text-text-primary">Executive Strategy Synthesis</h2>
                </div>
                
                <div className="space-y-4 text-xs">
                  <div className="space-y-1">
                    <span className="text-[10px] text-text-muted font-bold uppercase tracking-wider block">Executive Summary</span>
                    <p className="text-text-primary leading-relaxed">{phase3Result.executive_summary}</p>
                  </div>
                  
                  <div className="space-y-1">
                    <span className="text-[10px] text-text-muted font-bold uppercase tracking-wider block">Target Market Positioning</span>
                    <p className="text-text-secondary leading-relaxed">{phase3Result.market_position}</p>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2">
                    <div className="p-4 border border-border rounded-lg bg-surface-3/30 space-y-2">
                      <span className="text-[10px] text-success font-bold uppercase tracking-wider block">Key Opportunities</span>
                      <ul className="list-disc pl-4 space-y-1 text-text-secondary">
                        {phase3Result.opportunities?.map((o: string, idx: number) => (
                          <li key={idx}>{o}</li>
                        ))}
                      </ul>
                    </div>

                    <div className="p-4 border border-border rounded-lg bg-surface-3/30 space-y-2">
                      <span className="text-[10px] text-danger font-bold uppercase tracking-wider block">Threat Vectors</span>
                      <ul className="list-disc pl-4 space-y-1 text-text-secondary">
                        {phase3Result.threats?.map((t: string, idx: number) => (
                          <li key={idx}>{t}</li>
                        ))}
                      </ul>
                    </div>
                  </div>

                  <div className="space-y-3 pt-2">
                    <span className="text-[10px] text-accent font-bold uppercase tracking-wider block">Strategic Recommendations</span>
                    <div className="grid grid-cols-1 gap-2.5">
                      {phase3Result.recommendations?.map((r: any, idx: number) => (
                        <div key={idx} className="flex gap-3.5 p-3 rounded-lg border border-border bg-surface-3/10 items-start">
                          <span className={`inline-flex px-1.5 py-0.5 rounded text-[8px] font-bold uppercase shrink-0 ${
                            r.priority === "high" ? "bg-danger/10 text-danger border border-danger/25" :
                            r.priority === "medium" ? "bg-warning/10 text-warning border border-warning/25" :
                            "bg-zinc-800 text-zinc-400 border border-zinc-700"
                          }`}>
                            {r.priority}
                          </span>
                          <div className="space-y-0.5">
                            <p className="font-semibold text-text-primary">{r.title}</p>
                            <p className="text-[11px] text-text-muted leading-relaxed">{r.detail}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                </div>
              </div>

              {/* Competitive Score Gauge (4/12) */}
              <div className="lg:col-span-4 bg-surface-2 border border-border rounded-xl p-5 flex flex-col items-center justify-center text-center h-fit self-start">
                <h2 className="text-xs font-bold text-text-muted uppercase tracking-wider mb-4 w-full text-left">Market viability</h2>
                
                <div className="relative flex items-center justify-center w-32 h-32 my-4">
                  <svg className="w-full h-full transform -rotate-90">
                    <circle cx="64" cy="64" r="50" stroke="var(--surface-3)" strokeWidth="10" fill="transparent" />
                    <circle 
                      cx="64" 
                      cy="64" 
                      r="50" 
                      strokeDasharray="314.15" 
                      strokeDashoffset={314.15 - (314.15 * competitiveScore) / 100} 
                      strokeWidth="10" 
                      fill="transparent"
                      className={`transition-all duration-700 ${scoreColor}`}
                    />
                  </svg>
                  <div className="absolute flex flex-col items-center">
                    <span className="text-3xl font-black font-mono tracking-tight text-text-primary leading-none">{competitiveScore}</span>
                    <span className="text-[8px] uppercase tracking-wider text-text-muted font-bold mt-1.5">Index Rating</span>
                  </div>
                </div>

                <p className="text-xs font-semibold text-text-primary mt-2">
                  {competitiveScore >= 75 ? "Highly Favorable Position" : competitiveScore >= 50 ? "Moderate Competition" : "Hyper-competitive Risk"}
                </p>
                <p className="text-[10px] text-text-muted mt-1 max-w-[200px] leading-normal">
                  Score evaluates market entry barriers, differentiator margins, and competitor threat volumes.
                </p>
              </div>
            </div>
          )}

          {/* Phase 1 Panel: Competitors discovery (Collapsible) */}
          {phase1Result && (
            <div className="bg-surface-2 border border-border rounded-xl overflow-hidden">
              <button 
                type="button"
                onClick={() => setP1Collapsed(!p1Collapsed)}
                className="w-full px-5 py-4 border-b border-border bg-surface-3/10 flex items-center justify-between text-xs font-bold text-text-primary hover:bg-surface-3/30 transition-colors"
              >
                <div className="flex items-center gap-2">
                  <Target className="w-4 h-4 text-text-muted" />
                  <span>Phase 1 Discovery: Identified Competitor Products</span>
                </div>
                {p1Collapsed ? <ChevronDown className="w-4 h-4" /> : <ChevronUp className="w-4 h-4" />}
              </button>

              {!p1Collapsed && (
                <div className="p-5 space-y-6 text-xs">
                  {/* Established Segment */}
                  <div className="space-y-3">
                    <h3 className="text-xs font-bold text-indigo-400 flex items-center gap-1">
                      <Award className="w-4 h-4 shrink-0" />
                      <span>Established Market Leaders (5)</span>
                    </h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {phase1Result.established?.map((c: any, idx: number) => (
                        <div key={idx} className="p-4 border border-border rounded-xl bg-surface-3/20 space-y-2">
                          <div className="flex justify-between items-start">
                            <div>
                              <p className="font-bold text-text-primary">{c.name}</p>
                              <p className="text-[10px] text-text-muted mt-0.5">{c.category}</p>
                            </div>
                            <span className="px-1.5 py-0.5 text-[9px] bg-zinc-800 border border-zinc-700 text-zinc-300 font-mono rounded">
                              {c.price_range}
                            </span>
                          </div>
                          <p className="text-[11px] text-text-secondary leading-normal">{c.standout_feature}</p>
                          <div className="flex items-center justify-between pt-2 border-t border-border/40 text-[10px]">
                            <div className="flex gap-1.5">
                              {c.tags?.map((t: string) => (
                                <span key={t} className="px-1.5 py-0.5 bg-surface-3 rounded text-[8px] text-text-muted">
                                  {t}
                                </span>
                              ))}
                            </div>
                            <span className="font-mono text-text-muted">Threat: {c.threat_score}%</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Emerging Segment */}
                  <div className="space-y-3 pt-2">
                    <h3 className="text-xs font-bold text-accent-text flex items-center gap-1">
                      <TrendingUp className="w-4 h-4 shrink-0" />
                      <span>Emerging Challenger Brands (5)</span>
                    </h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {phase1Result.emerging?.map((c: any, idx: number) => (
                        <div key={idx} className="p-4 border border-border rounded-xl bg-surface-3/20 space-y-2">
                          <div className="flex justify-between items-start">
                            <div>
                              <p className="font-bold text-text-primary">{c.name}</p>
                              <p className="text-[10px] text-text-muted mt-0.5">{c.category}</p>
                            </div>
                            <span className="px-1.5 py-0.5 text-[9px] bg-zinc-800 border border-zinc-700 text-zinc-300 font-mono rounded">
                              {c.price_range}
                            </span>
                          </div>
                          <p className="text-[11px] text-text-secondary leading-normal">{c.standout_feature}</p>
                          <div className="flex items-center justify-between pt-2 border-t border-border/40 text-[10px]">
                            <div className="flex gap-1.5">
                              {c.tags?.map((t: string) => (
                                <span key={t} className="px-1.5 py-0.5 bg-surface-3 rounded text-[8px] text-text-muted">
                                  {t}
                                </span>
                              ))}
                            </div>
                            <span className="font-mono text-text-muted">Threat: {c.threat_score}%</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Phase 2 Panel: Intelligence findings (Collapsible) */}
          {phase2Result && (
            <div className="bg-surface-2 border border-border rounded-xl overflow-hidden">
              <button 
                type="button"
                onClick={() => setP2Collapsed(!p2Collapsed)}
                className="w-full px-5 py-4 border-b border-border bg-surface-3/10 flex items-center justify-between text-xs font-bold text-text-primary hover:bg-surface-3/30 transition-colors"
              >
                <div className="flex items-center gap-2">
                  <Sparkles className="w-4 h-4 text-text-muted" />
                  <span>Phase 2 Research: Competitive Intelligence Insights</span>
                </div>
                {p2Collapsed ? <ChevronDown className="w-4 h-4" /> : <ChevronUp className="w-4 h-4" />}
              </button>

              {!p2Collapsed && (
                <div className="p-5 space-y-4 text-xs">
                  <div className="grid grid-cols-1 gap-3">
                    {phase2Result.research?.map((r: any, idx: number) => (
                      <div key={idx} className="p-4 border border-border rounded-xl bg-surface-3/20 space-y-2">
                        <div className="flex justify-between items-center border-b border-border/40 pb-2">
                          <span className="font-bold text-text-primary text-sm">{r.competitor}</span>
                          <span className="px-1.5 py-0.5 rounded text-[8px] bg-zinc-800 text-zinc-400 font-mono">
                            {r.tier.toUpperCase()} • {r.pricing}
                          </span>
                        </div>
                        
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs pt-1">
                          <div className="space-y-1">
                            <span className="text-[9px] text-text-muted uppercase font-bold">Positioning</span>
                            <p className="text-text-secondary leading-normal">{r.positioning}</p>
                          </div>
                          <div className="space-y-1">
                            <span className="text-[9px] text-text-muted uppercase font-bold">Strength / Advantage</span>
                            <p className="text-text-secondary leading-normal">{r.strength}</p>
                          </div>
                          <div className="space-y-1">
                            <span className="text-[9px] text-text-muted uppercase font-bold">Weakness / Vulnerability</span>
                            <p className="text-text-secondary leading-normal">{r.weakness}</p>
                          </div>
                        </div>

                        <div className="mt-3 p-3 bg-accent-bg/40 border border-accent-border/50 rounded-lg text-[11px] leading-relaxed">
                          <span className="font-bold text-accent-text block mb-0.5">Strategic Action Recommendation</span>
                          <p className="text-text-primary italic">&quot;{r.insight}&quot;</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

        </div>
      )}
    </div>
  );
}
