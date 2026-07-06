"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { 
  Briefcase, 
  Sparkles, 
  Target, 
  ArrowRight, 
  ShieldCheck, 
  ChevronRight, 
  Sliders,
  Award,
  Crown,
  Laptop,
  Flame,
  CheckCircle2,
  Loader2
} from "lucide-react";
import { toast } from "sonner";

export default function OnboardingPage() {
  const router = useRouter();
  
  // Wizard steps: 1 | 2 | 3 | 4 | 5
  const [step, setStep] = useState(1);
  
  // Onboarding Form States
  const [workspaceName, setWorkspaceName] = useState("");
  const [selectedIndustry, setSelectedIndustry] = useState("grooming-barbering");
  const [competitorName, setCompetitorName] = useState("");
  const [competitorWebsite, setCompetitorWebsite] = useState("");
  const [productName, setProductName] = useState("");
  const [productDescription, setProductDescription] = useState("");

  const [submitting, setSubmitting] = useState(false);

  const handleStep1Continue = (e: React.FormEvent) => {
    e.preventDefault();
    if (!workspaceName.trim()) {
      toast.error("Workspace name is required");
      return;
    }
    setStep(2);
  };

  const handleIndustrySelect = (industry: string) => {
    setSelectedIndustry(industry);
    setStep(3);
  };

  const handleStep3Continue = (e: React.FormEvent) => {
    e.preventDefault();
    if (!competitorName.trim()) {
      toast.error("Competitor name is required");
      return;
    }
    setStep(4);
  };

  const handleFinishOnboarding = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!productName.trim() || !productDescription.trim()) {
      toast.error("Product name and description are required");
      return;
    }

    setSubmitting(true);
    setStep(5);

    try {
      // 1. Create org workspace
      let orgRes = await fetch("/api/projects", { // using project as fallback DB check
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: `${workspaceName} Research`,
          industry: selectedIndustry,
          targetMarket: "both",
          productName,
          description: productDescription,
        })
      });

      // 2. Create first competitor
      await fetch("/api/competitors", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: competitorName,
          website: competitorWebsite || undefined,
          status: "ACTIVE",
          tags: ["seed", selectedIndustry]
        })
      });

      // 3. Trigger initial analysis
      await fetch("/api/analyses", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          industry: selectedIndustry,
          targetMarket: "both",
          productName,
          description: productDescription
        })
      });
      
    } catch (err) {
      console.warn("Onboarding network saving partially failed, moving to dashboard:", err);
    } finally {
      setTimeout(() => {
        toast.success("Welcome to Stylecraft Lens!");
        toast.info("Your first analysis is running in background…");
        router.push("/dashboard");
      }, 2500);
    }
  };

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-bg text-text-primary px-4">
      
      {/* Step dots indicator at top */}
      <div className="flex items-center gap-2 mb-8 select-none">
        {[1, 2, 3, 4, 5].map((s) => (
          <div
            key={s}
            className={`h-1.5 rounded-full transition-all duration-300 ${
              step === s 
                ? "w-6 bg-accent" 
                : s < step 
                ? "w-2.5 bg-success" 
                : "w-2 bg-surface-3"
            }`}
          />
        ))}
      </div>

      {/* Main onboarding container */}
      <div className="w-full max-w-md bg-surface-2 border border-border rounded-2xl p-6 md:p-8 shadow-2xl relative overflow-hidden">
        
        {/* Glow effect background decorative circle */}
        <div className="absolute -top-24 -left-24 w-48 h-48 rounded-full bg-accent/15 blur-3xl" />
        
        {/* STEP 1: Workspace Name */}
        {step === 1 && (
          <form onSubmit={handleStep1Continue} className="space-y-6 text-xs relative z-10">
            <div className="space-y-2">
              <span className="text-[10px] text-accent font-bold uppercase tracking-widest block">Step 1 of 5</span>
              <h2 className="text-xl font-bold text-text-primary">Establish your workspace</h2>
              <p className="text-text-secondary leading-normal">
                Let&apos;s configure a dashboard org for your creative brand or agency. You can invite team members later.
              </p>
            </div>

            <div className="space-y-1.5">
              <label className="font-semibold text-text-primary">Workspace Name *</label>
              <input
                type="text"
                value={workspaceName}
                onChange={(e) => setWorkspaceName(e.target.value)}
                placeholder="e.g. Apex Barber Co, Velvet Beauty"
                className="w-full px-3.5 py-2.5 border border-border rounded-xl bg-surface-1 outline-none text-text-primary placeholder-text-muted focus:border-accent text-xs"
                required
              />
            </div>

            <button
              type="submit"
              className="w-full py-2.5 bg-accent hover:bg-accent-hover text-white text-xs font-bold rounded-xl transition-colors flex items-center justify-center gap-1.5 shadow shadow-accent/25"
            >
              <span>Continue</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          </form>
        )}

        {/* STEP 2: Industry selection */}
        {step === 2 && (
          <div className="space-y-6 text-xs relative z-10">
            <div className="space-y-2">
              <span className="text-[10px] text-accent font-bold uppercase tracking-widest block">Step 2 of 5</span>
              <h2 className="text-xl font-bold text-text-primary">Choose your industry</h2>
              <p className="text-text-secondary leading-normal">
                Select your focus sector. This aligns Gemini&apos;s search indices and threat score weighting.
              </p>
            </div>

            <div className="grid grid-cols-1 gap-2">
              {[
                { id: "grooming-barbering", name: "Grooming & Barbering", icon: Sliders, desc: "Clippers, trimmers, blades, custom kits" },
                { id: "haircare-styling", name: "Hair Care & Styling", icon: Crown, desc: "Dryers, straighteners, styling sprays" }
              ].map((ind) => {
                const Icon = ind.icon;
                return (
                  <button
                    key={ind.id}
                    onClick={() => handleIndustrySelect(ind.id)}
                    className="w-full flex items-center gap-4 p-3.5 border border-border hover:border-accent rounded-xl bg-surface-3/30 hover:bg-accent-bg/10 text-left transition-all"
                  >
                    <div className="p-2.5 rounded-lg bg-surface-3 border border-border-strong text-text-secondary shrink-0">
                      <Icon className="w-4 h-4" />
                    </div>
                    <div>
                      <p className="font-bold text-text-primary">{ind.name}</p>
                      <p className="text-[10px] text-text-muted mt-0.5">{ind.desc}</p>
                    </div>
                    <ChevronRight className="w-4 h-4 ml-auto text-text-muted" />
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* STEP 3: Add first competitor */}
        {step === 3 && (
          <form onSubmit={handleStep3Continue} className="space-y-5 text-xs relative z-10">
            <div className="space-y-2">
              <span className="text-[10px] text-accent font-bold uppercase tracking-widest block">Step 3 of 5</span>
              <h2 className="text-xl font-bold text-text-primary">Add your main competitor</h2>
              <p className="text-text-secondary leading-normal">
                Identify one competitor brand that you want to track. We will pre-populate their profile.
              </p>
            </div>

            <div className="space-y-3">
              <div className="space-y-1.5">
                <label className="font-semibold text-text-primary">Competitor Name *</label>
                <input
                  type="text"
                  value={competitorName}
                  onChange={(e) => setCompetitorName(e.target.value)}
                  placeholder="e.g. BaBylissPRO"
                  className="w-full px-3.5 py-2.5 border border-border rounded-xl bg-surface-1 outline-none text-text-primary placeholder-text-muted focus:border-accent text-xs"
                  required
                />
              </div>

              <div className="space-y-1.5">
                <label className="font-semibold text-text-primary">Website URL</label>
                <input
                  type="text"
                  value={competitorWebsite}
                  onChange={(e) => setCompetitorWebsite(e.target.value)}
                  placeholder="https://example.com"
                  className="w-full px-3.5 py-2.5 border border-border rounded-xl bg-surface-1 outline-none text-text-primary placeholder-text-muted focus:border-accent text-xs"
                />
              </div>
            </div>

            <div className="flex gap-3 pt-2">
              <button
                type="button"
                onClick={() => setStep(2)}
                className="w-1/3 py-2.5 border border-border hover:bg-surface-3 text-text-primary font-bold rounded-xl transition-colors"
              >
                Back
              </button>
              <button
                type="submit"
                className="w-2/3 py-2.5 bg-accent hover:bg-accent-hover text-white font-bold rounded-xl transition-colors flex items-center justify-center gap-1.5 shadow shadow-accent/25"
              >
                <span>Continue</span>
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          </form>
        )}

        {/* STEP 4: Run first analysis */}
        {step === 4 && (
          <form onSubmit={handleFinishOnboarding} className="space-y-5 text-xs relative z-10">
            <div className="space-y-2">
              <span className="text-[10px] text-accent font-bold uppercase tracking-widest block">Step 4 of 5</span>
              <h2 className="text-xl font-bold text-text-primary">Define your offering</h2>
              <p className="text-text-secondary leading-normal">
                Briefly introduce your own product. We&apos;ll run our first comparative analysis instantly.
              </p>
            </div>

            <div className="space-y-3">
              <div className="space-y-1.5">
                <label className="font-semibold text-text-primary">Product Name *</label>
                <input
                  type="text"
                  value={productName}
                  onChange={(e) => setProductName(e.target.value)}
                  placeholder="e.g. Apex Clipper v1"
                  className="w-full px-3.5 py-2.5 border border-border rounded-xl bg-surface-1 outline-none text-text-primary placeholder-text-muted focus:border-accent text-xs"
                  required
                />
              </div>

              <div className="space-y-1.5">
                <label className="font-semibold text-text-primary">Product Description *</label>
                <textarea
                  rows={3}
                  value={productDescription}
                  onChange={(e) => setProductDescription(e.target.value)}
                  placeholder="e.g. Cordless clipper with a brushless motor, titanium blades, and custom bodies."
                  className="w-full px-3.5 py-2.5 border border-border rounded-xl bg-surface-1 outline-none text-text-primary placeholder-text-muted focus:border-accent text-xs resize-none"
                  required
                />
              </div>
            </div>

            <div className="flex gap-3 pt-2">
              <button
                type="button"
                onClick={() => setStep(3)}
                className="w-1/3 py-2.5 border border-border hover:bg-surface-3 text-text-primary font-bold rounded-xl transition-colors"
              >
                Back
              </button>
              <button
                type="submit"
                className="w-2/3 py-2.5 bg-accent hover:bg-accent-hover text-white font-bold rounded-xl transition-colors flex items-center justify-center gap-1.5 shadow shadow-accent/25"
              >
                <span>Run analysis</span>
                <Sparkles className="w-4 h-4 animate-pulse" />
              </button>
            </div>
          </form>
        )}

        {/* STEP 5: Redirect / Success Loading */}
        {step === 5 && (
          <div className="flex flex-col items-center justify-center py-8 text-center text-xs space-y-4 relative z-10">
            <div className="p-4 rounded-full bg-success/10 border border-success/30 text-success animate-bounce">
              <CheckCircle2 className="w-10 h-10" />
            </div>
            
            <div className="space-y-1">
              <h2 className="text-base font-bold text-text-primary">Preparing your workspace...</h2>
              <p className="text-text-secondary max-w-xs leading-normal">
                Setting up databases, seeding indices, and initializing the AI analysis in the background.
              </p>
            </div>
            
            <div className="flex items-center gap-2 text-accent-text font-semibold">
              <Loader2 className="w-4 h-4 animate-spin text-accent" />
              <span>Diverting to overview...</span>
            </div>
          </div>
        )}

      </div>
    </div>
  );
}
