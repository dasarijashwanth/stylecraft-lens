// lib/content-form-field-schema.ts
// The "Content Form" tab's field inventory — a Product Detail Page content
// sheet (Amazon/website titles, taglines, bullets, keywords), stored via the
// SAME field-granular documents/document_fields model GTM/TDS already use
// (doc_type="content_form"), giving it identical autosave/history/badge UX
// for free. Mirrors lib/gtm-field-schema.ts's own GtmField/field()/
// groupFields() shape — duplicated locally rather than importing from that
// GTM-specific file, matching this repo's own established precedent for
// small shared helpers (e.g. withDeadline/mapWithConcurrency are each
// duplicated per-file rather than centralized) to avoid a dependency back
// into a schema file that isn't conceptually about this tab.
export type ContentFormFieldKind = "written";

export interface ContentFormField {
  id: string;
  section: string;
  question: string;
  kind: ContentFormFieldKind;
  owner: string;
  // Hard character cap (Short Description/Features & Benefits/Suggested
  // Use/Romance Copy) — enforced with a live counter in the UI and a
  // save-time guard that blocks persisting an over-limit answer.
  charLimit?: number;
  group?: { id: string; index: number; total: number };
}

function field(id: string, section: string, question: string, extra?: { charLimit?: number }): ContentFormField {
  return { id, section, question, kind: "written", owner: "Product Marketing", ...extra };
}

function groupFields(idPrefix: string, section: string, rowLabel: string, total: number): ContentFormField[] {
  return Array.from({ length: total }, (_, i) => {
    const index = i + 1;
    return { ...field(`${idPrefix}_${index}`, section, `${rowLabel} #${index}`), group: { id: idPrefix, index, total } };
  });
}

export const CONTENT_FORM_SCHEMA: ContentFormField[] = [
  field("amazon_long_title", "Titles", "Amazon Long Title – Don't use \"size\" if SKU has variants (E-COMMERCE ONLY)"),
  field("ecommerce_title", "Titles", "E-commerce Title (E-commerce Only)"),
  field("website_title", "Titles", "Website Title – Don't use \"size\" if SKU has variants (E-COMMERCE ONLY)"),
  field("sexy_tagline", "Taglines", "Tagline/Headline - Sexy"),
  field("techie_tagline", "Taglines", "Tagline/Headline - Techie"),
  field("short_description", "Descriptions", "Short Description (229 characters or less, including spaces)", { charLimit: 229 }),
  field("features_benefits", "Descriptions", "Features & Benefits (115 characters or less, including spaces)", { charLimit: 115 }),
  field("suggested_use", "Descriptions", "Suggested Use (200 characters or less, including spaces)", { charLimit: 200 }),
  field("romance_copy", "Descriptions", "Description (romance copy) 2,000 Character Limit", { charLimit: 2000 }),
  ...groupFields("bullet_top3", "Bullet Points", "Consumer Facing Feature Bullets - TOP 3", 3),
  ...groupFields("bullet_long", "Bullet Points", "Consumer Facing Feature Bullets - LONG", 6),
  ...groupFields("bullet_condensed", "Bullet Points", "Consumer Facing Feature Bullets - CONDENSED", 6),
  field("ad_sheet_headline", "Ad Sheet", "Ad Sheet Headline"),
  field("ad_sheet_sub_header", "Ad Sheet", "Ad Sheet Sub Header"),
  ...groupFields("website_copy_short", "Website Copy Block", "Feature Bullets Top 3 For Web (Short Version)", 3),
  ...groupFields("website_copy_long", "Website Copy Block", "Feature Bullets For Hot Spot Content (Long Version)", 3),
  field("keywords", "Keywords", "Keyword Search Terms - no repeat words, comp brands"),
];

export const CONTENT_FORM_SECTIONS = Array.from(new Set(CONTENT_FORM_SCHEMA.map(f => f.section)));

export interface ContentFormAnswer {
  answer: string;
  source: string;
  sourceDetail?: any;
  flagged?: boolean;
  notes?: string;
}
