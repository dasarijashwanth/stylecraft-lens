"use client";

import { useState } from "react";
import Link from "next/link";
import { Loader2, Mail, ArrowLeft } from "lucide-react";
import { Logo, Wordmark } from "@/components/ui/Logo";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim()) return;

    setLoading(true);
    try {
      // Goes through our own server route (see app/api/auth/forgot-password)
      // so requests can be rate-limited against email-bombing a victim's
      // inbox — it always responds ok:true regardless of outcome.
      await fetch("/api/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim() }),
      });
    } catch {
      // Fall through to the generic confirmation regardless — never reveal
      // whether the address is registered (user enumeration).
    } finally {
      // Always show the same confirmation, whether or not the email
      // exists — Supabase's own API already behaves this way; this
      // preserves that at the UI layer too.
      setSubmitted(true);
      setLoading(false);
    }
  }

  return (
    <div className="flex items-center justify-center min-h-screen bg-bg text-text-primary px-4">
      <div className="w-full max-w-sm p-6 md:p-8 bg-surface-2 border border-border rounded-2xl shadow-2xl relative overflow-hidden text-xs space-y-6">
        <div className="absolute -top-24 -left-24 w-48 h-48 rounded-full bg-accent/15 blur-3xl" />

        <div className="flex flex-col items-center space-y-2 relative z-10 text-center">
          <Logo size="md" />
          <Wordmark className="text-xl text-text-primary mt-3" />
        </div>

        {submitted ? (
          <div className="relative z-10 text-center space-y-4">
            <div className="flex items-center justify-center w-10 h-10 mx-auto rounded-xl bg-accent/15 text-accent border border-accent/25">
              <Mail className="w-5 h-5" />
            </div>
            <p className="text-text-secondary leading-normal">
              If an account exists for <strong>{email.trim()}</strong>, we&apos;ve sent a password reset link. It expires shortly and can only be used once.
            </p>
            <Link href="/sign-in" className="inline-flex items-center gap-1 text-accent hover:underline">
              <ArrowLeft className="w-3 h-3" /> Back to sign in
            </Link>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-3 relative z-10">
            <p className="text-text-muted leading-normal text-center">
              Enter your email and we&apos;ll send you a link to reset your password.
            </p>
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
            <button
              type="submit"
              disabled={loading}
              className="w-full py-2.5 bg-accent hover:bg-accent-hover text-white text-xs font-bold rounded-xl transition-colors flex items-center justify-center gap-1.5 shadow shadow-accent/25 disabled:opacity-50"
            >
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <span>Send reset link</span>}
            </button>
            <Link href="/sign-in" className="flex items-center justify-center gap-1 text-text-muted hover:text-text-primary">
              <ArrowLeft className="w-3 h-3" /> Back to sign in
            </Link>
          </form>
        )}
      </div>
    </div>
  );
}
