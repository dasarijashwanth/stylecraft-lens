"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Loader2, KeyRound } from "lucide-react";
import { toast } from "sonner";
import { createSupabaseBrowserClient } from "@/lib/supabase-browser";
import BackgroundStage from "@/components/scroll/BackgroundStage";
import { MIN_PASSWORD_LENGTH } from "@/lib/password-policy";

// Reached only via the emailed recovery link -> /api/auth/callback's code
// exchange, which establishes a real (short-lived, single-use-token-backed)
// session before redirecting here. No session = the link already expired
// or was already used.
export default function ResetPasswordPage() {
  const router = useRouter();
  const [checkingSession, setCheckingSession] = useState(true);
  const [hasSession, setHasSession] = useState(false);
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const supabase = createSupabaseBrowserClient();
    supabase.auth.getUser().then(({ data: { user } }) => {
      setHasSession(!!user);
      setCheckingSession(false);
    });
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (newPassword !== confirmPassword) {
      toast.error("New password and confirmation don't match");
      return;
    }
    if (newPassword.length < MIN_PASSWORD_LENGTH) {
      toast.error(`New password must be at least ${MIN_PASSWORD_LENGTH} characters`);
      return;
    }

    setLoading(true);
    try {
      const supabase = createSupabaseBrowserClient();
      const { error } = await supabase.auth.updateUser({ password: newPassword });
      if (error) throw error;

      toast.success("Password updated — you're signed in");
      router.push("/dashboard");
    } catch (err: any) {
      toast.error(err.message || "Failed to reset password");
    } finally {
      setLoading(false);
    }
  }

  if (checkingSession) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-bg">
        <Loader2 className="w-6 h-6 animate-spin text-accent" />
      </div>
    );
  }

  return (
    <div className="relative flex items-center justify-center min-h-screen bg-bg text-text-primary px-4 overflow-hidden">
      <BackgroundStage />
      <div className="relative z-[1] w-full max-w-sm p-6 md:p-8 bg-surface-2 border border-border rounded-2xl shadow-2xl text-xs space-y-6">
        <div className="flex flex-col items-center space-y-2 text-center">
          <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-accent/15 text-accent border border-accent/25">
            <KeyRound className="w-5 h-5" />
          </div>
          <h1 className="text-base font-bold text-text-primary mt-2">Reset your password</h1>
        </div>

        {!hasSession ? (
          <div className="text-center space-y-3">
            <p className="text-text-muted leading-normal">This reset link has expired or was already used.</p>
            <Link href="/forgot-password" className="text-accent hover:underline">Request a new link</Link>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-3">
            <div className="space-y-1">
              <label className="font-semibold text-text-primary block">New password</label>
              <input
                type="password"
                autoComplete="new-password"
                required
                minLength={MIN_PASSWORD_LENGTH}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                className="w-full px-3 py-2 border border-border rounded-lg bg-surface-1 text-text-primary outline-none focus:border-accent"
              />
            </div>
            <div className="space-y-1">
              <label className="font-semibold text-text-primary block">Confirm new password</label>
              <input
                type="password"
                autoComplete="new-password"
                required
                minLength={MIN_PASSWORD_LENGTH}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className="w-full px-3 py-2 border border-border rounded-lg bg-surface-1 text-text-primary outline-none focus:border-accent"
              />
            </div>
            <button
              type="submit"
              disabled={loading}
              className="w-full py-2.5 bg-accent hover:bg-accent-hover text-white text-xs font-bold rounded-xl transition-colors flex items-center justify-center gap-1.5 shadow shadow-accent/25 disabled:opacity-50"
            >
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <span>Set new password</span>}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
