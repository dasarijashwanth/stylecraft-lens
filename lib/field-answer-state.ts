// Single, shared source of truth for "is this field answer real, and if
// not, why" — consolidates checks that had independently drifted across
// page.tsx (isFieldComplete/isTdsFieldComplete), lib/db/documents.ts
// (flattenDocumentFields), and several API routes, each reimplementing its
// own "answer !== N/A" logic. Every consumer should use these predicates
// instead of re-deriving them, so a new terminal state (see
// lib/field-finalize.ts) only ever needs to be taught here once.
//
// Deliberately a leaf module — no imports from lib/gtm-generate.ts or
// lib/tds-generate.ts, so those (and lib/field-finalize.ts, which both
// import) can safely import the sentinel constants from here without a
// circular dependency.

// TDS's own "nothing captured for this field" sentinel — canonical home
// moved here; lib/tds-generate.ts re-exports it for backward compatibility.
export const TDS_NOT_LISTED = "Not listed on product page";

// The two new honest terminal states (see lib/field-finalize.ts) that
// replace bare "N/A"/"TBD" once every applicable tier has genuinely run.
export const NOT_DETERMINABLE_PREFIX = "Not determinable — ";
export const AWAITING_INTERNAL_INPUT = "Awaiting internal input";

function isPlaceholder(trimmed: string): boolean {
  const upper = trimmed.toUpperCase();
  if (upper === "N/A" || upper === "TBD") return true;
  if (trimmed === TDS_NOT_LISTED) return true;
  if (trimmed === AWAITING_INTERNAL_INPUT) return true;
  if (trimmed.startsWith(NOT_DETERMINABLE_PREFIX)) return true;
  return false;
}

// True only for a genuine, displayable fact — never a placeholder/sentinel
// of any kind (legacy N/A/TBD, TDS's not-listed string, or either of the
// two new finalize terminal states).
export function isRealAnswer(answer: string | null | undefined): boolean {
  const trimmed = (answer ?? "").toString().trim();
  if (!trimmed) return false;
  return !isPlaceholder(trimmed);
}

export function isNotDeterminable(answer: string | null | undefined): boolean {
  return (answer ?? "").toString().trim().startsWith(NOT_DETERMINABLE_PREFIX);
}

export function isAwaitingInternalInput(answer: string | null | undefined): boolean {
  return (answer ?? "").toString().trim() === AWAITING_INTERNAL_INPUT;
}

export interface FillReportEntry {
  answer?: string | null;
  source?: string | null;
}

export interface FillReportSchemaField {
  id: string;
}

export interface FillReport {
  total: number;
  filled: number;
  // Keyed by the field's `source` tag (project_record/sales_kit/tds/
  // active_report/web/multiple/derived/category_default/amazon/
  // product_snapshot/official_site/manual_edit/gtm_cross_fill/etc.) —
  // deliberately open-ended rather than a fixed union, since GTM and TDS
  // each have their own source vocabularies.
  bySource: Record<string, number>;
  awaitingInternalInput: number;
  notDeterminable: number;
}

// Computed fresh on every read (never frozen at generation time), so a
// manual edit or a later reconciliation pass is reflected immediately
// without needing to regenerate anything.
export function buildFillReport(
  fields: Record<string, FillReportEntry | undefined>,
  schema: FillReportSchemaField[]
): FillReport {
  const bySource: Record<string, number> = {};
  let filled = 0;
  let awaitingInternalInput = 0;
  let notDeterminable = 0;

  for (const f of schema) {
    const answer = fields[f.id]?.answer ?? "";
    if (isAwaitingInternalInput(answer)) {
      awaitingInternalInput++;
      continue;
    }
    if (isNotDeterminable(answer)) {
      notDeterminable++;
      continue;
    }
    if (isRealAnswer(answer)) {
      filled++;
      const source = fields[f.id]?.source || "none";
      bySource[source] = (bySource[source] || 0) + 1;
    }
  }

  return { total: schema.length, filled, bySource, awaitingInternalInput, notDeterminable };
}
