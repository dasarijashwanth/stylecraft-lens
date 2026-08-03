"use client";

// components/analyze/ComparisonChartPicker.tsx
// GTM's "Comparison Chart WEB ONLY" field control (Change 5) — a dedicated
// two-slot picker instead of a plain textarea, since a free-text field can't
// reliably capture "exactly two products, each with a real SKU, searchable
// across BOTH StyleCraft and Gamma+". Modeled on the analyze form's own
// catalog card-grid picker (app/(app)/dashboard/analyze/page.tsx) — same
// search input + filtered card list pattern, just two independent slots.
import { useEffect, useMemo, useState } from "react";
import { Search, X, Package } from "lucide-react";

export interface ComparisonChartSlot {
  name: string;
  brand: string;
  sku: string | null;
}

interface CatalogProductOption {
  id: string;
  name: string;
  brand: string | null;
  sku: string | null;
  tool_type: string;
  target_price: number | null;
}

export function renderComparisonChartAnswer(slots: (ComparisonChartSlot | null)[]): string {
  return slots
    .map((slot, i) => (slot ? `${i + 1}. ${slot.name} (${slot.brand}) — SKU ${slot.sku || "—"}` : null))
    .filter(Boolean)
    .join("\n");
}

export function ComparisonChartPicker({
  slots: initialSlots,
  onSave,
}: {
  slots: (ComparisonChartSlot | null)[];
  onSave: (answer: string, slots: (ComparisonChartSlot | null)[]) => void;
}) {
  const [products, setProducts] = useState<CatalogProductOption[]>([]);
  const [slots, setSlots] = useState<(ComparisonChartSlot | null)[]>([initialSlots[0] ?? null, initialSlots[1] ?? null]);
  const [openSlot, setOpenSlot] = useState<0 | 1 | null>(null);
  const [search, setSearch] = useState("");

  useEffect(() => {
    fetch("/api/catalog-products")
      .then(r => r.json())
      .then(d => setProducts(d.products || []))
      .catch(() => {});
  }, []);

  useEffect(() => {
    setSlots([initialSlots[0] ?? null, initialSlots[1] ?? null]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialSlots[0]?.sku, initialSlots[0]?.name, initialSlots[1]?.sku, initialSlots[1]?.name]);

  const filtered = useMemo(() => {
    const otherSlotName = openSlot === 0 ? slots[1]?.name : slots[0]?.name;
    return products
      .filter(p => p.name !== otherSlotName)
      .filter(p => !search.trim() || p.name.toLowerCase().includes(search.trim().toLowerCase()));
  }, [products, search, openSlot, slots]);

  function selectProduct(slotIndex: 0 | 1, p: CatalogProductOption) {
    const next: (ComparisonChartSlot | null)[] = [...slots];
    next[slotIndex] = { name: p.name, brand: p.brand || "StyleCraft", sku: p.sku };
    setSlots(next);
    setOpenSlot(null);
    setSearch("");
    onSave(renderComparisonChartAnswer(next), next);
  }

  function clearSlot(slotIndex: 0 | 1) {
    const next: (ComparisonChartSlot | null)[] = [...slots];
    next[slotIndex] = null;
    setSlots(next);
    onSave(renderComparisonChartAnswer(next), next);
  }

  return (
    <div className="space-y-2">
      {[0, 1].map(i => {
        const slotIndex = i as 0 | 1;
        const slot = slots[slotIndex];
        return (
          <div key={i} className="space-y-1.5">
            {slot ? (
              <div className="flex items-center justify-between gap-2 px-2.5 py-1.5 border border-border rounded-lg bg-surface-1 text-[11px]">
                <div className="flex items-center gap-1.5 min-w-0">
                  <Package className="w-3 h-3 text-accent shrink-0" />
                  <span className="font-semibold text-text-primary truncate">{i + 1}. {slot.name}</span>
                  <span className="text-text-muted shrink-0">({slot.brand}) — SKU {slot.sku || "—"}</span>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button type="button" onClick={() => setOpenSlot(openSlot === slotIndex ? null : slotIndex)} className="text-[9px] font-bold text-accent hover:text-accent-hover">
                    Change
                  </button>
                  <button type="button" onClick={() => clearSlot(slotIndex)} className="p-0.5 text-text-muted hover:text-danger">
                    <X className="w-3 h-3" />
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setOpenSlot(openSlot === slotIndex ? null : slotIndex)}
                className="w-full px-2.5 py-1.5 border border-dashed border-border rounded-lg text-[11px] text-text-muted hover:border-accent/40 hover:text-accent text-left"
              >
                + Select product {i + 1}…
              </button>
            )}

            {openSlot === slotIndex && (
              <div className="border border-accent/30 rounded-lg p-2 bg-surface-2 space-y-1.5">
                <div className="relative">
                  <Search className="w-3 h-3 text-text-muted absolute left-2 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    autoFocus
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    placeholder="Search StyleCraft or Gamma+ products…"
                    className="w-full pl-6 pr-2 py-1 border border-border rounded bg-surface-1 text-text-primary outline-none focus:border-accent text-[10px]"
                  />
                </div>
                <div className="max-h-40 overflow-y-auto space-y-0.5">
                  {filtered.length === 0 && <p className="text-[10px] text-text-muted text-center py-2">No matches</p>}
                  {filtered.map(p => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => selectProduct(slotIndex, p)}
                      className="w-full flex items-center justify-between gap-2 px-2 py-1 rounded text-left text-[10px] hover:bg-surface-3"
                    >
                      <span className="font-semibold text-text-primary truncate">{p.name}</span>
                      <span className="text-text-muted shrink-0">{p.brand || "StyleCraft"}{p.sku ? ` — SKU ${p.sku}` : ""}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
