"use client";

import { Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { Loader2, ArrowRight } from "lucide-react";
import { toast } from "sonner";
import { createSupabaseBrowserClient } from "@/lib/supabase-browser";
import { useAuthStore } from "@/stores/authStore";

function SignInForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { fetchSession } = useAuthStore();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim() || !password) return;

    setLoading(true);
    try {
      const supabase = createSupabaseBrowserClient();
      const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
      if (error) {
        // Don't leak which field was wrong.
        toast.error("Incorrect email or password");
        return;
      }

      await fetchSession();
      const redirect = searchParams.get("redirect") || "/dashboard";
      router.push(redirect);
    } catch (err) {
      toast.error("Failed to sign in — try again");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="w-full max-w-sm p-6 md:p-8 bg-surface-2 border border-border rounded-2xl shadow-2xl relative overflow-hidden text-xs space-y-6">
      <div className="absolute -top-24 -left-24 w-48 h-48 rounded-full bg-accent/15 blur-3xl" />

      <div className="flex flex-col items-center space-y-2 relative z-10 text-center">
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

      <form onSubmit={handleSubmit} className="space-y-3 relative z-10">
        <div className="space-y-1">
          <label className="font-semibold text-text-primary block">Email</label>
          <input
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@company.com"
            className="w-full px-3 py-2 border border-border rounded-lg bg-surface-1 text-text-primary outline-none focus:border-accent placeholder-text-muted"
          />
        </div>
        <div className="space-y-1">
          <label className="font-semibold text-text-primary block">Password</label>
          <input
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
            className="w-full px-3 py-2 border border-border rounded-lg bg-surface-1 text-text-primary outline-none focus:border-accent placeholder-text-muted"
          />
        </div>

        <button
          type="submit"
          disabled={loading}
          className="w-full py-2.5 bg-accent hover:bg-accent-hover text-white text-xs font-bold rounded-xl transition-colors flex items-center justify-center gap-1.5 shadow shadow-accent/25 disabled:opacity-50"
        >
          {loading ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <>
              <span>Sign in</span>
              <ArrowRight className="w-4 h-4" />
            </>
          )}
        </button>
      </form>
    </div>
  );
}

export default function SignInPage() {
  return (
    <div className="flex items-center justify-center min-h-screen bg-bg text-text-primary px-4">
      <Suspense fallback={null}>
        <SignInForm />
      </Suspense>
    </div>
  );
}
