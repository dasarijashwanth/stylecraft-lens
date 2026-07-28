// lib/db/faqs.ts
// CRUD over faqs/faq_votes/faq_search_misses — dual-path (Supabase/
// memoryDb) mirroring lib/db/motor-families.ts's exact style. Real seed
// content comes from lib/faq-seed-data.ts (via scripts/seed-faqs.ts for
// Supabase, memoryDb.ts's seedFaqDefaults() for local dev) — this file is
// pure CRUD/read, no content of its own.
import { isSupabaseConfigured, supabaseAdmin } from "@/lib/supabase";
import { memoryDb, MockFaq } from "@/lib/memoryDb";
import { FAQ_CATEGORIES } from "@/lib/faq-seed-data";
import { isTdsEnabled } from "@/lib/feature-flags";

export interface FaqRow {
  id: string;
  category: string;
  question: string;
  answer: string;
  sort_order: number;
  enabled: boolean;
  // Ties this row to a feature flag (lib/feature-flags.ts) — listFaqs()
  // hides it whenever that flag is off. null for every FAQ not tied to an
  // optional feature.
  feature: string | null;
  created_at: string;
  updated_at: string;
}

// One entry per feature-gated FAQ category. Add the next one here the same
// way lib/feature-flags.ts adds a new named flag function.
const FEATURE_CHECKS: Record<string, () => Promise<boolean>> = {
  tds: isTdsEnabled,
};

function categoryRank(category: string): number {
  const idx = FAQ_CATEGORIES.indexOf(category);
  return idx === -1 ? FAQ_CATEGORIES.length : idx; // unknown categories sort last, never dropped
}

function sortByCategoryThenOrder(rows: FaqRow[]): FaqRow[] {
  return [...rows].sort((a, b) => categoryRank(a.category) - categoryRank(b.category) || a.sort_order - b.sort_order);
}

function mockToRow(f: MockFaq): FaqRow {
  return {
    id: f.id,
    category: f.category,
    question: f.question,
    answer: f.answer,
    sort_order: f.sortOrder,
    enabled: f.enabled,
    feature: f.feature ?? null,
    created_at: f.createdAt.toISOString(),
    updated_at: f.updatedAt.toISOString(),
  };
}

// The public read (used by /help and the contextual "?" deep links) — also
// filters out any row tied to a currently-disabled feature flag, so a
// flag-off feature's FAQ content auto-hides instead of needing a one-time
// manual `enabled=false` toggle that would need to be remembered and
// reversed by hand later.
export async function listFaqs(): Promise<FaqRow[]> {
  let rows: FaqRow[];
  if (isSupabaseConfigured) {
    const { data, error } = await supabaseAdmin.from("faqs").select("*").eq("enabled", true);
    if (error) throw error;
    rows = data || [];
  } else {
    rows = memoryDb.faqs.filter(f => f.enabled).map(mockToRow);
  }

  const filtered: FaqRow[] = [];
  for (const row of rows) {
    const check = row.feature ? FEATURE_CHECKS[row.feature] : null;
    if (check && !(await check())) continue;
    filtered.push(row);
  }
  return sortByCategoryThenOrder(filtered);
}

export async function listAllFaqsForAdmin(): Promise<FaqRow[]> {
  if (isSupabaseConfigured) {
    const { data, error } = await supabaseAdmin.from("faqs").select("*");
    if (error) throw error;
    return sortByCategoryThenOrder(data || []);
  }
  return sortByCategoryThenOrder(memoryDb.faqs.map(mockToRow));
}

export async function addFaq(input: { category: string; question: string; answer: string }): Promise<FaqRow> {
  if (isSupabaseConfigured) {
    const { data: existing } = await supabaseAdmin
      .from("faqs")
      .select("sort_order")
      .eq("category", input.category)
      .order("sort_order", { ascending: false })
      .limit(1)
      .maybeSingle();
    const nextSort = (existing?.sort_order ?? -1) + 1;
    const { data, error } = await supabaseAdmin
      .from("faqs")
      .insert({ category: input.category, question: input.question, answer: input.answer, sort_order: nextSort })
      .select()
      .single();
    if (error) throw error;
    return data;
  }

  const now = new Date();
  const existingForCat = memoryDb.faqs.filter(f => f.category === input.category);
  const nextSort = existingForCat.length ? Math.max(...existingForCat.map(f => f.sortOrder)) + 1 : 0;
  const row: MockFaq = {
    id: `faq_${Date.now()}_${Math.floor(Math.random() * 1e6)}`,
    category: input.category,
    question: input.question,
    answer: input.answer,
    sortOrder: nextSort,
    enabled: true,
    createdAt: now,
    updatedAt: now,
  };
  memoryDb.faqs.push(row);
  return mockToRow(row);
}

export async function updateFaq(
  id: string,
  patch: { category?: string; question?: string; answer?: string; enabled?: boolean; sortOrder?: number }
): Promise<FaqRow | null> {
  if (isSupabaseConfigured) {
    const dbPatch: any = { updated_at: new Date().toISOString() };
    if (patch.category !== undefined) dbPatch.category = patch.category;
    if (patch.question !== undefined) dbPatch.question = patch.question;
    if (patch.answer !== undefined) dbPatch.answer = patch.answer;
    if (patch.enabled !== undefined) dbPatch.enabled = patch.enabled;
    if (patch.sortOrder !== undefined) dbPatch.sort_order = patch.sortOrder;
    const { data, error } = await supabaseAdmin.from("faqs").update(dbPatch).eq("id", id).select().single();
    if (error) throw error;
    return data;
  }

  const row = memoryDb.faqs.find(f => f.id === id);
  if (!row) return null;
  if (patch.category !== undefined) row.category = patch.category;
  if (patch.question !== undefined) row.question = patch.question;
  if (patch.answer !== undefined) row.answer = patch.answer;
  if (patch.enabled !== undefined) row.enabled = patch.enabled;
  if (patch.sortOrder !== undefined) row.sortOrder = patch.sortOrder;
  row.updatedAt = new Date();
  return mockToRow(row);
}

export async function deleteFaq(id: string): Promise<void> {
  if (isSupabaseConfigured) {
    const { error } = await supabaseAdmin.from("faqs").delete().eq("id", id);
    if (error) throw error;
    return;
  }
  const idx = memoryDb.faqs.findIndex(f => f.id === id);
  if (idx >= 0) memoryDb.faqs.splice(idx, 1);
}

// orderedIds: FAQ ids within ONE category, in the new desired priority order.
export async function reorderFaqs(category: string, orderedIds: string[]): Promise<void> {
  if (isSupabaseConfigured) {
    for (let i = 0; i < orderedIds.length; i++) {
      const { error } = await supabaseAdmin
        .from("faqs")
        .update({ sort_order: i, updated_at: new Date().toISOString() })
        .eq("id", orderedIds[i])
        .eq("category", category);
      if (error) throw error;
    }
    return;
  }
  orderedIds.forEach((id, i) => {
    const row = memoryDb.faqs.find(f => f.id === id && f.category === category);
    if (row) {
      row.sortOrder = i;
      row.updatedAt = new Date();
    }
  });
}

export async function recordFaqVote(faqId: string, vote: "up" | "down"): Promise<void> {
  if (isSupabaseConfigured) {
    const { error } = await supabaseAdmin.from("faq_votes").insert({ faq_id: faqId, vote });
    if (error) throw error;
    return;
  }
  memoryDb.faqVotes.push({ id: `faqvote_${Date.now()}_${Math.floor(Math.random() * 1e6)}`, faqId, vote, createdAt: new Date() });
}

export interface FaqVoteCounts {
  faq_id: string;
  up: number;
  down: number;
}

// Admin view — aggregate counts per FAQ, joined with question text for display.
export async function getFaqVoteCounts(): Promise<(FaqVoteCounts & { question: string; category: string })[]> {
  const faqs = await listAllFaqsForAdmin();
  const faqById = new Map(faqs.map(f => [f.id, f]));

  let votes: { faq_id: string; vote: "up" | "down" }[];
  if (isSupabaseConfigured) {
    const { data, error } = await supabaseAdmin.from("faq_votes").select("faq_id, vote");
    if (error) throw error;
    votes = data || [];
  } else {
    votes = memoryDb.faqVotes.map(v => ({ faq_id: v.faqId, vote: v.vote }));
  }

  const counts = new Map<string, { up: number; down: number }>();
  for (const v of votes) {
    const entry = counts.get(v.faq_id) || { up: 0, down: 0 };
    if (v.vote === "up") entry.up++; else entry.down++;
    counts.set(v.faq_id, entry);
  }

  return Array.from(counts.entries())
    .map(([faq_id, c]) => ({
      faq_id,
      up: c.up,
      down: c.down,
      question: faqById.get(faq_id)?.question || "(deleted question)",
      category: faqById.get(faq_id)?.category || "",
    }))
    .sort((a, b) => (b.up + b.down) - (a.up + a.down));
}

export async function logFaqSearchMiss(term: string): Promise<void> {
  const trimmed = term.trim().toLowerCase();
  if (!trimmed) return;
  if (isSupabaseConfigured) {
    const { error } = await supabaseAdmin.from("faq_search_misses").insert({ term: trimmed });
    if (error) throw error;
    return;
  }
  memoryDb.faqSearchMisses.push({ id: `faqmiss_${Date.now()}_${Math.floor(Math.random() * 1e6)}`, term: trimmed, createdAt: new Date() });
}

export interface FaqSearchMissSummary {
  term: string;
  count: number;
  last_searched_at: string;
}

// Admin view — most frequent zero-result search terms, most recent first
// within ties, so admins can grow the FAQ where users actually get stuck.
export async function getFaqSearchMisses(limit = 50): Promise<FaqSearchMissSummary[]> {
  let rows: { term: string; created_at: string }[];
  if (isSupabaseConfigured) {
    const { data, error } = await supabaseAdmin.from("faq_search_misses").select("term, created_at").order("created_at", { ascending: false });
    if (error) throw error;
    rows = data || [];
  } else {
    rows = memoryDb.faqSearchMisses
      .slice()
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .map(m => ({ term: m.term, created_at: m.createdAt.toISOString() }));
  }

  const summary = new Map<string, FaqSearchMissSummary>();
  for (const row of rows) {
    const existing = summary.get(row.term);
    if (existing) {
      existing.count++;
      if (row.created_at > existing.last_searched_at) existing.last_searched_at = row.created_at;
    } else {
      summary.set(row.term, { term: row.term, count: 1, last_searched_at: row.created_at });
    }
  }

  return Array.from(summary.values())
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);
}
