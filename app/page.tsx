"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Sparkles, Target, FileText, ArrowRight } from "lucide-react";
import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { useAuthStore } from "@/stores/authStore";
import { Spinner } from "@/components/ui/Spinner";
import { Logo, Wordmark } from "@/components/ui/Logo";

// Matches this codebase's existing framer-motion vocabulary (Modal.tsx,
// ProgressPanel.tsx): tween transitions with a custom ease-out-expo curve,
// no springs.
const EASE_OUT_EXPO = [0.16, 1, 0.3, 1] as const;

const fadeUp = {
  hidden: { opacity: 0, y: 16 },
  show: { opacity: 1, y: 0 },
};

const staggerContainer = {
  hidden: {},
  show: {
    transition: { staggerChildren: 0.12, delayChildren: 0.05 },
  },
};

const FEATURES = [
  {
    icon: Target,
    tone: "bg-emerald-950/50 border-emerald-900/50 text-emerald-400",
    title: "Competitor Auditing",
    body: "Track brand listings, fetch favicons automatically, tag categories, and score threat momentum.",
  },
  {
    icon: Sparkles,
    tone: "bg-indigo-950/50 border-indigo-900/50 text-indigo-400",
    title: "3-Phase AI Analyses",
    body: "Activate Gemini with real-time Google Search grounding to discover emerging challenger threats and evaluate price points.",
  },
  {
    icon: FileText,
    tone: "bg-amber-950/50 border-amber-900/50 text-amber-400",
    title: "TipTap Report Editor",
    body: "Save findings as reports, rewrite text selections using the built-in AI toolbar, and export clean PDFs.",
  },
];

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
    <div className="min-h-screen bg-bg text-text-primary flex flex-col justify-between overflow-hidden">
      {/* Header / Navbar */}
      <motion.header
        initial={{ opacity: 0, y: -12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: EASE_OUT_EXPO }}
        className="max-w-6xl w-full mx-auto px-6 py-4 flex items-center justify-between border-b border-border/40 relative z-10"
      >
        <div className="flex items-center gap-2.5">
          <Logo size="sm" />
          <Wordmark className="text-sm" />
        </div>

        <div>
          {checking ? (
            <Spinner size="sm" className="text-accent" />
          ) : user ? (
            <Link
              href="/dashboard"
              className="cursor-target text-xs font-bold text-accent-text hover:text-accent flex items-center gap-1 transition-colors"
            >
              <span>Go to Dashboard</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </Link>
          ) : (
            <Link
              href="/sign-in"
              className="cursor-target px-4 py-2 rounded-lg bg-surface-3 hover:bg-surface-2/80 text-xs font-bold transition-all"
            >
              Sign In
            </Link>
          )}
        </div>
      </motion.header>

      {/* Hero Section */}
      <main className="max-w-4xl w-full mx-auto px-6 py-12 md:py-16 text-center space-y-9 relative">
        {/* Ambient animated background — faint dot grid + drifting gradient orbs */}
        <div className="absolute inset-0 -z-10 bg-dot-grid" />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[28rem] h-[28rem] rounded-full bg-accent/10 blur-3xl -z-10 animate-float-slow" />
        <div className="absolute top-[15%] left-[15%] w-56 h-56 rounded-full bg-emerald-500/10 blur-3xl -z-10 animate-float-slow-reverse" />
        <div className="absolute bottom-[5%] right-[10%] w-64 h-64 rounded-full bg-amber-500/10 blur-3xl -z-10 animate-float-slow" />

        {/* Big animated brand mark */}
        <motion.div
          initial={{ opacity: 0, scale: 0.7 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.6, ease: EASE_OUT_EXPO }}
          className="flex justify-center"
        >
          <div className="relative">
            <div className="absolute inset-0 rounded-[28px] bg-accent/40 blur-2xl animate-glow-breathe -z-10" />
            <Logo size="xl" />
          </div>
        </motion.div>

        <motion.div variants={staggerContainer} initial="hidden" animate="show" className="space-y-4">
          <motion.span
            variants={fadeUp}
            transition={{ duration: 0.5, ease: EASE_OUT_EXPO }}
            className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-accent-bg border border-accent-border/40 text-accent-text animate-pulse-soft"
          >
            <Sparkles className="w-3 h-3 text-accent" />
            <span>AI-Powered Competitive Intelligence</span>
          </motion.span>
          <motion.h1
            variants={fadeUp}
            transition={{ duration: 0.55, ease: EASE_OUT_EXPO }}
            className="text-4xl md:text-6xl font-black tracking-tight text-text-primary leading-tight font-display max-w-2xl mx-auto"
          >
            Know your competition. <br />
            <span className="text-accent">Own your market.</span>
          </motion.h1>
          <motion.p
            variants={fadeUp}
            transition={{ duration: 0.55, ease: EASE_OUT_EXPO }}
            className="text-sm md:text-base text-text-secondary leading-relaxed max-w-xl mx-auto"
          >
            Surface AI-generated competitor insights, trend analyses, and strategic recommendations in one sleek dashboard — replacing hours of manual research for creative and grooming brands.
          </motion.p>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.45, ease: EASE_OUT_EXPO }}
          className="flex flex-col sm:flex-row items-center justify-center gap-3"
        >
          <Link
            href="/sign-in"
            className="cursor-target w-full sm:w-auto px-6 py-3 bg-accent hover:bg-accent-hover text-white text-xs font-bold rounded-xl transition-all shadow shadow-accent/30 flex items-center justify-center gap-2 hover:-translate-y-0.5 hover:shadow-lg hover:shadow-accent/40"
          >
            <span>Start Tracking the Market</span>
            <ArrowRight className="w-4 h-4" />
          </Link>

          <a
            href="#features"
            className="cursor-target w-full sm:w-auto px-6 py-3 border border-border bg-surface-2 hover:bg-surface-3 text-text-primary text-xs font-bold rounded-xl transition-all text-center hover:-translate-y-0.5"
          >
            Learn More
          </a>
        </motion.div>
      </main>

      {/* Feature Grid */}
      <section id="features" className="max-w-5xl w-full mx-auto px-6 py-12 border-t border-border/40 space-y-8 relative z-10">
        <motion.h2
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: true, margin: "-80px" }}
          transition={{ duration: 0.4 }}
          className="text-sm font-bold text-text-muted uppercase tracking-wider text-center"
        >
          Engine Features
        </motion.h2>

        <motion.div
          variants={staggerContainer}
          initial="hidden"
          whileInView="show"
          viewport={{ once: true, margin: "-80px" }}
          className="grid grid-cols-1 md:grid-cols-3 gap-4"
        >
          {FEATURES.map((f) => {
            const Icon = f.icon;
            return (
              <motion.div
                key={f.title}
                variants={fadeUp}
                transition={{ duration: 0.45, ease: EASE_OUT_EXPO }}
                whileHover={{ y: -4 }}
                className="cursor-target p-5 rounded-xl border border-border bg-surface-2/40 space-y-2.5 transition-colors hover:border-accent-border/50 hover:bg-surface-2/70"
              >
                <div className={`w-8 h-8 rounded-lg border flex items-center justify-center ${f.tone}`}>
                  <Icon className="w-4 h-4" />
                </div>
                <h3 className="text-sm font-bold text-text-primary">{f.title}</h3>
                <p className="text-xs text-text-secondary leading-relaxed">{f.body}</p>
              </motion.div>
            );
          })}
        </motion.div>
      </section>

      {/* Footer */}
      <footer className="max-w-6xl w-full mx-auto px-6 py-6 border-t border-border/40 text-center text-[10px] text-text-muted relative z-10">
        <p>© 2026 Stylecraft Professional. All rights reserved.</p>
        <p className="mt-1">Stylecraft Lens is configured for competitive intelligence research workflows.</p>
      </footer>
    </div>
  );
}
