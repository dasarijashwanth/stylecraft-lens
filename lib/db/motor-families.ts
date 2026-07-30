// lib/db/motor-families.ts
// CRUD over motor_families — the admin-editable motor-type taxonomy
// competitor selection now matches on (lib/motor-taxonomy.ts), mirroring
// lib/db/legacy-brands.ts's exact dual-path CRUD style. Unlike deck
// templates, memoryDb is always pre-seeded with the 8 default families
// (see lib/memoryDb.ts's seedMotorFamilyDefaults) — real default
// configuration, not an empty admin-fills-it-in table.
import { isSupabaseConfigured, supabaseAdmin } from "@/lib/supabase";
import { memoryDb, MockMotorFamily } from "@/lib/memoryDb";

export interface MotorFamilyRow {
  id: string;
  family_key: string;
  label: string;
  domain: string; // 'clipper_trimmer_shaver' | 'beauty'
  aliases: string[];
  modifier: boolean;
  adjacent_families: string[];
  enabled: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

function mockToRow(f: MockMotorFamily): MotorFamilyRow {
  return {
    id: f.id,
    family_key: f.familyKey,
    label: f.label,
    domain: f.domain,
    aliases: f.aliases,
    modifier: f.modifier,
    adjacent_families: f.adjacentFamilies,
    enabled: f.enabled,
    sort_order: f.sortOrder,
    created_at: f.createdAt.toISOString(),
    updated_at: f.updatedAt.toISOString(),
  };
}

export async function listMotorFamilies(): Promise<MotorFamilyRow[]> {
  if (isSupabaseConfigured) {
    const { data, error } = await supabaseAdmin.from("motor_families").select("*").order("sort_order");
    if (error) throw error;
    return data || [];
  }
  return [...memoryDb.motorFamilies].sort((a, b) => a.sortOrder - b.sortOrder).map(mockToRow);
}

export async function addMotorFamily(input: {
  familyKey: string;
  label: string;
  domain: string;
  aliases?: string[];
  modifier?: boolean;
  adjacentFamilies?: string[];
}): Promise<MotorFamilyRow> {
  if (isSupabaseConfigured) {
    const { data: existing } = await supabaseAdmin
      .from("motor_families")
      .select("sort_order")
      .order("sort_order", { ascending: false })
      .limit(1)
      .maybeSingle();
    const nextSort = (existing?.sort_order ?? -1) + 1;
    const { data, error } = await supabaseAdmin
      .from("motor_families")
      .insert({
        family_key: input.familyKey,
        label: input.label,
        domain: input.domain,
        aliases: input.aliases || [],
        modifier: input.modifier ?? false,
        adjacent_families: input.adjacentFamilies || [],
        sort_order: nextSort,
      })
      .select()
      .single();
    if (error) throw error;
    return data;
  }

  const now = new Date();
  const nextSort = memoryDb.motorFamilies.length ? Math.max(...memoryDb.motorFamilies.map(f => f.sortOrder)) + 1 : 0;
  const row: MockMotorFamily = {
    id: `mfam_${Date.now()}_${Math.floor(Math.random() * 1e6)}`,
    familyKey: input.familyKey,
    label: input.label,
    domain: input.domain,
    aliases: input.aliases || [],
    modifier: input.modifier ?? false,
    adjacentFamilies: input.adjacentFamilies || [],
    enabled: true,
    sortOrder: nextSort,
    createdAt: now,
    updatedAt: now,
  };
  memoryDb.motorFamilies.push(row);
  return mockToRow(row);
}

export async function updateMotorFamily(
  id: string,
  patch: { label?: string; aliases?: string[]; adjacentFamilies?: string[]; enabled?: boolean; sortOrder?: number }
): Promise<MotorFamilyRow | null> {
  if (isSupabaseConfigured) {
    const dbPatch: any = { updated_at: new Date().toISOString() };
    if (patch.label !== undefined) dbPatch.label = patch.label;
    if (patch.aliases !== undefined) dbPatch.aliases = patch.aliases;
    if (patch.adjacentFamilies !== undefined) dbPatch.adjacent_families = patch.adjacentFamilies;
    if (patch.enabled !== undefined) dbPatch.enabled = patch.enabled;
    if (patch.sortOrder !== undefined) dbPatch.sort_order = patch.sortOrder;
    const { data, error } = await supabaseAdmin.from("motor_families").update(dbPatch).eq("id", id).select().single();
    if (error) throw error;
    return data;
  }

  const row = memoryDb.motorFamilies.find(f => f.id === id);
  if (!row) return null;
  if (patch.label !== undefined) row.label = patch.label;
  if (patch.aliases !== undefined) row.aliases = patch.aliases;
  if (patch.adjacentFamilies !== undefined) row.adjacentFamilies = patch.adjacentFamilies;
  if (patch.enabled !== undefined) row.enabled = patch.enabled;
  if (patch.sortOrder !== undefined) row.sortOrder = patch.sortOrder;
  row.updatedAt = new Date();
  return mockToRow(row);
}

export async function deleteMotorFamily(id: string): Promise<void> {
  if (isSupabaseConfigured) {
    const { error } = await supabaseAdmin.from("motor_families").delete().eq("id", id);
    if (error) throw error;
    return;
  }
  const idx = memoryDb.motorFamilies.findIndex(f => f.id === id);
  if (idx >= 0) memoryDb.motorFamilies.splice(idx, 1);
}

// Logged from lib/motor-extraction.ts's resolveOurMotorType whenever a
// user's free-text Motor Technology entry doesn't match any enabled
// family — surfaces on /dashboard/admin/competitor-matching so the
// taxonomy admin can see real-world motor names worth adding as a new
// family/alias, mirroring lib/db/faqs.ts's logFaqSearchMiss/
// getFaqSearchMisses exactly (same dual-path shape, same "most frequent,
// most recent within ties" summary).
export async function logMotorTechMiss(term: string): Promise<void> {
  const trimmed = term.trim();
  if (!trimmed) return;
  if (isSupabaseConfigured) {
    const { error } = await supabaseAdmin.from("motor_tech_search_misses").insert({ term: trimmed });
    if (error) throw error;
    return;
  }
  memoryDb.motorTechSearchMisses.push({ id: `mtmiss_${Date.now()}_${Math.floor(Math.random() * 1e6)}`, term: trimmed, createdAt: new Date() });
}

export interface MotorTechMissSummary {
  term: string;
  count: number;
  last_searched_at: string;
}

export async function getMotorTechMisses(limit = 50): Promise<MotorTechMissSummary[]> {
  let rows: { term: string; created_at: string }[];
  if (isSupabaseConfigured) {
    // brand_name IS NULL excludes branded-name misses (Section 27) — those
    // surface separately via getBrandedMotorMisses below, never double-
    // counted here.
    const { data, error } = await supabaseAdmin.from("motor_tech_search_misses").select("term, created_at").is("brand_name", null).order("created_at", { ascending: false });
    if (error) throw error;
    rows = data || [];
  } else {
    rows = memoryDb.motorTechSearchMisses
      .filter(m => !m.brandName)
      .slice()
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .map(m => ({ term: m.term, created_at: m.createdAt.toISOString() }));
  }

  const summary = new Map<string, MotorTechMissSummary>();
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

// Logged from lib/motor-extraction.ts's extractCompetitorMotorType whenever
// a COMPETITOR's listing text plausibly names a proprietary motor phrase
// (contains the word "motor") that matched neither the generic taxonomy nor
// the brand's own branded_motor_names entries — reuses Section 21's table
// (Section 27's added brand_name/ai_guessed_family columns) rather than a
// new one. Fire-and-forget from a synchronous extraction cascade (the
// competitor-scoring hot path deliberately stays synchronous for
// performance), so this is best-effort only — never awaited by its caller.
export async function logBrandedMotorMiss(brandName: string, term: string): Promise<void> {
  const trimmedTerm = term.trim();
  const trimmedBrand = brandName.trim();
  if (!trimmedTerm || !trimmedBrand) return;
  if (isSupabaseConfigured) {
    const { error } = await supabaseAdmin.from("motor_tech_search_misses").insert({ term: trimmedTerm, brand_name: trimmedBrand });
    if (error) throw error;
    return;
  }
  memoryDb.motorTechSearchMisses.push({
    id: `mtmiss_${Date.now()}_${Math.floor(Math.random() * 1e6)}`,
    term: trimmedTerm,
    brandName: trimmedBrand,
    createdAt: new Date(),
  });
}

export interface BrandedMotorMissSummary {
  brand_name: string;
  term: string;
  count: number;
  last_searched_at: string;
  ai_guessed_family: string | null;
}

// Grouped by (brand_name, term) pair — the same proprietary phrase logged
// repeatedly across many competitor scans collapses into one row with a
// count, same aggregation style as getMotorTechMisses above.
export async function getBrandedMotorMisses(limit = 50): Promise<BrandedMotorMissSummary[]> {
  let rows: { brand_name: string; term: string; ai_guessed_family: string | null; created_at: string }[];
  if (isSupabaseConfigured) {
    const { data, error } = await supabaseAdmin
      .from("motor_tech_search_misses")
      .select("brand_name, term, ai_guessed_family, created_at")
      .not("brand_name", "is", null)
      .order("created_at", { ascending: false });
    if (error) throw error;
    rows = data || [];
  } else {
    rows = memoryDb.motorTechSearchMisses
      .filter(m => !!m.brandName)
      .slice()
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .map(m => ({ brand_name: m.brandName!, term: m.term, ai_guessed_family: m.aiGuessedFamily ?? null, created_at: m.createdAt.toISOString() }));
  }

  const summary = new Map<string, BrandedMotorMissSummary>();
  for (const row of rows) {
    const key = `${row.brand_name.toLowerCase()}|${row.term.toLowerCase()}`;
    const existing = summary.get(key);
    if (existing) {
      existing.count++;
      if (row.created_at > existing.last_searched_at) existing.last_searched_at = row.created_at;
      if (!existing.ai_guessed_family && row.ai_guessed_family) existing.ai_guessed_family = row.ai_guessed_family;
    } else {
      summary.set(key, { brand_name: row.brand_name, term: row.term, count: 1, last_searched_at: row.created_at, ai_guessed_family: row.ai_guessed_family });
    }
  }

  return Array.from(summary.values())
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);
}

// Best-effort AI classification for a batch of branded misses that don't
// have an ai_guessed_family yet — admin-triggered only (see
// app/api/admin/motor-families/branded-misses/route.ts's POST), never
// called automatically during analysis. One combined call classifies every
// pending term at once against the 7 canonical family keys (or "UNKNOWN"),
// fail-open like every other AI call in this app.
export async function classifyPendingBrandedMotorMisses(): Promise<number> {
  const misses = (await getBrandedMotorMisses(200)).filter(m => !m.ai_guessed_family);
  if (misses.length === 0) return 0;

  const { callOpenAiForJson, hasOpenAIKey } = await import("../openai");
  if (!hasOpenAIKey) return 0; // fail-open — no key configured, admin can retry later

  const families = await listMotorFamilies();
  const familyKeys = families.filter(f => f.enabled).map(f => f.family_key);

  const systemPrompt = `You classify competitor motor-technology marketing phrases into a fixed taxonomy. For each (brand, term) pair, decide which motor family the term most likely refers to, based ONLY on the term's own wording — never guess from brand reputation. Answer with EXACTLY one of these family keys: ${familyKeys.join(", ")} — or "UNKNOWN" if the term gives no real evidence either way. Return ONLY valid JSON: { "guesses": ["<family_key or UNKNOWN>", ...] } — one entry per pair, in the same order given.`;
  const userPrompt = misses.map((m, i) => `${i + 1}. brand="${m.brand_name}" term="${m.term}"`).join("\n");

  let guesses: string[] = [];
  try {
    const result = await callOpenAiForJson<{ guesses: string[] }>(systemPrompt, userPrompt, "branded motor miss classification", { timeoutMs: 20_000, effort: "low" });
    guesses = Array.isArray(result?.guesses) ? result.guesses : [];
  } catch {
    return 0; // fail-open — leave ai_guessed_family unset, admin can retry
  }

  let updated = 0;
  for (let i = 0; i < misses.length; i++) {
    const guess = guesses[i];
    if (!guess || guess === "UNKNOWN" || !familyKeys.includes(guess)) continue;
    await setBrandedMotorMissAiGuess(misses[i].brand_name, misses[i].term, guess);
    updated++;
  }
  return updated;
}

async function setBrandedMotorMissAiGuess(brandName: string, term: string, aiGuessedFamily: string): Promise<void> {
  if (isSupabaseConfigured) {
    const { error } = await supabaseAdmin
      .from("motor_tech_search_misses")
      .update({ ai_guessed_family: aiGuessedFamily })
      .eq("brand_name", brandName)
      .eq("term", term);
    if (error) throw error;
    return;
  }
  for (const m of memoryDb.motorTechSearchMisses) {
    if (m.brandName === brandName && m.term === term) m.aiGuessedFamily = aiGuessedFamily;
  }
}

// Dismisses every logged row for a (brand, term) pair — called once an
// admin has either added it to branded_motor_names or decided it's not
// worth tracking, so the panel doesn't keep re-surfacing it.
export async function dismissBrandedMotorMiss(brandName: string, term: string): Promise<void> {
  if (isSupabaseConfigured) {
    const { error } = await supabaseAdmin.from("motor_tech_search_misses").delete().eq("brand_name", brandName).eq("term", term);
    if (error) throw error;
    return;
  }
  memoryDb.motorTechSearchMisses = memoryDb.motorTechSearchMisses.filter(m => !(m.brandName === brandName && m.term === term));
}

export async function reorderMotorFamilies(orderedIds: string[]): Promise<void> {
  if (isSupabaseConfigured) {
    for (let i = 0; i < orderedIds.length; i++) {
      const { error } = await supabaseAdmin.from("motor_families").update({ sort_order: i, updated_at: new Date().toISOString() }).eq("id", orderedIds[i]);
      if (error) throw error;
    }
    return;
  }
  orderedIds.forEach((id, i) => {
    const row = memoryDb.motorFamilies.find(f => f.id === id);
    if (row) {
      row.sortOrder = i;
      row.updatedAt = new Date();
    }
  });
}
