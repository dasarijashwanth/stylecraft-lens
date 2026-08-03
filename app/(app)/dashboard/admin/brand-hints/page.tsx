"use client";

import { useEffect, useState } from "react";
import { ShieldAlert, Plus, Loader2, Pencil, Check, Trash2, Tag } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/hooks/useAuth";
import { Spinner } from "@/components/ui/Spinner";

interface BrandNameHint {
  id: string;
  brand: string;
  name_prefixes: string[];
  enabled: boolean;
  sort_order: number;
}

function splitPrefixes(text: string): string[] {
  return text.split(",").map(s => s.trim()).filter(Boolean);
}

export default function BrandHintsAdminPage() {
  const { user, loading: authLoading } = useAuth();
  const [hints, setHints] = useState<BrandNameHint[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editBrand, setEditBrand] = useState("");
  const [editPrefixes, setEditPrefixes] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);

  const [showAdd, setShowAdd] = useState(false);
  const [addBrand, setAddBrand] = useState("");
  const [addPrefixes, setAddPrefixes] = useState("");
  const [adding, setAdding] = useState(false);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/brand-hints");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to load brand name hints");
      setHints(data.hints || []);
    } catch (err: any) {
      setError(err.message || "Failed to load brand name hints");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (user && (user.role === "OWNER" || user.role === "ADMIN")) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  function startEdit(h: BrandNameHint) {
    setEditingId(h.id);
    setEditBrand(h.brand);
    setEditPrefixes(h.name_prefixes.join(", "));
  }

  async function saveEdit() {
    if (!editingId) return;
    setBusyId(editingId);
    try {
      const res = await fetch(`/api/admin/brand-hints/${editingId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ brand: editBrand.trim(), namePrefixes: splitPrefixes(editPrefixes) }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to update hint");
      toast.success("Brand hint updated");
      setEditingId(null);
      await load();
    } catch (err: any) {
      toast.error(err.message || "Failed to update hint");
    } finally {
      setBusyId(null);
    }
  }

  async function toggleEnabled(h: BrandNameHint) {
    setBusyId(h.id);
    try {
      const res = await fetch(`/api/admin/brand-hints/${h.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: !h.enabled }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to update hint");
      await load();
    } catch (err: any) {
      toast.error(err.message || "Failed to update hint");
    } finally {
      setBusyId(null);
    }
  }

  async function handleDelete(h: BrandNameHint) {
    setBusyId(h.id);
    try {
      const res = await fetch(`/api/admin/brand-hints/${h.id}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to delete hint");
      toast.success(`Removed "${h.brand}"`);
      await load();
    } catch (err: any) {
      toast.error(err.message || "Failed to delete hint");
    } finally {
      setBusyId(null);
    }
  }

  async function handleAdd() {
    if (!addBrand.trim()) {
      toast.error("Brand is required");
      return;
    }
    setAdding(true);
    try {
      const res = await fetch("/api/admin/brand-hints", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ brand: addBrand.trim(), namePrefixes: splitPrefixes(addPrefixes) }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to add hint");
      toast.success(`Added "${data.hint.brand}"`);
      setAddBrand("");
      setAddPrefixes("");
      setShowAdd(false);
      await load();
    } catch (err: any) {
      toast.error(err.message || "Failed to add hint");
    } finally {
      setAdding(false);
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
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Tag className="w-5 h-5 text-accent" />
          <h1 className="text-display">Brand Name Hints</h1>
        </div>
        <button type="button" onClick={() => setShowAdd(v => !v)} className="flex items-center gap-1 px-2.5 py-1.5 bg-accent hover:bg-accent-hover text-white text-[11px] font-bold rounded-lg">
          <Plus className="w-3.5 h-3.5" /> Add brand
        </button>
      </div>
      <p className="text-xs text-text-muted -mt-4">
        Name-prefix hints GTM&apos;s Manufacturer auto-detect cascade falls back to when a product isn&apos;t linked to a Product Catalog record — e.g. a product name starting with &quot;Saber&quot; is detected as StyleCraft. Checked in this priority order, top to bottom.
      </p>

      {showAdd && (
        <div className="border border-accent/30 bg-surface-2 rounded-xl p-4 space-y-3">
          <h2 className="text-xs font-bold text-text-primary">Add brand</h2>
          <div className="grid grid-cols-1 gap-3">
            <input type="text" placeholder="Brand (e.g. StyleCraft)" value={addBrand} onChange={e => setAddBrand(e.target.value)} className="px-2.5 py-1.5 text-[11px] border border-border rounded-lg bg-surface-1 text-text-primary outline-none focus:border-accent" />
            <input type="text" placeholder="Name prefixes, comma-separated (e.g. Saber, Anime, Protege)" value={addPrefixes} onChange={e => setAddPrefixes(e.target.value)} className="px-2.5 py-1.5 text-[11px] border border-border rounded-lg bg-surface-1 text-text-primary outline-none focus:border-accent" />
          </div>
          <div className="flex items-center gap-2">
            <button type="button" onClick={handleAdd} disabled={adding} className="flex items-center gap-1 px-2.5 py-1.5 bg-accent hover:bg-accent-hover text-white text-[11px] font-bold rounded-lg disabled:opacity-50">
              {adding ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />} Add
            </button>
            <button type="button" onClick={() => { setShowAdd(false); setAddBrand(""); setAddPrefixes(""); }} className="px-2.5 py-1.5 text-[11px] text-text-muted hover:text-danger">Cancel</button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="p-8 text-center text-text-muted text-xs">Loading…</div>
      ) : error ? (
        <div className="p-8 text-center text-danger text-xs">{error}</div>
      ) : (
        <div className="border border-border rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-[11px]">
              <thead>
                <tr className="border-b border-border/60 bg-surface-3/20 text-text-muted uppercase text-[9px] font-bold">
                  <th className="p-2.5">Brand</th>
                  <th className="p-2.5">Name Prefixes</th>
                  <th className="p-2.5">Status</th>
                  <th className="p-2.5"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/40">
                {hints.map(h => {
                  const isEditing = editingId === h.id;
                  return (
                    <tr key={h.id} className={h.enabled ? "" : "opacity-50"}>
                      {isEditing ? (
                        <td className="p-2.5" colSpan={4}>
                          <div className="grid grid-cols-1 gap-2 p-2 bg-surface-3/20 rounded-lg">
                            <input type="text" value={editBrand} onChange={e => setEditBrand(e.target.value)} className="px-2 py-1 border border-border rounded bg-surface-1" />
                            <input type="text" value={editPrefixes} onChange={e => setEditPrefixes(e.target.value)} placeholder="Name prefixes, comma-separated" className="px-2 py-1 border border-border rounded bg-surface-1" />
                            <div className="flex items-center gap-2">
                              <button type="button" onClick={saveEdit} disabled={busyId === h.id} className="flex items-center gap-1 px-2.5 py-1 bg-accent hover:bg-accent-hover text-white text-[10px] font-bold rounded">
                                {busyId === h.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />} Save
                              </button>
                              <button type="button" onClick={() => setEditingId(null)} className="px-2.5 py-1 text-[10px] text-text-muted hover:text-danger">Cancel</button>
                            </div>
                          </div>
                        </td>
                      ) : (
                        <>
                          <td className="p-2.5 font-semibold text-text-primary">{h.brand}</td>
                          <td className="p-2.5 text-text-secondary">
                            {h.name_prefixes.length === 0 ? <span className="text-text-muted">—</span> : h.name_prefixes.join(", ")}
                          </td>
                          <td className="p-2.5">
                            <button
                              type="button"
                              onClick={() => toggleEnabled(h)}
                              disabled={busyId === h.id}
                              className={`px-2 py-0.5 rounded text-[10px] font-bold border ${h.enabled ? "border-success/30 text-success bg-success/10" : "border-border text-text-muted"}`}
                            >
                              {h.enabled ? "Enabled" : "Disabled"}
                            </button>
                          </td>
                          <td className="p-2.5 text-right">
                            <div className="flex items-center justify-end gap-1">
                              <button type="button" onClick={() => startEdit(h)} className="p-1 text-text-muted hover:text-accent" title="Edit">
                                <Pencil className="w-3.5 h-3.5" />
                              </button>
                              <button type="button" onClick={() => handleDelete(h)} disabled={busyId === h.id} className="p-1 text-text-muted hover:text-danger" title="Delete">
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </td>
                        </>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
