"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { X, Paperclip, Loader2, CheckCircle2, RefreshCw } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { Modal } from "@/components/ui/Modal";
import type { ContactSupportContext } from "./ContactSupportProvider";

const DRAFT_KEY = "lens-support-draft-v1";
const MAX_SCREENSHOT_BYTES = 5 * 1024 * 1024;
const TOPICS = [
  { value: "bug", label: "Bug/Issue" },
  { value: "question", label: "Question" },
  { value: "data_wrong", label: "Data looks wrong" },
  { value: "feature_request", label: "Feature request" },
  { value: "other", label: "Other" },
];

interface Draft {
  email: string;
  topic: string;
  message: string;
}

function loadDraft(): Draft | null {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function saveDraft(draft: Draft) {
  try {
    localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
  } catch {}
}

function clearDraft() {
  try {
    localStorage.removeItem(DRAFT_KEY);
  } catch {}
}

interface ContactSupportModalProps {
  isOpen: boolean;
  onClose: () => void;
  prefillTopic?: string;
  prefillMessage?: string;
  extraContext?: ContactSupportContext;
}

export default function ContactSupportModal({ isOpen, onClose, prefillTopic, prefillMessage, extraContext }: ContactSupportModalProps) {
  const { user } = useAuth();
  const pathname = usePathname();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [email, setEmail] = useState("");
  const [topic, setTopic] = useState("question");
  const [message, setMessage] = useState("");
  const [screenshotFile, setScreenshotFile] = useState<File | null>(null);
  const [screenshotError, setScreenshotError] = useState<string | null>(null);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successEmail, setSuccessEmail] = useState<string | null>(null);

  // Re-hydrate from a preserved draft (a previous failed submit) or the
  // caller's prefill (e.g. the FAQ downvote flow) each time the modal opens
  // — never silently discard a typed-but-unsent message.
  useEffect(() => {
    if (!isOpen) return;
    setError(null);
    setSuccessEmail(null);
    setScreenshotFile(null);
    setScreenshotError(null);

    const draft = loadDraft();
    setEmail(draft?.email || user?.email || "");
    setTopic(draft?.topic || prefillTopic || "question");
    setMessage(draft?.message || prefillMessage || "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen || successEmail) return;
    saveDraft({ email, topic, message });
  }, [isOpen, successEmail, email, topic, message]);

  function handleScreenshotChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (!["image/png", "image/jpeg"].includes(file.type)) {
      setScreenshotError("Only PNG or JPG images are supported");
      return;
    }
    if (file.size > MAX_SCREENSHOT_BYTES) {
      setScreenshotError("Screenshot must be 5MB or smaller");
      return;
    }
    setScreenshotError(null);
    setScreenshotFile(file);
  }

  async function uploadScreenshot(): Promise<string | null> {
    if (!screenshotFile) return null;
    const urlRes = await fetch("/api/support/screenshot-upload-url", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fileName: screenshotFile.name, fileSize: screenshotFile.size, contentType: screenshotFile.type }),
    });
    const urlData = await urlRes.json();
    if (!urlRes.ok) throw new Error(urlData.error || "Failed to prepare screenshot upload");
    if (urlData.mode !== "signed") return null; // dev fallback with no Storage — screenshot silently skipped

    const { createSupabaseBrowserClient } = await import("@/lib/supabase-browser");
    const supabase = createSupabaseBrowserClient();
    const { error: uploadError } = await supabase.storage
      .from("support-screenshots")
      .uploadToSignedUrl(urlData.path, urlData.token, screenshotFile);
    if (uploadError) throw new Error(uploadError.message || "Screenshot upload failed");

    return urlData.path as string;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (message.trim().length < 10) {
      setError("Message must be at least 10 characters");
      return;
    }
    setSubmitting(true);
    setError(null);

    try {
      const screenshotPath = await uploadScreenshot();

      const context = {
        page: pathname,
        tab: extraContext?.tab,
        projectId: extraContext?.projectId,
        productName: extraContext?.productName,
        appVersion: process.env.NEXT_PUBLIC_APP_VERSION,
        browser: typeof navigator !== "undefined" ? navigator.userAgent : undefined,
      };

      const res = await fetch("/api/support/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, topic, message: message.trim(), screenshotPath, context }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to send message");

      clearDraft();
      setSuccessEmail(email);
    } catch (err: any) {
      setError(err.message || "Failed to send message — your message is still here, try again.");
    } finally {
      setSubmitting(false);
    }
  }

  function handleClose() {
    setScreenshotFile(null);
    setScreenshotError(null);
    onClose();
  }

  const includesNote = [
    "current page",
    extraContext?.projectId ? "project" : null,
  ].filter(Boolean).join(", ");

  return (
    <Modal isOpen={isOpen} onClose={handleClose} placement="right" size="md">
      <div className="flex items-center justify-between p-4 md:p-6 border-b border-border bg-surface-3/30">
        <div>
          <h2 className="text-base font-bold text-text-primary">Contact support</h2>
          <p className="text-[11px] text-text-muted mt-1 leading-normal">We reply directly to your email.</p>
        </div>
        <button onClick={handleClose} className="p-1 rounded-lg hover:bg-surface-3 text-text-secondary transition-colors">
          <X className="w-5 h-5" />
        </button>
      </div>

      {successEmail ? (
        <div className="flex-1 flex flex-col items-center justify-center text-center p-8 gap-3">
          <CheckCircle2 className="w-10 h-10 text-success" />
          <p className="text-sm font-bold text-text-primary">Message sent</p>
          <p className="text-xs text-text-muted">We&apos;ll reply to {successEmail}.</p>
          <button
            onClick={handleClose}
            className="mt-2 px-4 py-2 bg-accent hover:bg-accent-hover text-white text-xs font-bold rounded-lg transition-colors"
          >
            Close
          </button>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-4 md:p-6 space-y-4">
          {error && (
            <div className="p-3 text-xs border border-danger/20 rounded-lg bg-danger-bg text-danger flex items-center justify-between gap-2">
              <span>{error}</span>
              <button type="submit" className="flex items-center gap-1 font-bold shrink-0">
                <RefreshCw className="w-3 h-3" /> Retry
              </button>
            </div>
          )}

          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-text-primary block">Name</label>
            <div className="px-2.5 py-1.5 text-xs border border-border rounded-lg bg-surface-3/40 text-text-muted">
              {user?.name || "—"}
            </div>
          </div>

          <div className="space-y-1.5">
            <label htmlFor="support-email" className="text-xs font-semibold text-text-primary block">Email</label>
            <input
              id="support-email"
              type="email"
              required
              value={email}
              onChange={e => setEmail(e.target.value)}
              className="w-full px-2.5 py-1.5 text-xs border border-border rounded-lg bg-surface-1 text-text-primary outline-none focus:border-accent"
            />
          </div>

          <div className="space-y-1.5">
            <label htmlFor="support-topic" className="text-xs font-semibold text-text-primary block">Topic</label>
            <select
              id="support-topic"
              value={topic}
              onChange={e => setTopic(e.target.value)}
              className="w-full px-2.5 py-1.5 text-xs border border-border rounded-lg bg-surface-1 text-text-primary outline-none focus:border-accent"
            >
              {TOPICS.map(t => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label htmlFor="support-message" className="text-xs font-semibold text-text-primary block">Message</label>
              <span className={`text-[10px] ${message.length > 2000 ? "text-danger" : "text-text-muted"}`}>{message.length}/2000</span>
            </div>
            <textarea
              id="support-message"
              required
              minLength={10}
              maxLength={2000}
              rows={6}
              value={message}
              onChange={e => setMessage(e.target.value)}
              placeholder="What's going on? The more detail, the faster we can help."
              className="w-full px-2.5 py-1.5 text-xs border border-border rounded-lg bg-surface-1 text-text-primary outline-none focus:border-accent resize-y"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-text-primary block">Attach screenshot (optional)</label>
            <input ref={fileInputRef} type="file" accept="image/png,image/jpeg" className="hidden" onChange={handleScreenshotChange} />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="flex items-center gap-1.5 px-2.5 py-1.5 border border-border rounded-lg text-xs text-text-secondary hover:text-text-primary hover:bg-surface-3/50 transition-colors"
            >
              <Paperclip className="w-3.5 h-3.5" />
              {screenshotFile ? screenshotFile.name : "Choose PNG or JPG (max 5MB)"}
            </button>
            {screenshotError && <p className="text-[10px] text-danger">{screenshotError}</p>}
          </div>

          <p className="text-[10px] text-text-muted">Includes: {includesNote || "current page"}, app version, browser.</p>

          <button
            type="submit"
            disabled={submitting || message.trim().length < 10}
            className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-accent hover:bg-accent-hover text-white text-xs font-bold rounded-lg disabled:opacity-50 transition-colors shadow"
          >
            {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
            {submitting ? "Sending…" : "Send message"}
          </button>
        </form>
      )}
    </Modal>
  );
}
