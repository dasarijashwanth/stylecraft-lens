"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Fuse from "fuse.js";
import { toast } from "sonner";
import { HelpCircle, ChevronDown, ChevronUp, Search, Link2, ThumbsUp, ThumbsDown, X, Mail } from "lucide-react";
import { Spinner } from "@/components/ui/Spinner";
import FaqMarkdown from "@/components/help/FaqMarkdown";
import { FAQ_CATEGORIES } from "@/lib/faq-seed-data";
import { slugifyFaqCategory } from "@/lib/faq-slugs";
import { useContactSupport } from "@/components/help/ContactSupportProvider";

interface Faq {
  id: string;
  category: string;
  question: string;
  answer: string;
  sort_order: number;
  enabled: boolean;
}

function highlight(text: string, ranges: readonly [number, number][] | undefined): React.ReactNode {
  if (!ranges || ranges.length === 0) return text;
  const nodes: React.ReactNode[] = [];
  let cursor = 0;
  ranges
    .slice()
    .sort((a, b) => a[0] - b[0])
    .forEach(([start, end], i) => {
      if (start > cursor) nodes.push(text.slice(cursor, start));
      nodes.push(
        <mark key={i} className="bg-accent/25 text-text-primary rounded-sm px-0.5">
          {text.slice(start, end + 1)}
        </mark>
      );
      cursor = end + 1;
    });
  if (cursor < text.length) nodes.push(text.slice(cursor));
  return nodes;
}

export default function HelpPage() {
  const [faqs, setFaqs] = useState<Faq[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [openIds, setOpenIds] = useState<Set<string>>(new Set());
  const [votedIds, setVotedIds] = useState<Set<string>>(new Set());
  const [downvotedIds, setDownvotedIds] = useState<Set<string>>(new Set());
  const { open: openContactSupport } = useContactSupport();
  const loggedMissRef = useRef<string | null>(null);
  const pendingHashRef = useRef<string | null>(
    typeof window !== "undefined" ? window.location.hash.replace(/^#/, "") : null
  );

  useEffect(() => {
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch("/api/faqs");
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Failed to load FAQs");
        setFaqs(data.faqs || []);
      } catch (err: any) {
        setError(err.message || "Failed to load FAQs");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  // Deep-link support: /help#cat-<slug> jumps to a category section;
  // /help#faq-<id> expands and scrolls to a specific question (used by the
  // per-question copyable link and the contextual "?" tab icons).
  useEffect(() => {
    const hash = pendingHashRef.current;
    if (!hash || loading || faqs.length === 0) return;
    if (hash.startsWith("faq-")) {
      const id = hash.slice(4);
      setOpenIds(prev => new Set(prev).add(id));
    }
    const t = setTimeout(() => {
      const el = document.getElementById(hash);
      el?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 50);
    pendingHashRef.current = null;
    return () => clearTimeout(t);
  }, [loading, faqs]);

  const fuse = useMemo(
    () =>
      new Fuse(faqs, {
        keys: ["question", "answer"],
        threshold: 0.35,
        ignoreLocation: true,
        includeMatches: true,
        minMatchCharLength: 2,
      }),
    [faqs]
  );

  const searchResults = useMemo(() => {
    if (!query.trim()) return null;
    return fuse.search(query.trim());
  }, [fuse, query]);

  useEffect(() => {
    const term = query.trim();
    if (!term || term.length < 3 || loading) return;
    if (!searchResults || searchResults.length > 0) return;
    if (loggedMissRef.current === term.toLowerCase()) return;
    const t = setTimeout(() => {
      loggedMissRef.current = term.toLowerCase();
      fetch("/api/faqs/log-search-miss", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ term }),
      }).catch(() => {});
    }, 600);
    return () => clearTimeout(t);
  }, [query, searchResults, loading]);

  const categories = FAQ_CATEGORIES.filter(c => faqs.some(f => f.category === c));

  function toggleOpen(id: string) {
    setOpenIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function handleVote(id: string, vote: "up" | "down") {
    if (votedIds.has(id)) return;
    setVotedIds(prev => new Set(prev).add(id));
    if (vote === "down") setDownvotedIds(prev => new Set(prev).add(id));
    try {
      const res = await fetch(`/api/faqs/${id}/vote`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ vote }),
      });
      if (!res.ok) throw new Error("Failed to record vote");
      toast.success("Thanks for the feedback!");
    } catch {
      toast.error("Couldn't record your feedback — try again later");
    }
  }

  function handleCopyLink(id: string) {
    const url = `${window.location.origin}/dashboard/help#faq-${id}`;
    navigator.clipboard.writeText(url).then(
      () => toast.success("Link copied"),
      () => toast.error("Couldn't copy link")
    );
  }

  function scrollToCategory(category: string) {
    const el = document.getElementById(`cat-${slugifyFaqCategory(category)}`);
    el?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function renderQuestion(faq: Faq, matches?: readonly any[]) {
    const isOpen = openIds.has(faq.id);
    const qMatch = matches?.find(m => m.key === "question")?.indices as [number, number][] | undefined;
    const aMatch = matches?.find(m => m.key === "answer")?.indices as [number, number][] | undefined;
    const voted = votedIds.has(faq.id);

    return (
      <div key={faq.id} id={`faq-${faq.id}`} className="py-3.5 scroll-mt-24">
        <button
          type="button"
          onClick={() => toggleOpen(faq.id)}
          className="w-full flex items-center justify-between gap-3 font-bold text-text-primary text-left text-xs"
        >
          <span>{highlight(faq.question, qMatch)}</span>
          {isOpen ? <ChevronUp className="w-4 h-4 text-text-muted shrink-0" /> : <ChevronDown className="w-4 h-4 text-text-muted shrink-0" />}
        </button>
        {isOpen && (
          <div className="mt-2.5 pr-2">
            <FaqMarkdown text={faq.answer} className="text-text-secondary leading-relaxed text-xs" />
            {aMatch && query.trim() && (
              <p className="mt-1 text-[10px] text-text-muted italic">Match: {highlight(faq.answer, aMatch)}</p>
            )}
            <div className="flex items-center gap-3 mt-3 pt-2 border-t border-border/50">
              <button
                type="button"
                onClick={() => handleCopyLink(faq.id)}
                className="flex items-center gap-1 text-[10px] text-text-muted hover:text-accent transition-colors"
              >
                <Link2 className="w-3 h-3" /> Copy link
              </button>
              <div className="flex items-center gap-2 ml-auto">
                <span className="text-[10px] text-text-muted">Helpful?</span>
                <button
                  type="button"
                  disabled={voted}
                  onClick={() => handleVote(faq.id, "up")}
                  className="p-1 text-text-muted hover:text-success transition-colors disabled:opacity-40"
                  title="Yes"
                >
                  <ThumbsUp className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  disabled={voted}
                  onClick={() => handleVote(faq.id, "down")}
                  className="p-1 text-text-muted hover:text-danger transition-colors disabled:opacity-40"
                  title="No"
                >
                  <ThumbsDown className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
            {downvotedIds.has(faq.id) && (
              <button
                type="button"
                onClick={() => openContactSupport({ prefillTopic: "question", prefillMessage: `Regarding: "${faq.question}"\n\n` })}
                className="mt-2 text-[10px] text-accent hover:underline"
              >
                Contact support about this
              </button>
            )}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-5xl">
      <div className="flex items-center gap-2">
        <HelpCircle className="w-5 h-5 text-accent" />
        <h1 className="text-display">Help & Support</h1>
      </div>

      <div className="flex items-center gap-1 border-b border-border">
        <div className="px-3 py-2 border-b-2 border-accent text-accent font-bold text-xs flex items-center gap-1.5">
          <HelpCircle className="w-3.5 h-3.5" /> FAQ
        </div>
        <button
          type="button"
          onClick={() => openContactSupport()}
          className="px-3 py-2 border-b-2 border-transparent text-text-secondary hover:text-text-primary font-bold text-xs flex items-center gap-1.5 transition-colors"
        >
          <Mail className="w-3.5 h-3.5" /> Contact Support
        </button>
      </div>

      <div className="relative max-w-md">
        <Search className="w-3.5 h-3.5 text-text-muted absolute left-3 top-1/2 -translate-y-1/2" />
        <input
          type="text"
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Search the help center…"
          className="w-full pl-8 pr-8 py-2 text-xs border border-border rounded-lg bg-surface-1 text-text-primary outline-none focus:border-accent"
        />
        {query && (
          <button
            type="button"
            onClick={() => setQuery("")}
            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-primary"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {/* Mobile category picker */}
      {!query && categories.length > 0 && (
        <select
          className="md:hidden w-full px-3 py-2 text-xs border border-border rounded-lg bg-surface-1 text-text-primary outline-none focus:border-accent"
          onChange={e => e.target.value && scrollToCategory(e.target.value)}
          defaultValue=""
        >
          <option value="" disabled>Jump to a category…</option>
          {categories.map(c => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
      )}

      {loading ? (
        <div className="flex items-center justify-center min-h-[200px]">
          <Spinner size="lg" className="text-accent" />
        </div>
      ) : error ? (
        <div className="p-8 text-center text-danger text-xs">{error}</div>
      ) : query.trim() ? (
        <div className="bg-surface-2 border border-border rounded-xl p-5 md:p-6 space-y-1">
          <h2 className="text-sm font-bold text-text-primary font-display mb-2">
            {searchResults?.length ? `${searchResults.length} result${searchResults.length === 1 ? "" : "s"}` : "No results"}
          </h2>
          {searchResults && searchResults.length === 0 && (
            <p className="text-xs text-text-muted">
              Nothing matched &quot;{query.trim()}&quot;. Try a different term, or ask an admin — searches like this are logged so we know what to add.
            </p>
          )}
          <div className="divide-y divide-border/60">
            {searchResults?.map(r => (
              <div key={r.item.id}>
                <p className="text-[10px] text-text-muted mt-3">{r.item.category}</p>
                {renderQuestion(r.item, r.matches)}
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="flex gap-6">
          <nav className="hidden md:block w-48 shrink-0 sticky top-4 self-start space-y-1">
            {categories.map(c => (
              <button
                key={c}
                type="button"
                onClick={() => scrollToCategory(c)}
                className="block w-full text-left px-2.5 py-1.5 text-[11px] font-semibold text-text-secondary hover:text-accent hover:bg-surface-2 rounded-lg transition-colors"
              >
                {c}
              </button>
            ))}
          </nav>

          <div className="flex-1 min-w-0 space-y-5">
            {categories.map(category => (
              <div
                key={category}
                id={`cat-${slugifyFaqCategory(category)}`}
                className="bg-surface-2 border border-border rounded-xl p-5 md:p-6 space-y-1 scroll-mt-4"
              >
                <h2 className="text-sm font-bold text-text-primary font-display mb-3">{category}</h2>
                <div className="divide-y divide-border/60">
                  {faqs.filter(f => f.category === category).map(faq => renderQuestion(faq))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="flex items-center justify-between gap-4 p-5 border border-border rounded-xl bg-surface-2">
        <div className="flex items-center gap-3">
          <Mail className="w-5 h-5 text-accent shrink-0" />
          <div>
            <p className="text-xs font-bold text-text-primary">Didn&apos;t find your answer?</p>
            <p className="text-[11px] text-text-muted">Contact support and we&apos;ll reply directly to your email.</p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => openContactSupport()}
          className="px-3.5 py-1.5 bg-accent hover:bg-accent-hover text-white text-xs font-bold rounded-lg transition-colors shadow shrink-0"
        >
          Contact support
        </button>
      </div>
    </div>
  );
}
