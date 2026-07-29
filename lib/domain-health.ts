// lib/domain-health.ts
// Pure aggregation over section_provenance rows tagged
// section="brand_site_discovery" (see lib/brand-site-discovery.ts) into a
// per-brand-domain health rollup for the /dashboard/admin/legacy-brands
// "Domain health" panel. Each provenance row's tiers[] entry names the
// domain actually attempted (tier: the domain string itself) and its
// outcome; product_name carries the brand name. No server-only imports —
// plain aggregation, fully offline-testable.
import type { ProvenanceRow } from "./db/section-provenance";

export interface DomainHealthEntry {
  brandName: string;
  domain: string;
  attempts: number;
  errors: number;
  lastOutcome: "success" | "empty" | "error" | "skipped" | "partial";
  lastAttemptedAt: string;
  // Flagged when the domain has failed (outcome "error") on every one of
  // its last 3+ attempts — a genuinely dead/unreachable domain, not just
  // "no matching product found today" (which is a normal "empty" outcome).
  flagged: boolean;
}

const FLAG_MIN_ATTEMPTS = 3;

export function summarizeDomainHealth(rows: ProvenanceRow[]): DomainHealthEntry[] {
  // Group by (brandName, domain), scanning each row's tiers newest-first
  // (rows are already passed in most-recent-first order by the caller).
  const byKey = new Map<string, { brandName: string; domain: string; outcomes: { outcome: string; at: string }[] }>();

  for (const row of rows) {
    const brandName = row.product_name || "Unknown brand";
    for (const tier of row.tiers || []) {
      if (!tier.attempted) continue;
      const domain = tier.tier;
      const key = `${brandName}::${domain}`;
      const entry = byKey.get(key) || { brandName, domain, outcomes: [] };
      entry.outcomes.push({ outcome: tier.outcome, at: row.resolved_at });
      byKey.set(key, entry);
    }
  }

  const summary: DomainHealthEntry[] = [];
  for (const { brandName, domain, outcomes } of Array.from(byKey.values())) {
    const attempts = outcomes.length;
    const errors = outcomes.filter((o: { outcome: string }) => o.outcome === "error").length;
    const lastN = outcomes.slice(0, Math.min(attempts, FLAG_MIN_ATTEMPTS));
    const flagged = attempts >= FLAG_MIN_ATTEMPTS && lastN.every((o: { outcome: string }) => o.outcome === "error");
    summary.push({
      brandName,
      domain,
      attempts,
      errors,
      lastOutcome: (outcomes[0]?.outcome as DomainHealthEntry["lastOutcome"]) || "empty",
      lastAttemptedAt: outcomes[0]?.at || "",
      flagged,
    });
  }

  return summary.sort((a, b) => (b.flagged ? 1 : 0) - (a.flagged ? 1 : 0) || b.errors - a.errors);
}
