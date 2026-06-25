"use client";

import { SignIn } from "@clerk/nextjs";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Sparkles, Loader2, ArrowRight } from "lucide-react";
import { toast } from "sonner";
import { useAuthStore } from "@/stores/authStore";

const hasClerkKeys =
  typeof window !== "undefined" &&
  !!process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY &&
  process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY !== "pk_..." &&
  process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY !== "";

export default function SignInPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const { fetchSession } = useAuthStore();

  const handleDevBypass = async () => {
    setLoading(true);
    try {
      // Fetch session which auto-seeds the dev database entry
      await fetchSession();
      toast.success("Bypassed sign-in: Authenticated as Developer");
      
      // Check if we need onboarding by checking projects
      const res = await fetch("/api/projects");
      const data = await res.json();
      
      if (data.projects && data.projects.length > 0) {
        router.push("/dashboard");
      } else {
        router.push("/onboarding");
      }
    } catch (e) {
      toast.error("Failed to seed developer workspace");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex items-center justify-center min-h-screen bg-bg text-text-primary px-4">
      {hasClerkKeys ? (
        <SignIn routing="hash" />
      ) : (
        /* Developer Bypass Login Card */
        <div className="w-full max-w-sm p-6 md:p-8 bg-surface-2 border border-border rounded-2xl shadow-2xl relative overflow-hidden text-xs text-center space-y-6">
          <div className="absolute -top-24 -left-24 w-48 h-48 rounded-full bg-accent/15 blur-3xl" />
          
          <div className="flex flex-col items-center space-y-2 relative z-10">
            <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-accent text-white font-bold shadow-md shadow-accent/20">
              <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <circle cx="12" cy="12" r="5" strokeWidth="2.5" />
                <path strokeLinecap="round" strokeWidth="2.5" d="M12 2v2M12 20v2M2 12h2M20 12h2" />
              </svg>
            </div>
            <h1 className="text-xl font-bold tracking-tight text-text-primary mt-3">
              STYLECRAFT <span className="text-accent">LENS</span>
            </h1>
            <p className="text-text-muted leading-normal max-w-xs">
              Know your competition. Own your market. AI-powered competitive intelligence SaaS.
            </p>
          </div>

          <div className="p-3 border border-indigo-900/60 rounded-xl bg-accent-bg/40 text-accent-text text-left leading-relaxed relative z-10">
            <span className="font-bold block mb-1">Developer Mode Bypass</span>
            No Clerk API keys detected in your `.env.local`. Click below to log in instantly with a mock developer workspace.
          </div>

          <button
            onClick={handleDevBypass}
            disabled={loading}
            className="w-full py-2.5 bg-accent hover:bg-accent-hover text-white text-xs font-bold rounded-xl transition-colors flex items-center justify-center gap-1.5 shadow shadow-accent/25 relative z-10 disabled:opacity-50"
          >
            {loading ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <>
                <span>Continue as Developer</span>
                <ArrowRight className="w-4 h-4" />
              </>
            )}
          </button>
        </div>
      )}
    </div>
  );
}
