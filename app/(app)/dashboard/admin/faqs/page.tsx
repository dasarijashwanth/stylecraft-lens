"use client";

import { useEffect, useState } from "react";
import { ShieldAlert, Plus, X, Loader2, ArrowUp, ArrowDown, Pencil, BarChart3 } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/hooks/useAuth";
import { Spinner } from "@/components/ui/Spinner";
import { FAQ_CATEGORIES } from "@/lib/faq-seed-data";

interface Faq {
  id: string;
  category: string;
  question: string;
  answer: string;
  sort_order: number;
  enabled: boolean;
}

interface VoteRow {
  faq_id: string;
  up: number;
  down: number;
  question: string;
  category: string;
}

interface SearchMissRow {
  term: string;
  count: number;
  last_searched_at: string;
}

export default function FaqAdminPage() {
  const { user, loading: authLoading } = useAuth();
  const [faqs, setFaqs] = useState<Faq[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editQuestion, setEditQuestion] = useState("");
  const [editAnswer, setEditAnswer] = useState("");
  const [newForCategory, setNewForCategory] = useState<Record<string, { question: string; answer: string }>>({});

  const [votes, setVotes] = useState<VoteRow[]>([]);
  const [searchMisses, setSearchMisses] = useState<SearchMissRow[]>([]);
  const [analyticsOpen, setAnalyticsOpen] = useState(false);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/faqs");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to load FAQs");
      setFaqs(data.faqs || []);
    } catch (err: any) {
      setError(err.message || "Failed to load FAQs");
    } finally {
      setLoading(false);
    }
  }

  async function loadAnalytics() {
    try {
      const res = await fetch("/api/admin/faqs/analytics");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to load analytics");
      setVotes(data.votes || []);
      setSearchMisses(data.searchMisses || []);
    } catch (err: any) {
      toast.error(err.message || "Failed to load FAQ analytics");
    }
  }

  useEffect(() => {
    if (user && (user.role === "OWNER" || user.role === "ADMIN")) {
      load();
      loadAnalytics();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  async function handleAdd(category: string) {
    const draft = newForCategory[category];
    const question = (draft?.question || "").trim();
    const answer = (draft?.answer || "").trim();
    if (!question || !answer) return;

    try {
      const res = await fetch("/api/admin/faqs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ category, question, answer }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to add FAQ");
      setNewForCategory(prev => ({ ...prev, [category]: { question: "", answer: "" } }));
      toast.success("FAQ added");
      await load();
    } catch (err: any) {
      toast.error(err.message || "Failed to add FAQ");
    }
  }

  async function handleToggleEnabled(faq: Faq) {
    setBusyId(faq.id);
    try {
      const res = await fetch(`/api/admin/faqs/${faq.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: !faq.enabled }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to update FAQ");
      await load();
    } catch (err: any) {
      toast.error(err.message || "Failed to update FAQ");
    } finally {
      setBusyId(null);
    }
  }

  async function handleDelete(faqId: string) {
    setBusyId(faqId);
    try {
      const res = await fetch(`/api/admin/faqs/${faqId}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to delete FAQ");
      toast.success("FAQ deleted");
      await load();
    } catch (err: any) {
      toast.error(err.message || "Failed to delete FAQ");
    } finally {
      setBusyId(null);
    }
  }

  function startEdit(faq: Faq) {
    setEditingId(faq.id);
    setEditQuestion(faq.question);
    setEditAnswer(faq.answer);
  }

  async function saveEdit(faqId: string) {
    setBusyId(faqId);
    try {
      const res = await fetch(`/api/admin/faqs/${faqId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: editQuestion.trim(), answer: editAnswer.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to update FAQ");
      setEditingId(null);
      toast.success("FAQ updated");
      await load();
    } catch (err: any) {
      toast.error(err.message || "Failed to update FAQ");
    } finally {
      setBusyId(null);
    }
  }

  async function handleMove(category: string, categoryFaqs: Faq[], index: number, direction: -1 | 1) {
    const targetIndex = index + direction;
    if (targetIndex < 0 || targetIndex >= categoryFaqs.length) return;
    const reordered = [...categoryFaqs];
    [reordered[index], reordered[targetIndex]] = [reordered[targetIndex], reordered[index]];

    try {
      const res = await fetch("/api/admin/faqs/reorder", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ category, orderedIds: reordered.map(f => f.id) }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to reorder");
      await load();
    } catch (err: any) {
      toast.error(err.message || "Failed to reorder");
    }
  }

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

  const categories = FAQ_CATEGORIES.filter(c => faqs.some(f => f.category === c));

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <ShieldAlert className="w-5 h-5 text-accent" />
        <h1 className="text-display">FAQ Editor</h1>
      </div>
      <p className="text-xs text-text-muted -mt-4">
        Content shown on the public Help Center (/dashboard/help). Disabling a question hides it there but keeps it here for later. The arrows change display order within a category.
      </p>

      <div className="border border-border rounded-xl overflow-hidden">
        <button
          type="button"
          onClick={() => setAnalyticsOpen(v => !v)}
          className="w-full flex items-center gap-2 px-4 py-3 bg-surface-3/30 text-xs font-bold text-text-primary"
        >
          <BarChart3 className="w-4 h-4 text-accent" /> Feedback &amp; search analytics
        </button>
        {analyticsOpen && (
          <div className="p-4 grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
            <div>
              <h3 className="font-bold text-text-primary mb-2">Votes by question</h3>
              {votes.length === 0 ? (
                <p className="text-text-muted text-[11px]">No votes recorded yet.</p>
              ) : (
                <div className="space-y-1.5">
                  {votes.map(v => (
                    <div key={v.faq_id} className="flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-lg bg-surface-1 border border-border">
                      <span className="truncate text-text-secondary" title={v.question}>{v.question}</span>
                      <span className="shrink-0 text-[10px] text-text-muted">👍 {v.up} · 👎 {v.down}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div>
              <h3 className="font-bold text-text-primary mb-2">Zero-result searches</h3>
              {searchMisses.length === 0 ? (
                <p className="text-text-muted text-[11px]">No zero-result searches logged yet.</p>
              ) : (
                <div className="space-y-1.5">
                  {searchMisses.map(m => (
                    <div key={m.term} className="flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-lg bg-surface-1 border border-border">
                      <span className="truncate text-text-secondary">&quot;{m.term}&quot;</span>
                      <span className="shrink-0 text-[10px] text-text-muted">×{m.count}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {loading ? (
        <div className="p-8 text-center text-text-muted text-xs">Loading…</div>
      ) : error ? (
        <div className="p-8 text-center text-danger text-xs">{error}</div>
      ) : (
        <div className="space-y-5">
          {categories.map(category => {
            const categoryFaqs = faqs.filter(f => f.category === category);
            const draft = newForCategory[category] || { question: "", answer: "" };
            return (
              <div key={category} className="border border-border rounded-xl overflow-hidden">
                <div className="px-4 py-3 bg-surface-3/30 border-b border-border">
                  <h2 className="text-xs font-bold text-text-primary">{category}</h2>
                  <p className="text-[10px] text-text-muted">
                    {categoryFaqs.filter(f => f.enabled).length} enabled · {categoryFaqs.length} total
                  </p>
                </div>
                <div className="p-4 space-y-2">
                  {categoryFaqs.map((faq, i) => (
                    <div
                      key={faq.id}
                      className={`rounded-lg border ${faq.enabled ? "border-border bg-surface-1" : "border-border/50 bg-surface-3/20 opacity-60"}`}
                    >
                      <div className="flex items-center gap-2 px-3 py-2">
                        <div className="flex flex-col -my-1">
                          <button
                            type="button"
                            onClick={() => handleMove(category, categoryFaqs, i, -1)}
                            disabled={i === 0}
                            className="p-0.5 text-text-muted hover:text-text-primary disabled:opacity-30"
                          >
                            <ArrowUp className="w-3 h-3" />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleMove(category, categoryFaqs, i, 1)}
                            disabled={i === categoryFaqs.length - 1}
                            className="p-0.5 text-text-muted hover:text-text-primary disabled:opacity-30"
                          >
                            <ArrowDown className="w-3 h-3" />
                          </button>
                        </div>
                        <span className="flex-1 min-w-0 truncate text-xs font-semibold text-text-primary">{faq.question}</span>
                        <button
                          type="button"
                          onClick={() => (editingId === faq.id ? setEditingId(null) : startEdit(faq))}
                          className="p-1 text-text-muted hover:text-accent transition-colors"
                          title="Edit"
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleToggleEnabled(faq)}
                          disabled={busyId === faq.id}
                          className={`px-2 py-0.5 rounded text-[10px] font-bold border transition-colors ${
                            faq.enabled ? "border-success/30 text-success bg-success/10" : "border-border text-text-muted"
                          }`}
                        >
                          {faq.enabled ? "Enabled" : "Disabled"}
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDelete(faq.id)}
                          disabled={busyId === faq.id}
                          className="p-1 text-text-muted hover:text-danger transition-colors"
                          title="Delete"
                        >
                          {busyId === faq.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <X className="w-3.5 h-3.5" />}
                        </button>
                      </div>
                      {editingId === faq.id && (
                        <div className="px-3 pb-3 space-y-2">
                          <input
                            type="text"
                            value={editQuestion}
                            onChange={e => setEditQuestion(e.target.value)}
                            className="w-full px-2.5 py-1.5 text-[11px] border border-border rounded-lg bg-surface-1 text-text-primary outline-none focus:border-accent"
                          />
                          <textarea
                            value={editAnswer}
                            onChange={e => setEditAnswer(e.target.value)}
                            rows={4}
                            className="w-full px-2.5 py-1.5 text-[11px] border border-border rounded-lg bg-surface-1 text-text-primary outline-none focus:border-accent resize-y"
                          />
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              onClick={() => saveEdit(faq.id)}
                              disabled={busyId === faq.id}
                              className="px-2.5 py-1 bg-accent hover:bg-accent-hover text-white text-[11px] font-bold rounded-lg transition-colors"
                            >
                              Save
                            </button>
                            <button
                              type="button"
                              onClick={() => setEditingId(null)}
                              className="px-2.5 py-1 text-[11px] font-bold text-text-muted hover:text-text-primary"
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  ))}

                  <div className="pt-1 space-y-1.5">
                    <input
                      type="text"
                      value={draft.question}
                      onChange={e => setNewForCategory(prev => ({ ...prev, [category]: { ...draft, question: e.target.value } }))}
                      placeholder="New question…"
                      className="w-full px-2.5 py-1.5 text-[11px] border border-border rounded-lg bg-surface-1 text-text-primary outline-none focus:border-accent"
                    />
                    <textarea
                      value={draft.answer}
                      onChange={e => setNewForCategory(prev => ({ ...prev, [category]: { ...draft, answer: e.target.value } }))}
                      placeholder="Answer (supports **bold**, - bullets, 1. numbered lists)…"
                      rows={2}
                      className="w-full px-2.5 py-1.5 text-[11px] border border-border rounded-lg bg-surface-1 text-text-primary outline-none focus:border-accent resize-y"
                    />
                    <button
                      type="button"
                      onClick={() => handleAdd(category)}
                      className="flex items-center gap-1 px-2.5 py-1.5 bg-accent hover:bg-accent-hover text-white text-[11px] font-bold rounded-lg transition-colors"
                    >
                      <Plus className="w-3.5 h-3.5" /> Add to {category}
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
