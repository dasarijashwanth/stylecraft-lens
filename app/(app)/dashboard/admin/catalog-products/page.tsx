"use client";

import { useEffect, useState } from "react";
import { ShieldAlert, Plus, X, Loader2, Pencil, Check, AlertTriangle, Package, Upload } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/hooks/useAuth";
import { Spinner } from "@/components/ui/Spinner";

interface CatalogProduct {
  id: string;
  name: string;
  industry: string;
  target_market: string;
  tool_type: string;
  target_price: number | null;
  description: string | null;
  motor_family: string | null;
  motor_branded: string | null;
  heat_tech_family: string | null;
  heat_tech_branded: string | null;
  active: boolean;
  import_flags: string[];
  source: string;
}

interface ToolTypeOption {
  type_key: string;
  label: string;
  primary_criterion: "motor" | "heat_technology" | "none";
}

interface FamilyOption {
  family_key: string;
  label: string;
}

const INDUSTRY_LABELS: Record<string, string> = { "grooming-barbering": "Grooming & Barbering", "haircare-styling": "Hair Care & Styling" };
const MARKET_LABELS: Record<string, string> = { pro: "Pro / Salon", consumer: "Retail", both: "Both" };
const FLAG_LABELS: Record<string, string> = {
  incomplete: "Incomplete",
  tool_type_needs_review: "Tool type needs review",
  motor_needs_confirmation: "Motor needs confirmation",
  heat_tech_needs_confirmation: "Heat/plate tech needs confirmation",
};

type Draft = Partial<CatalogProduct>;

function emptyDraft(): Draft {
  return { name: "", industry: "grooming-barbering", target_market: "pro", tool_type: "", target_price: null, description: "", motor_family: null, motor_branded: null, heat_tech_family: null, heat_tech_branded: null };
}

interface ImportDiffRow {
  row: any;
  existingId?: string;
  changedFields?: string[];
}

export default function CatalogProductsAdminPage() {
  const { user, loading: authLoading } = useAuth();
  const [products, setProducts] = useState<CatalogProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [toolTypes, setToolTypes] = useState<ToolTypeOption[]>([]);
  const [motorFamilies, setMotorFamilies] = useState<FamilyOption[]>([]);
  const [heatTechFamilies, setHeatTechFamilies] = useState<FamilyOption[]>([]);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<Draft>({});
  const [busyId, setBusyId] = useState<string | null>(null);

  const [showAdd, setShowAdd] = useState(false);
  const [addDraft, setAddDraft] = useState<Draft>(emptyDraft());
  const [adding, setAdding] = useState(false);

  const [showImport, setShowImport] = useState(false);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [importDiff, setImportDiff] = useState<{ new: ImportDiffRow[]; changed: ImportDiffRow[]; unchanged: ImportDiffRow[]; missingFromFile: { id: string; name: string }[] } | null>(null);
  const [selectedRows, setSelectedRows] = useState<Set<number>>(new Set());
  const [confirming, setConfirming] = useState(false);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/catalog-products");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to load catalog products");
      setProducts(data.products || []);
    } catch (err: any) {
      setError(err.message || "Failed to load catalog products");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (user && (user.role === "OWNER" || user.role === "ADMIN")) {
      load();
      fetch("/api/tool-types").then(r => r.json()).then(d => setToolTypes(d.toolTypes || [])).catch(() => {});
      fetch("/api/motor-families").then(r => r.json()).then(d => setMotorFamilies(d.families || [])).catch(() => {});
      fetch("/api/heat-tech-families").then(r => r.json()).then(d => setHeatTechFamilies(d.families || [])).catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  function toolTypeLabel(key: string) {
    return toolTypes.find(t => t.type_key === key)?.label || key;
  }
  function criterionFor(key: string): "motor" | "heat_technology" | "none" {
    return toolTypes.find(t => t.type_key === key)?.primary_criterion || "motor";
  }

  function startEdit(p: CatalogProduct) {
    setEditingId(p.id);
    setEditDraft({ ...p });
  }

  async function saveEdit() {
    if (!editingId) return;
    setBusyId(editingId);
    try {
      const res = await fetch(`/api/admin/catalog-products/${editingId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: editDraft.name,
          industry: editDraft.industry,
          targetMarket: editDraft.target_market,
          toolType: editDraft.tool_type,
          targetPrice: editDraft.target_price,
          description: editDraft.description,
          motorFamily: criterionFor(editDraft.tool_type || "") === "motor" ? editDraft.motor_family : null,
          motorBranded: criterionFor(editDraft.tool_type || "") === "motor" ? editDraft.motor_branded : null,
          heatTechFamily: criterionFor(editDraft.tool_type || "") === "heat_technology" ? editDraft.heat_tech_family : null,
          heatTechBranded: criterionFor(editDraft.tool_type || "") === "heat_technology" ? editDraft.heat_tech_branded : null,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to update product");
      toast.success("Product updated");
      setEditingId(null);
      await load();
    } catch (err: any) {
      toast.error(err.message || "Failed to update product");
    } finally {
      setBusyId(null);
    }
  }

  async function toggleActive(p: CatalogProduct) {
    setBusyId(p.id);
    try {
      const res = await fetch(`/api/admin/catalog-products/${p.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: p.active ? "deactivate" : "reactivate" }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to update product");
      await load();
    } catch (err: any) {
      toast.error(err.message || "Failed to update product");
    } finally {
      setBusyId(null);
    }
  }

  async function handleAdd() {
    if (!addDraft.name?.trim() || !addDraft.tool_type) {
      toast.error("Name and tool type are required");
      return;
    }
    setAdding(true);
    try {
      const criterion = criterionFor(addDraft.tool_type);
      const res = await fetch("/api/admin/catalog-products", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: addDraft.name.trim(),
          industry: addDraft.industry,
          targetMarket: addDraft.target_market,
          toolType: addDraft.tool_type,
          targetPrice: addDraft.target_price,
          description: addDraft.description,
          motorFamily: criterion === "motor" ? addDraft.motor_family : null,
          motorBranded: criterion === "motor" ? addDraft.motor_branded : null,
          heatTechFamily: criterion === "heat_technology" ? addDraft.heat_tech_family : null,
          heatTechBranded: criterion === "heat_technology" ? addDraft.heat_tech_branded : null,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to add product");
      toast.success(`Added "${data.product.name}"`);
      setAddDraft(emptyDraft());
      setShowAdd(false);
      await load();
    } catch (err: any) {
      toast.error(err.message || "Failed to add product");
    } finally {
      setAdding(false);
    }
  }

  async function handlePreviewImport() {
    if (!importFile) return;
    setPreviewing(true);
    setImportDiff(null);
    try {
      const formData = new FormData();
      formData.append("file", importFile);
      const res = await fetch("/api/admin/catalog-products/import", { method: "POST", body: formData });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to parse import file");
      setImportDiff(data);
      // Default-checked: every New/Changed row, indexed across the
      // combined new+changed list (Unchanged/missingFromFile are never
      // pre-selected — nothing applies unless explicitly kept checked).
      setSelectedRows(new Set(Array.from({ length: (data.new?.length || 0) + (data.changed?.length || 0) }, (_, i) => i)));
    } catch (err: any) {
      toast.error(err.message || "Failed to parse import file");
    } finally {
      setPreviewing(false);
    }
  }

  async function handleConfirmImport() {
    if (!importDiff) return;
    const combined = [...importDiff.new, ...importDiff.changed];
    const rows = combined.filter((_, i) => selectedRows.has(i)).map(r => ({ row: r.row, existingId: r.existingId }));
    if (rows.length === 0) {
      toast.error("No rows selected");
      return;
    }
    setConfirming(true);
    try {
      const res = await fetch("/api/admin/catalog-products/import/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rows }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to confirm import");
      toast.success(`Import applied — ${data.inserted} new, ${data.updated} updated`);
      setImportDiff(null);
      setImportFile(null);
      setShowImport(false);
      await load();
    } catch (err: any) {
      toast.error(err.message || "Failed to confirm import");
    } finally {
      setConfirming(false);
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

  const addCriterion = criterionFor(addDraft.tool_type || "");
  const editCriterion = criterionFor(editDraft.tool_type || "");
  const combinedDiffRows = importDiff ? [...importDiff.new, ...importDiff.changed] : [];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Package className="w-5 h-5 text-accent" />
          <h1 className="text-display">Product Catalog</h1>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => setShowImport(v => !v)} className="flex items-center gap-1 px-2.5 py-1.5 border border-border rounded-lg text-[11px] font-bold text-text-secondary hover:border-accent/40">
            <Upload className="w-3.5 h-3.5" /> Import spreadsheet
          </button>
          <button type="button" onClick={() => setShowAdd(v => !v)} className="flex items-center gap-1 px-2.5 py-1.5 bg-accent hover:bg-accent-hover text-white text-[11px] font-bold rounded-lg">
            <Plus className="w-3.5 h-3.5" /> Add product
          </button>
        </div>
      </div>
      <p className="text-xs text-text-muted -mt-4">
        Our own product lineup — selectable at the analyze form&apos;s initial stage to auto-fill every analysis field. Deactivating a product keeps it in the list (never a hard delete) but hides it from the analyze form&apos;s picker.
      </p>

      {showImport && (
        <div className="border border-accent/30 bg-surface-2 rounded-xl p-4 space-y-3">
          <h2 className="text-xs font-bold text-text-primary">Re-import from spreadsheet (.xlsx or .csv)</h2>
          <p className="text-[10px] text-text-muted">Matches rows by product name. New rows are added, changed fields are diffed for review, unchanged rows are skipped, and anything missing from the file is left untouched — nothing is ever silently deleted.</p>
          <div className="flex items-center gap-2">
            <input type="file" accept=".xlsx,.csv" onChange={e => setImportFile(e.target.files?.[0] || null)} className="text-[11px] text-text-secondary" />
            <button type="button" onClick={handlePreviewImport} disabled={!importFile || previewing} className="flex items-center gap-1 px-2.5 py-1.5 bg-accent hover:bg-accent-hover text-white text-[11px] font-bold rounded-lg disabled:opacity-50">
              {previewing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null} Preview Import
            </button>
          </div>

          {importDiff && (
            <div className="space-y-3 pt-2 border-t border-border">
              <div className="flex flex-wrap gap-3 text-[10px] text-text-muted">
                <span><strong className="text-text-primary">{importDiff.new.length}</strong> new</span>
                <span><strong className="text-text-primary">{importDiff.changed.length}</strong> changed</span>
                <span><strong className="text-text-primary">{importDiff.unchanged.length}</strong> unchanged</span>
                <span><strong className="text-text-primary">{importDiff.missingFromFile.length}</strong> missing from file (untouched)</span>
              </div>

              <div className="max-h-80 overflow-y-auto space-y-1.5">
                {combinedDiffRows.map((r, i) => (
                  <label key={i} className="flex items-start gap-2 px-2.5 py-2 rounded-lg border border-border bg-surface-1 text-[10px]">
                    <input
                      type="checkbox"
                      checked={selectedRows.has(i)}
                      onChange={e => setSelectedRows(prev => {
                        const next = new Set(prev);
                        if (e.target.checked) next.add(i); else next.delete(i);
                        return next;
                      })}
                      className="mt-0.5 rounded"
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="font-semibold text-text-primary">{r.row.name}</span>
                        <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold uppercase ${r.existingId ? "bg-warning/10 text-warning border border-warning/25" : "bg-success/10 text-success border border-success/25"}`}>
                          {r.existingId ? "Changed" : "New"}
                        </span>
                        {(r.row.importFlags || []).map((f: string) => (
                          <span key={f} className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-danger-bg border border-danger/20 text-danger">{FLAG_LABELS[f] || f}</span>
                        ))}
                      </div>
                      {r.changedFields && r.changedFields.length > 0 && (
                        <div className="text-text-muted mt-0.5">Changed: {r.changedFields.join(", ")}</div>
                      )}
                    </div>
                  </label>
                ))}
              </div>

              <div className="flex items-center gap-2">
                <button type="button" onClick={handleConfirmImport} disabled={confirming} className="flex items-center gap-1 px-2.5 py-1.5 bg-accent hover:bg-accent-hover text-white text-[11px] font-bold rounded-lg disabled:opacity-50">
                  {confirming ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />} Confirm Import ({selectedRows.size} row{selectedRows.size === 1 ? "" : "s"})
                </button>
                <button type="button" onClick={() => { setImportDiff(null); setImportFile(null); }} className="px-2.5 py-1.5 text-[11px] text-text-muted hover:text-danger">
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {showAdd && (
        <div className="border border-accent/30 bg-surface-2 rounded-xl p-4 space-y-3">
          <h2 className="text-xs font-bold text-text-primary">Add product</h2>
          <div className="grid grid-cols-2 gap-3">
            <input type="text" placeholder="Product name" value={addDraft.name || ""} onChange={e => setAddDraft(d => ({ ...d, name: e.target.value }))} className="col-span-2 px-2.5 py-1.5 text-[11px] border border-border rounded-lg bg-surface-1 text-text-primary outline-none focus:border-accent" />
            <select value={addDraft.industry} onChange={e => setAddDraft(d => ({ ...d, industry: e.target.value }))} className="px-2.5 py-1.5 text-[11px] border border-border rounded-lg bg-surface-1 text-text-primary">
              <option value="grooming-barbering">Grooming & Barbering</option>
              <option value="haircare-styling">Hair Care & Styling</option>
            </select>
            <select value={addDraft.target_market} onChange={e => setAddDraft(d => ({ ...d, target_market: e.target.value }))} className="px-2.5 py-1.5 text-[11px] border border-border rounded-lg bg-surface-1 text-text-primary">
              <option value="pro">Pro / Salon</option>
              <option value="consumer">Retail</option>
              <option value="both">Both</option>
            </select>
            <select value={addDraft.tool_type} onChange={e => setAddDraft(d => ({ ...d, tool_type: e.target.value }))} className="px-2.5 py-1.5 text-[11px] border border-border rounded-lg bg-surface-1 text-text-primary">
              <option value="">Select tool type…</option>
              {toolTypes.map(t => <option key={t.type_key} value={t.type_key}>{t.label}</option>)}
            </select>
            <input type="text" placeholder="Target price (e.g. 199.95)" value={addDraft.target_price ?? ""} onChange={e => setAddDraft(d => ({ ...d, target_price: e.target.value ? Number(e.target.value) : null }))} className="px-2.5 py-1.5 text-[11px] border border-border rounded-lg bg-surface-1 text-text-primary outline-none focus:border-accent" />
            <textarea placeholder="Description (features & benefits)" value={addDraft.description || ""} onChange={e => setAddDraft(d => ({ ...d, description: e.target.value }))} className="col-span-2 px-2.5 py-1.5 text-[11px] border border-border rounded-lg bg-surface-1 text-text-primary outline-none focus:border-accent" rows={2} />
            {addCriterion === "motor" && (
              <>
                <select value={addDraft.motor_family || ""} onChange={e => setAddDraft(d => ({ ...d, motor_family: e.target.value || null }))} className="px-2.5 py-1.5 text-[11px] border border-border rounded-lg bg-surface-1 text-text-primary">
                  <option value="">Select motor…</option>
                  {motorFamilies.map(f => <option key={f.family_key} value={f.family_key}>{f.label}</option>)}
                </select>
                <input type="text" placeholder="Branded motor name (optional)" value={addDraft.motor_branded || ""} onChange={e => setAddDraft(d => ({ ...d, motor_branded: e.target.value }))} className="px-2.5 py-1.5 text-[11px] border border-border rounded-lg bg-surface-1 text-text-primary outline-none focus:border-accent" />
              </>
            )}
            {addCriterion === "heat_technology" && (
              <>
                <select value={addDraft.heat_tech_family || ""} onChange={e => setAddDraft(d => ({ ...d, heat_tech_family: e.target.value || null }))} className="px-2.5 py-1.5 text-[11px] border border-border rounded-lg bg-surface-1 text-text-primary">
                  <option value="">Select heat/plate technology…</option>
                  {heatTechFamilies.map(f => <option key={f.family_key} value={f.family_key}>{f.label}</option>)}
                </select>
                <input type="text" placeholder="Branded heat/plate name (optional)" value={addDraft.heat_tech_branded || ""} onChange={e => setAddDraft(d => ({ ...d, heat_tech_branded: e.target.value }))} className="px-2.5 py-1.5 text-[11px] border border-border rounded-lg bg-surface-1 text-text-primary outline-none focus:border-accent" />
              </>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button type="button" onClick={handleAdd} disabled={adding} className="flex items-center gap-1 px-2.5 py-1.5 bg-accent hover:bg-accent-hover text-white text-[11px] font-bold rounded-lg disabled:opacity-50">
              {adding ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />} Add
            </button>
            <button type="button" onClick={() => { setShowAdd(false); setAddDraft(emptyDraft()); }} className="px-2.5 py-1.5 text-[11px] text-text-muted hover:text-danger">Cancel</button>
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
                  <th className="p-2.5">Name</th>
                  <th className="p-2.5">Tool Type</th>
                  <th className="p-2.5">Price</th>
                  <th className="p-2.5">Motor / Heat-Tech</th>
                  <th className="p-2.5">Flags</th>
                  <th className="p-2.5">Status</th>
                  <th className="p-2.5"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/40">
                {products.map(p => {
                  const isEditing = editingId === p.id;
                  return (
                    <tr key={p.id} className={p.active ? "" : "opacity-50"}>
                      {isEditing ? (
                        <>
                          <td className="p-2.5" colSpan={7}>
                            <div className="grid grid-cols-2 gap-2 p-2 bg-surface-3/20 rounded-lg">
                              <input type="text" value={editDraft.name || ""} onChange={e => setEditDraft(d => ({ ...d, name: e.target.value }))} className="col-span-2 px-2 py-1 border border-border rounded bg-surface-1" />
                              <select value={editDraft.industry} onChange={e => setEditDraft(d => ({ ...d, industry: e.target.value }))} className="px-2 py-1 border border-border rounded bg-surface-1">
                                <option value="grooming-barbering">Grooming & Barbering</option>
                                <option value="haircare-styling">Hair Care & Styling</option>
                              </select>
                              <select value={editDraft.target_market} onChange={e => setEditDraft(d => ({ ...d, target_market: e.target.value }))} className="px-2 py-1 border border-border rounded bg-surface-1">
                                <option value="pro">Pro / Salon</option>
                                <option value="consumer">Retail</option>
                                <option value="both">Both</option>
                              </select>
                              <select value={editDraft.tool_type} onChange={e => setEditDraft(d => ({ ...d, tool_type: e.target.value }))} className="px-2 py-1 border border-border rounded bg-surface-1">
                                {toolTypes.map(t => <option key={t.type_key} value={t.type_key}>{t.label}</option>)}
                              </select>
                              <input type="text" placeholder="Price" value={editDraft.target_price ?? ""} onChange={e => setEditDraft(d => ({ ...d, target_price: e.target.value ? Number(e.target.value) : null }))} className="px-2 py-1 border border-border rounded bg-surface-1" />
                              <textarea value={editDraft.description || ""} onChange={e => setEditDraft(d => ({ ...d, description: e.target.value }))} className="col-span-2 px-2 py-1 border border-border rounded bg-surface-1" rows={2} />
                              {editCriterion === "motor" && (
                                <>
                                  <select value={editDraft.motor_family || ""} onChange={e => setEditDraft(d => ({ ...d, motor_family: e.target.value || null }))} className="px-2 py-1 border border-border rounded bg-surface-1">
                                    <option value="">No motor</option>
                                    {motorFamilies.map(f => <option key={f.family_key} value={f.family_key}>{f.label}</option>)}
                                  </select>
                                  <input type="text" placeholder="Branded name" value={editDraft.motor_branded || ""} onChange={e => setEditDraft(d => ({ ...d, motor_branded: e.target.value }))} className="px-2 py-1 border border-border rounded bg-surface-1" />
                                </>
                              )}
                              {editCriterion === "heat_technology" && (
                                <>
                                  <select value={editDraft.heat_tech_family || ""} onChange={e => setEditDraft(d => ({ ...d, heat_tech_family: e.target.value || null }))} className="px-2 py-1 border border-border rounded bg-surface-1">
                                    <option value="">No heat/plate tech</option>
                                    {heatTechFamilies.map(f => <option key={f.family_key} value={f.family_key}>{f.label}</option>)}
                                  </select>
                                  <input type="text" placeholder="Branded name" value={editDraft.heat_tech_branded || ""} onChange={e => setEditDraft(d => ({ ...d, heat_tech_branded: e.target.value }))} className="px-2 py-1 border border-border rounded bg-surface-1" />
                                </>
                              )}
                              <div className="col-span-2 flex items-center gap-2">
                                <button type="button" onClick={saveEdit} disabled={busyId === p.id} className="flex items-center gap-1 px-2.5 py-1 bg-accent hover:bg-accent-hover text-white text-[10px] font-bold rounded">
                                  {busyId === p.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />} Save
                                </button>
                                <button type="button" onClick={() => setEditingId(null)} className="px-2.5 py-1 text-[10px] text-text-muted hover:text-danger">Cancel</button>
                              </div>
                            </div>
                          </td>
                        </>
                      ) : (
                        <>
                          <td className="p-2.5">
                            <div className="font-semibold text-text-primary">{p.name}</div>
                            <div className="text-[9px] text-text-muted">{INDUSTRY_LABELS[p.industry] || p.industry} · {MARKET_LABELS[p.target_market] || p.target_market}</div>
                          </td>
                          <td className="p-2.5 text-text-secondary">{toolTypeLabel(p.tool_type)}</td>
                          <td className="p-2.5 font-bold text-accent">{p.target_price != null ? `$${p.target_price.toFixed(2)}` : "—"}</td>
                          <td className="p-2.5 text-text-secondary">{p.motor_branded || p.heat_tech_branded || "—"}</td>
                          <td className="p-2.5">
                            {p.import_flags.length === 0 ? (
                              <span className="text-text-muted">—</span>
                            ) : (
                              <div className="flex flex-wrap gap-1">
                                {p.import_flags.map(f => (
                                  <span key={f} className="flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[9px] font-bold bg-warning/10 border border-warning/25 text-warning">
                                    <AlertTriangle className="w-2.5 h-2.5" /> {FLAG_LABELS[f] || f}
                                  </span>
                                ))}
                              </div>
                            )}
                          </td>
                          <td className="p-2.5">
                            <button
                              type="button"
                              onClick={() => toggleActive(p)}
                              disabled={busyId === p.id}
                              className={`px-2 py-0.5 rounded text-[10px] font-bold border ${p.active ? "border-success/30 text-success bg-success/10" : "border-border text-text-muted"}`}
                            >
                              {p.active ? "Active" : "Inactive"}
                            </button>
                          </td>
                          <td className="p-2.5 text-right">
                            <button type="button" onClick={() => startEdit(p)} className="p-1 text-text-muted hover:text-accent" title="Edit">
                              <Pencil className="w-3.5 h-3.5" />
                            </button>
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
