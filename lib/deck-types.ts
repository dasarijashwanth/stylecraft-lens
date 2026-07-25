// Shared types for the "Project Deck" feature — a company .pptx template,
// edited in place (never rebuilt from scratch) with real project data via
// docxtemplater. Plain TS, no server-only imports, so these types are safe
// to import from client components (the admin mapping screen) too.

export type DeckTokenKind = "text" | "image" | "table" | "date";

// Where a token's real value comes from. `unmapped` is the explicit,
// honest state for anything the upload-time parser found in the template
// that isn't in the default registry (lib/deck-field-registry.ts) — the
// mapping screen surfaces these prominently rather than letting them
// silently render blank in a generated deck with no visibility into why.
export type DeckTokenSource =
  | { type: "gtm_field"; field_id: string; split?: "numbered_list"; split_index?: number }
  | { type: "report_field"; path: string }
  | { type: "project_field"; field: string }
  | { type: "snapshot_image"; slot: "hero" }
  | { type: "computed"; name: "generated_date" | "competitor_table" | "feature_list" | "spec_highlights" | "provenance_summary" }
  | { type: "static"; value: string }
  | { type: "unmapped" };

// One occurrence of a token inside the template. `slide_index` is 1-based
// PRESENTATION order (from presentation.xml's <p:sldIdLst>, cross-referenced
// against its .rels) — NOT the raw ppt/slides/slideN.xml file number, since
// reordering slides in PowerPoint desyncs the two.
export interface DeckTokenOccurrence {
  slide_index: number;
  slide_part: string; // e.g. "ppt/slides/slide4.xml"
  location: "text" | "table" | "notes";
}

export interface DeckTokenMapping {
  token: string; // raw token text, no braces, e.g. "product_title"
  kind: DeckTokenKind;
  occurrences: DeckTokenOccurrence[];
  source: DeckTokenSource;
  // Text tokens only — admin-set character budget for the condense-to-fit
  // step (lib/deck-condense.ts). Deliberately admin-entered rather than
  // auto-derived from box geometry/font metrics, which is unreliable.
  max_length?: number;
  // Image tokens only — captured from the shape's real <a:ext> geometry at
  // upload time, used for cover-crop sizing at render time.
  image_box_px?: { width: number; height: number };
  notes?: string;
}

export interface DeckPlaceholderMap {
  version: 1;
  slide_count: number;
  tokens: DeckTokenMapping[];
  unmapped_tokens: string[];
}

export function emptyPlaceholderMap(): DeckPlaceholderMap {
  return { version: 1, slide_count: 0, tokens: [], unmapped_tokens: [] };
}

export type ProjectDeckStatus = "pending" | "generating" | "complete" | "failed";

export interface CompetitorRow {
  name: string;
  brand: string | null;
  tier: string | null;
  price: string | null;
}

export interface DeckImageRef {
  buffer?: Buffer;
  sourceUrl?: string | null;
  targetWidthPx: number;
  targetHeightPx: number;
}

export type DeckValue = string | DeckImageRef | CompetitorRow[];
