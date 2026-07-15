"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, KeyRound } from "lucide-react";
import { toast } from "sonner";
import { useAuthStore } from "@/stores/authStore";

export default function ChangePasswordPage() {
  const router = useRouter();
  const { fetchSession } = useAuthStore();

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (newPassword !== confirmPassword) {
      toast.error("New password and confirmation don't match");
      return;
    }
    if (newPassword.length < 8) {
      toast.error("New password must be at least 8 characters");
      return;
    }

    setLoading(true);
    try {
      const res = await fetch("/api/auth/change-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to change password");

      toast.success("Password updated");
      await fetchSession();
      router.push("/dashboard");
    } catch (err: any) {
      toast.error(err.message || "Failed to change password");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex items-center justify-center min-h-screen bg-bg text-text-primary px-4">
      <div className="w-full max-w-sm p-6 md:p-8 bg-surface-2 border border-border rounded-2xl shadow-2xl text-xs space-y-6">
        <div className="flex flex-col items-center space-y-2 text-center">
          <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-warning/15 text-warning border border-warning/25">
            <KeyRound className="w-5 h-5" />
          </div>
          <h1 className="text-base font-bold text-text-primary mt-2">Set a new password</h1>
          <p className="text-text-muted leading-normal max-w-xs">
            You&apos;re signed in with a temporary bootstrap password. Choose a new one before continuing.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="space-y-1">
            <label className="font-semibold text-text-primary block">Current password</label>
            <input
              type="password"
              autoComplete="current-password"
              required
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              className="w-full px-3 py-2 border border-border rounded-lg bg-surface-1 text-text-primary outline-none focus:border-accent"
            />
          </div>
          <div className="space-y-1">
            <label className="font-semibold text-text-primary block">New password</label>
            <input
              type="password"
              autoComplete="new-password"
              required
              minLength={8}
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
              minLength={8}
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
      </div>
    </div>
  );
}
