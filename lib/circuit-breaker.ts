// Per-provider circuit breaker (supabase_schema.sql's provider_circuit_state
// table + record_provider_result RPC). Trips after 5 consecutive failures,
// auto-resets 60s after opening — a read-time check, not a cron, since
// Postgres has no built-in "expire after N seconds."
//
// Uses a Postgres RPC rather than a plain read-then-write because many
// concurrent Inngest step invocations across DIFFERENT users' jobs race to
// update the same provider row; a naive read-then-write would lose updates
// under real concurrency and silently under-count failures, defeating the
// breaker (this is genuinely new territory for this codebase — every other
// cache/state table here tolerates a lost update, this one can't).
import { isSupabaseConfigured, supabaseAdmin } from "@/lib/supabase";

export type ProviderName = "rainforest" | "openai_web_search" | "openai_json" | "gemini";

const OPEN_WINDOW_MS = 60_000;

export async function recordProviderResult(provider: ProviderName, success: boolean): Promise<void> {
  if (!isSupabaseConfigured) return;
  try {
    const { error } = await supabaseAdmin.rpc("record_provider_result", { p_provider: provider, p_success: success });
    if (error) throw error;
  } catch (err) {
    console.warn(`circuit-breaker: failed to record result for ${provider}:`, err);
  }
}

// True only while the breaker is genuinely open (tripped AND still within
// the 60s pause window) — once the window elapses this returns false again
// (a half-open probe), letting the next call attempt the provider and
// record a fresh success/failure via recordProviderResult.
export async function isProviderOpen(provider: ProviderName): Promise<boolean> {
  if (!isSupabaseConfigured) return false;
  try {
    const { data, error } = await supabaseAdmin
      .from("provider_circuit_state")
      .select("state, opened_at")
      .eq("provider", provider)
      .maybeSingle();
    if (error) throw error;
    if (!data || data.state !== "open" || !data.opened_at) return false;
    return Date.now() - new Date(data.opened_at).getTime() < OPEN_WINDOW_MS;
  } catch (err) {
    console.warn(`circuit-breaker: failed to check state for ${provider}:`, err);
    return false;
  }
}
