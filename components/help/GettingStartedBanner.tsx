"use client";

import { useState } from "react";
import { Sparkles, X } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { faqCategoryHref } from "@/lib/faq-slugs";

// First-login "New here?" banner (see lib/auth.ts's UserSession.faqBannerDismissedAt
// — null means never dismissed). Dismissing is optimistic: hides immediately
// and persists in the background so it never reappears on another
// device/session once the write lands.
export default function GettingStartedBanner() {
  const { user, refreshSession } = useAuth();
  const [dismissed, setDismissed] = useState(false);

  if (!user || user.faqBannerDismissedAt !== null || dismissed) return null;

  async function handleDismiss() {
    setDismissed(true);
    try {
      await fetch("/api/user/dismiss-faq-banner", { method: "POST" });
      refreshSession();
    } catch {
      // Best-effort — worst case the banner reappears on next session, not fatal.
    }
  }

  return (
    <div className="flex items-center gap-3 px-4 py-3 bg-accent/10 border border-accent/25 rounded-xl text-xs">
      <Sparkles className="w-4 h-4 text-accent shrink-0" />
      <p className="flex-1 text-text-primary">
        New here?{" "}
        <a href={faqCategoryHref("Getting Started")} className="font-bold text-accent hover:underline">
          Read the Getting Started FAQ
        </a>
      </p>
      <button
        type="button"
        onClick={handleDismiss}
        className="p-1 text-text-muted hover:text-text-primary transition-colors shrink-0"
        title="Dismiss"
      >
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}
