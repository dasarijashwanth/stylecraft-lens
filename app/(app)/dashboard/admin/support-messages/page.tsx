"use client";

import { useEffect, useMemo, useState } from "react";
import { ShieldAlert, Search, ChevronDown, ChevronUp, RefreshCw, Loader2, ExternalLink } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/hooks/useAuth";
import { Spinner } from "@/components/ui/Spinner";

interface SupportMessage {
  id: string;
  user_id: string;
  name: string;
  email: string;
  topic: string;
  message: string;
  context: Record<string, any> | null;
  screenshot_url: string | null;
  email_status: "pending" | "sent" | "failed";
  email_error: string | null;
  ack_email_status: "pending" | "sent" | "failed";
  admin_notification_read: boolean;
  created_at: string;
}

const TOPIC_LABELS: Record<string, string> = {
  bug: "Bug/Issue",
  question: "Question",
  data_wrong: "Data looks wrong",
  feature_request: "Feature request",
  other: "Other",
};

const STATUS_STYLES: Record<string, string> = {
  sent: "border-success/30 text-success bg-success/10",
  failed: "border-danger/30 text-danger bg-danger/10",
  pending: "border-border text-text-muted",
};

export default function SupportMessagesAdminPage() {
  const { user, loading: authLoading } = useAuth();
  const [messages, setMessages] = useState<SupportMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [resendingId, setResendingId] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/support-messages");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to load support messages");
      setMessages(data.messages || []);

      // Viewing the list is the acknowledgement for the Topbar's unread
      // "new support message" notification — best-effort, doesn't block render.
      (data.messages || [])
        .filter((m: SupportMessage) => !m.admin_notification_read)
        .forEach((m: SupportMessage) => {
          fetch(`/api/admin/support-messages/${m.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ adminNotificationRead: true }),
          }).catch(() => {});
        });
    } catch (err: any) {
      setError(err.message || "Failed to load support messages");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (user && (user.role === "OWNER" || user.role === "ADMIN")) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  async function handleResend(id: string) {
    setResendingId(id);
    try {
      const res = await fetch(`/api/admin/support-messages/${id}/resend-email`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to resend email");
      if (data.emailStatus === "sent") toast.success("Email sent");
      else toast.error(data.error || "Email still failing");
      await load();
    } catch (err: any) {
      toast.error(err.message || "Failed to resend email");
    } finally {
      setResendingId(null);
    }
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return messages;
    return messages.filter(m =>
      m.name.toLowerCase().includes(q) ||
      m.email.toLowerCase().includes(q) ||
      m.message.toLowerCase().includes(q) ||
      (TOPIC_LABELS[m.topic] || m.topic).toLowerCase().includes(q)
    );
  }, [messages, search]);

  if (authLoading) {
    return (
      <div className="flex items-center justify-center min-h-[300px]">
        <Spinner size="lg" className="text-accent" />
      </div>
    );
  }

  if (!user || (user.role !== "OWNER" && user.role !== "ADMIN")) {
    return (
      <div className="max-w-md mx-auto mt-16 text-center space-y-3">
        <ShieldAlert className="w-8 h-8 mx-auto text-text-muted" />
        <h1 className="text-sm font-bold text-text-primary">Not authorized</h1>
        <p className="text-xs text-text-muted">This page is restricted to workspace owners/admins.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <ShieldAlert className="w-5 h-5 text-accent" />
        <h1 className="text-display">Support Messages</h1>
      </div>
      <p className="text-xs text-text-muted -mt-4">
        Every Contact Support submission, regardless of email delivery outcome — a backup channel in case an email is ever missed. Failed sends can be retried below.
      </p>

      <div className="relative max-w-sm">
        <Search className="w-3.5 h-3.5 text-text-muted absolute left-3 top-1/2 -translate-y-1/2" />
        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search name, email, topic, message…"
          className="w-full pl-8 pr-3 py-2 text-xs border border-border rounded-lg bg-surface-1 text-text-primary outline-none focus:border-accent"
        />
      </div>

      {loading ? (
        <div className="p-8 text-center text-text-muted text-xs">Loading…</div>
      ) : error ? (
        <div className="p-8 text-center text-danger text-xs">{error}</div>
      ) : filtered.length === 0 ? (
        <div className="p-8 text-center text-text-muted text-xs">No support messages yet.</div>
      ) : (
        <div className="border border-border rounded-xl overflow-hidden">
          <div className="grid grid-cols-[110px_1fr_140px_110px_90px] gap-3 px-4 py-2.5 bg-surface-3/30 border-b border-border text-[10px] font-bold text-text-muted uppercase tracking-wider">
            <span>Created</span>
            <span>From / Message</span>
            <span>Topic</span>
            <span>Email</span>
            <span></span>
          </div>
          <div className="divide-y divide-border/60">
            {filtered.map(m => {
              const isExpanded = expandedId === m.id;
              return (
                <div key={m.id}>
                  <button
                    type="button"
                    onClick={() => setExpandedId(isExpanded ? null : m.id)}
                    className={`w-full grid grid-cols-[110px_1fr_140px_110px_90px] gap-3 px-4 py-3 text-left text-xs items-center hover:bg-surface-3/20 transition-colors ${!m.admin_notification_read ? "bg-accent/5" : ""}`}
                  >
                    <span className="text-[10px] text-text-muted">{new Date(m.created_at).toLocaleDateString()}</span>
                    <span className="min-w-0 truncate">
                      <span className="font-semibold text-text-primary">{m.name}</span>
                      <span className="text-text-muted"> — {m.message}</span>
                    </span>
                    <span className="text-[11px] text-text-secondary truncate">{TOPIC_LABELS[m.topic] || m.topic}</span>
                    <span className={`inline-flex w-fit px-2 py-0.5 rounded text-[10px] font-bold border ${STATUS_STYLES[m.email_status]}`}>
                      {m.email_status}
                    </span>
                    {isExpanded ? <ChevronUp className="w-3.5 h-3.5 text-text-muted justify-self-end" /> : <ChevronDown className="w-3.5 h-3.5 text-text-muted justify-self-end" />}
                  </button>

                  {isExpanded && (
                    <div className="px-4 pb-4 space-y-3 bg-surface-3/10">
                      <p className="text-xs text-text-secondary whitespace-pre-wrap">{m.message}</p>
                      <div className="text-[10px] text-text-muted space-y-0.5">
                        <p>From: {m.name} &lt;{m.email}&gt;</p>
                        {m.context?.page && <p>Page: {m.context.page}</p>}
                        {m.context?.tab && <p>Tab: {m.context.tab}</p>}
                        {m.context?.projectId && <p>Project: {m.context.productName ? `${m.context.productName} (${m.context.projectId})` : m.context.projectId}</p>}
                        {m.context?.appVersion && <p>App version: {m.context.appVersion}</p>}
                        {m.context?.browser && <p className="truncate">Browser: {m.context.browser}</p>}
                        <p>Ack email to submitter: {m.ack_email_status}</p>
                        {m.email_error && <p className="text-danger">Error: {m.email_error}</p>}
                      </div>
                      {m.screenshot_url && (
                        <a href={m.screenshot_url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-[10px] text-accent hover:underline">
                          <ExternalLink className="w-3 h-3" /> View screenshot
                        </a>
                      )}
                      {m.email_status === "failed" && (
                        <button
                          type="button"
                          onClick={() => handleResend(m.id)}
                          disabled={resendingId === m.id}
                          className="flex items-center gap-1.5 px-2.5 py-1.5 bg-accent hover:bg-accent-hover text-white text-[11px] font-bold rounded-lg transition-colors"
                        >
                          {resendingId === m.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
                          Resend email
                        </button>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
