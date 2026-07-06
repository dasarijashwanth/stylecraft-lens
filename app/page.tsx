"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Sparkles, Target, FolderOpen, FileText, ArrowRight, ShieldCheck } from "lucide-react";
import { useEffect, useState } from "react";
import { useAuthStore } from "@/stores/authStore";

export default function LandingPage() {
  const router = useRouter();
  const { fetchSession, user } = useAuthStore();
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    fetchSession().finally(() => {
      setChecking(false);
    });
  }, [fetchSession]);

  return (
    <div className="min-h-screen bg-bg text-text-primary flex flex-col justify-between">
      {/* Header / Navbar */}
      <header className="max-w-6xl w-full mx-auto px-6 py-4 flex items-center justify-between border-b border-border/40">
        <div className="flex items-center gap-2">
          <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-accent text-white font-bold shadow shadow-accent/20">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <circle cx="12" cy="12" r="5" strokeWidth="2.5" />
              <path strokeLinecap="round" strokeWidth="2.5" d="M12 2v2M12 20v2M2 12h2M20 12h2" />
            </svg>
          </div>
          <div className="flex items-center text-sm font-black tracking-wider leading-none">
            <span>STYLECRAFT</span>
            <span className="text-accent ml-1">LENS</span>
          </div>
        </div>

        <div>
          {checking ? (
            <div className="w-4 h-4 border border-accent border-t-transparent rounded-full animate-spin" />
          ) : user ? (
            <Link
              href="/dashboard"
              className="text-xs font-bold text-accent-text hover:text-accent flex items-center gap-1 transition-colors"
            >
              <span>Go to Dashboard</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </Link>
          ) : (
            <Link
              href="/sign-in"
              className="px-4 py-2 rounded-lg bg-surface-3 hover:bg-surface-2/80 text-xs font-bold transition-all"
            >
              Sign In
            </Link>
          )}
        </div>
      </header>

      {/* Hero Section */}
      <main className="max-w-4xl w-full mx-auto px-6 py-12 md:py-20 text-center space-y-8 relative">
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-72 h-72 rounded-full bg-accent/10 blur-3xl -z-10" />

        <div className="space-y-4">
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-accent-bg border border-accent-border/40 text-accent-text animate-pulse-soft">
            <Sparkles className="w-3 h-3 text-accent" />
            <span>AI-Powered Competitive Intelligence</span>
          </span>
          <h1 className="text-4xl md:text-5xl font-black tracking-tight text-text-primary leading-tight font-display max-w-2xl mx-auto">
            Know your competition. <br />
            <span className="text-accent">Own your market.</span>
          </h1>
          <p className="text-sm md:text-base text-text-secondary leading-relaxed max-w-xl mx-auto">
            Surface AI-generated competitor insights, trend analyses, and strategic recommendations in one sleek dashboard — replacing hours of manual research for creative and grooming brands.
          </p>
        </div>

        <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
          <Link
            href="/sign-in"
            className="w-full sm:w-auto px-6 py-3 bg-accent hover:bg-accent-hover text-white text-xs font-bold rounded-xl transition-all shadow shadow-accent/30 flex items-center justify-center gap-2"
          >
            <span>Start Tracking the Market</span>
            <ArrowRight className="w-4 h-4" />
          </Link>
          
          <a
            href="#features"
            className="w-full sm:w-auto px-6 py-3 border border-border bg-surface-2 hover:bg-surface-3 text-text-primary text-xs font-bold rounded-xl transition-colors text-center"
          >
            Learn More
          </a>
        </div>
      </main>

      {/* Feature Grid */}
      <section id="features" className="max-w-5xl w-full mx-auto px-6 py-12 border-t border-border/40 space-y-8">
        <h2 className="text-sm font-bold text-text-muted uppercase tracking-wider text-center">Engine Features</h2>
        
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="p-5 rounded-xl border border-border bg-surface-2/40 space-y-2.5">
            <div className="w-8 h-8 rounded-lg bg-emerald-950/50 border border-emerald-900/50 text-emerald-400 flex items-center justify-center">
              <Target className="w-4 h-4" />
            </div>
            <h3 className="text-sm font-bold text-text-primary">Competitor Auditing</h3>
            <p className="text-xs text-text-secondary leading-relaxed">
              Track brand listings, fetch favicons automatically, tag categories, and score threat momentum.
            </p>
          </div>

          <div className="p-5 rounded-xl border border-border bg-surface-2/40 space-y-2.5">
            <div className="w-8 h-8 rounded-lg bg-indigo-950/50 border border-indigo-900/50 text-indigo-400 flex items-center justify-center">
              <Sparkles className="w-4 h-4" />
            </div>
            <h3 className="text-sm font-bold text-text-primary">3-Phase AI Analyses</h3>
            <p className="text-xs text-text-secondary leading-relaxed">
              Activate Gemini with real-time Google Search grounding to discover emerging challenger threats and evaluate price points.
            </p>
          </div>

          <div className="p-5 rounded-xl border border-border bg-surface-2/40 space-y-2.5">
            <div className="w-8 h-8 rounded-lg bg-amber-950/50 border border-amber-900/50 text-amber-400 flex items-center justify-center">
              <FileText className="w-4 h-4" />
            </div>
            <h3 className="text-sm font-bold text-text-primary">TipTap Report Editor</h3>
            <p className="text-xs text-text-secondary leading-relaxed">
              Save findings as reports, rewrite text selections using the built-in AI toolbar, and export clean PDFs.
            </p>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="max-w-6xl w-full mx-auto px-6 py-6 border-t border-border/40 text-center text-[10px] text-text-muted">
        <p>© 2026 Stylecraft Professional. All rights reserved.</p>
        <p className="mt-1">Stylecraft Lens is configured for competitive intelligence research workflows.</p>
      </footer>
    </div>
  );
}
