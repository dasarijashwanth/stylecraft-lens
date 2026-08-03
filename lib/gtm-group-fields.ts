// lib/gtm-group-fields.ts
// Shared helper for GTM Schema v3's repeatable-row groups (Features (full
// list), Cross Sell Products, Top 6 Features, 6 Icons — see
// lib/gtm-field-schema.ts's groupFields) — trims trailing empty rows from
// CSV/PDF exports (default: trim, per spec) while the live UI still shows
// every row up to the group's total so an admin can add more. Row 1 of a
// group is always kept even when empty, so an entirely-unfilled group isn't
// invisible in the export.
import { GtmField } from "./gtm-field-schema";
import { isRealAnswer } from "./field-answer-state";

export function filterTrailingEmptyGroupRows(schema: GtmField[], getAnswer: (fieldId: string) => string | null | undefined): GtmField[] {
  const lastRealIndexByGroup = new Map<string, number>();
  for (const f of schema) {
    if (!f.group) continue;
    if (isRealAnswer(getAnswer(f.id))) {
      const current = lastRealIndexByGroup.get(f.group.id) ?? 0;
      if (f.group.index > current) lastRealIndexByGroup.set(f.group.id, f.group.index);
    }
  }

  return schema.filter(f => {
    if (!f.group) return true;
    const lastReal = lastRealIndexByGroup.get(f.group.id) ?? 0;
    return f.group.index === 1 || f.group.index <= lastReal;
  });
}
