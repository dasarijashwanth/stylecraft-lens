"use client";

import { useEffect, useState } from "react";
import { ShieldAlert, Plus, X, Loader2, ArrowUp, ArrowDown } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/hooks/useAuth";
import { Spinner } from "@/components/ui/Spinner";

interface Brand {
  id: string;
  category_id: string;
  brand_name: string;
  aliases: string[];
  enabled: boolean;
  sort_order: number;
}

interface Category {
  id: string;
  slug: string;
  name: string;
  product_types: string[];
  audience: string | null;
  brands: Brand[];
}

export default function LegacyBrandsAdminPage() {
  const { user, loading: authLoading } = useAuth();
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [newBrandText, setNewBrandText] = useState<Record<string, string>>({});
  const [busyBrandId, setBusyBrandId] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/legacy-brands");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to load registry");
      setCategories(data.categories || []);
    } catch (err: any) {
      setError(err.message || "Failed to load registry");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (user && (user.role === "OWNER" || user.role === "ADMIN")) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  // Shorthand: "Hot Tools (Hot Tools Professional, HT Pro)" adds a brand
  // with aliases in one line, matching the spec's "include brand aliases
  // for search/matching" requirement without a separate aliases field.
  async function handleAddBrand(categoryId: string) {
    const text = (newBrandText[categoryId] || "").trim();
    if (!text) return;
    const match = text.match(/^(.+?)\s*\(([^)]+)\)\s*$/);
    const brandName = match ? match[1].trim() : text;
    const aliases = match ? match[2].split(",").map(a => a.trim()).filter(Boolean) : [];

    try {
      const res = await fetch(`/api/admin/legacy-brands/${categoryId}/brands`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ brandName, aliases }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to add brand");
      setNewBrandText(prev => ({ ...prev, [categoryId]: "" }));
      toast.success(`Added ${brandName}`);
      await load();
    } catch (err: any) {
      toast.error(err.message || "Failed to add brand");
    }
  }

  async function handleToggleEnabled(categoryId: string, brand: Brand) {
    setBusyBrandId(brand.id);
    try {
      const res = await fetch(`/api/admin/legacy-brands/${categoryId}/brands/${brand.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: !brand.enabled }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to update brand");
      await load();
    } catch (err: any) {
      toast.error(err.message || "Failed to update brand");
    } finally {
      setBusyBrandId(null);
    }
  }

  async function handleRemoveBrand(categoryId: string, brandId: string) {
    setBusyBrandId(brandId);
    try {
      const res = await fetch(`/api/admin/legacy-brands/${categoryId}/brands/${brandId}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to remove brand");
      await load();
    } catch (err: any) {
      toast.error(err.message || "Failed to remove brand");
    } finally {
      setBusyBrandId(null);
    }
  }

  async function handleMove(categoryId: string, brands: Brand[], index: number, direction: -1 | 1) {
    const targetIndex = index + direction;
    if (targetIndex < 0 || targetIndex >= brands.length) return;
    const reordered = [...brands];
    [reordered[index], reordered[targetIndex]] = [reordered[targetIndex], reordered[index]];

    try {
      const res = await fetch(`/api/admin/legacy-brands/${categoryId}/reorder`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderedIds: reordered.map(b => b.id) }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to reorder");
      await load();
    } catch (err: any) {
      toast.error(err.message || "Failed to reorder");
    }
  }

  if (authLoading) {
    return (
      <div className="flex items-center justify-center min-h-[300px]">
        <Spinner size="lg" className="text-accent" />
      </div>
    );
  }

  if (!user || (user.role !== "OWNER" && user.role !== "ADMIN")) {
    return (
      <div className="max-w-md mx-auto mt-16 text-center space-y-3">
        <ShieldAlert className="w-8 h-8 mx-auto text-text-muted" />
        <h1 className="text-sm font-bold text-text-primary">Not authorized</h1>
        <p className="text-xs text-text-muted">This page is restricted to workspace owners/admins.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <ShieldAlert className="w-5 h-5 text-accent" />
        <h1 className="text-display">Legacy Brands</h1>
      </div>
      <p className="text-xs text-text-muted -mt-4">
        Curated brand lists competitor discovery searches directly for the 5 &quot;legacy/established&quot; slots, in priority order, before ever falling back to AI judgment. Disabling a brand keeps it in the list but skips it in discovery; the arrows change search priority. Changes apply to future analyses only — each analysis snapshots the exact list it used.
      </p>

      {loading ? (
        <div className="p-8 text-center text-text-muted text-xs">Loading…</div>
      ) : error ? (
        <div className="p-8 text-center text-danger text-xs">{error}</div>
      ) : (
        <div className="space-y-5">
          {categories.map(category => (
            <div key={category.id} className="border border-border rounded-xl overflow-hidden">
              <div className="px-4 py-3 bg-surface-3/30 border-b border-border">
                <h2 className="text-xs font-bold text-text-primary">{category.name}</h2>
                <p className="text-[10px] text-text-muted">
                  {category.audience === "professional" ? "Professional" : "Retail"} · {category.brands.filter(b => b.enabled).length} enabled
                </p>
              </div>
              <div className="p-4 space-y-2">
                {category.brands.map((brand, i) => (
                  <div
                    key={brand.id}
                    className={`flex items-center gap-2 px-3 py-2 rounded-lg border ${
                      brand.enabled ? "border-border bg-surface-1" : "border-border/50 bg-surface-3/20 opacity-60"
                    }`}
                  >
                    <div className="flex flex-col -my-1">
                      <button
                        type="button"
                        onClick={() => handleMove(category.id, category.brands, i, -1)}
                        disabled={i === 0}
                        className="p-0.5 text-text-muted hover:text-text-primary disabled:opacity-30"
                      >
                        <ArrowUp className="w-3 h-3" />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleMove(category.id, category.brands, i, 1)}
                        disabled={i === category.brands.length - 1}
                        className="p-0.5 text-text-muted hover:text-text-primary disabled:opacity-30"
                      >
                        <ArrowDown className="w-3 h-3" />
                      </button>
                    </div>
                    <div className="flex-1 min-w-0">
                      <span className="text-xs font-semibold text-text-primary">{brand.brand_name}</span>
                      {brand.aliases.length > 0 && (
                        <span className="ml-2 text-[10px] text-text-muted">aka {brand.aliases.join(", ")}</span>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => handleToggleEnabled(category.id, brand)}
                      disabled={busyBrandId === brand.id}
                      className={`px-2 py-0.5 rounded text-[10px] font-bold border transition-colors ${
                        brand.enabled ? "border-success/30 text-success bg-success/10" : "border-border text-text-muted"
                      }`}
                    >
                      {brand.enabled ? "Enabled" : "Disabled"}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleRemoveBrand(category.id, brand.id)}
                      disabled={busyBrandId === brand.id}
                      className="p-1 text-text-muted hover:text-danger transition-colors"
                      title="Remove brand"
                    >
                      {busyBrandId === brand.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <X className="w-3.5 h-3.5" />}
                    </button>
                  </div>
                ))}
                <div className="flex items-center gap-2 pt-1">
                  <input
                    type="text"
                    value={newBrandText[category.id] || ""}
                    onChange={e => setNewBrandText(prev => ({ ...prev, [category.id]: e.target.value }))}
                    onKeyDown={e => e.key === "Enter" && handleAddBrand(category.id)}
                    placeholder='Add a brand — e.g. "GHD" or "Hot Tools (Hot Tools Professional)"'
                    className="flex-1 px-2.5 py-1.5 text-[11px] border border-border rounded-lg bg-surface-1 text-text-primary outline-none focus:border-accent"
                  />
                  <button
                    type="button"
                    onClick={() => handleAddBrand(category.id)}
                    className="flex items-center gap-1 px-2.5 py-1.5 bg-accent hover:bg-accent-hover text-white text-[11px] font-bold rounded-lg transition-colors"
                  >
                    <Plus className="w-3.5 h-3.5" /> Add
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
