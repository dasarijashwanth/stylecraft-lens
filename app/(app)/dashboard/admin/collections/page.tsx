"use client";

import { useEffect, useState } from "react";
import { ShieldAlert, Plus, Loader2, Pencil, Check, Trash2, Layers } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/hooks/useAuth";
import { Spinner } from "@/components/ui/Spinner";

interface Collection {
  id: string;
  name: string;
  narrative_kernel: string;
  logo_meaning: string;
  voice_notes: string;
  enabled: boolean;
  sort_order: number;
}

const emptyDraft = { name: "", narrativeKernel: "", logoMeaning: "", voiceNotes: "" };

export default function CollectionsAdminPage() {
  const { user, loading: authLoading } = useAuth();
  const [collections, setCollections] = useState<Collection[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState(emptyDraft);
  const [busyId, setBusyId] = useState<string | null>(null);

  const [showAdd, setShowAdd] = useState(false);
  const [addDraft, setAddDraft] = useState(emptyDraft);
  const [adding, setAdding] = useState(false);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/collections");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to load collections");
      setCollections(data.collections || []);
    } catch (err: any) {
      setError(err.message || "Failed to load collections");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (user && (user.role === "OWNER" || user.role === "ADMIN")) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  function startEdit(c: Collection) {
    setEditingId(c.id);
    setEditDraft({ name: c.name, narrativeKernel: c.narrative_kernel, logoMeaning: c.logo_meaning, voiceNotes: c.voice_notes });
  }

  async function saveEdit() {
    if (!editingId) return;
    setBusyId(editingId);
    try {
      const res = await fetch(`/api/admin/collections/${editingId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: editDraft.name.trim(), narrativeKernel: editDraft.narrativeKernel, logoMeaning: editDraft.logoMeaning, voiceNotes: editDraft.voiceNotes }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to update collection");
      toast.success("Collection updated");
      setEditingId(null);
      await load();
    } catch (err: any) {
      toast.error(err.message || "Failed to update collection");
    } finally {
      setBusyId(null);
    }
  }

  async function toggleEnabled(c: Collection) {
    setBusyId(c.id);
    try {
      const res = await fetch(`/api/admin/collections/${c.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: !c.enabled }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to update collection");
      await load();
    } catch (err: any) {
      toast.error(err.message || "Failed to update collection");
    } finally {
      setBusyId(null);
    }
  }

  async function handleDelete(c: Collection) {
    setBusyId(c.id);
    try {
      const res = await fetch(`/api/admin/collections/${c.id}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to delete collection");
      toast.success(`Removed "${c.name}"`);
      await load();
    } catch (err: any) {
      toast.error(err.message || "Failed to delete collection");
    } finally {
      setBusyId(null);
    }
  }

  async function handleAdd() {
    if (!addDraft.name.trim()) {
      toast.error("Name is required");
      return;
    }
    setAdding(true);
    try {
      const res = await fetch("/api/admin/collections", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: addDraft.name.trim(), narrativeKernel: addDraft.narrativeKernel, logoMeaning: addDraft.logoMeaning, voiceNotes: addDraft.voiceNotes }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to add collection");
      toast.success(`Added "${data.collection.name}"`);
      setAddDraft(emptyDraft);
      setShowAdd(false);
      await load();
    } catch (err: any) {
      toast.error(err.message || "Failed to add collection");
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
          <Layers className="w-5 h-5 text-accent" />
          <h1 className="text-display">Collections</h1>
        </div>
        <button type="button" onClick={() => setShowAdd(v => !v)} className="flex items-center gap-1 px-2.5 py-1.5 bg-accent hover:bg-accent-hover text-white text-[11px] font-bold rounded-lg">
          <Plus className="w-3.5 h-3.5" /> Add collection
        </button>
      </div>
      <p className="text-xs text-text-muted -mt-4">
        Product-line narrative kernels (origin story, logo meaning, voice notes) that GTM generation ADAPTS — never copies verbatim — into a new product&apos;s Product Name Origin and name-ties-to-story fields when its catalog record&apos;s Collection matches one of these names.
      </p>

      {showAdd && (
        <div className="border border-accent/30 bg-surface-2 rounded-xl p-4 space-y-3">
          <h2 className="text-xs font-bold text-text-primary">Add collection</h2>
          <div className="grid grid-cols-1 gap-3">
            <input type="text" placeholder="Name (e.g. Homie)" value={addDraft.name} onChange={e => setAddDraft(d => ({ ...d, name: e.target.value }))} className="px-2.5 py-1.5 text-[11px] border border-border rounded-lg bg-surface-1 text-text-primary outline-none focus:border-accent" />
            <textarea placeholder="Narrative kernel (origin story)" value={addDraft.narrativeKernel} onChange={e => setAddDraft(d => ({ ...d, narrativeKernel: e.target.value }))} rows={4} className="px-2.5 py-1.5 text-[11px] border border-border rounded-lg bg-surface-1 text-text-primary outline-none focus:border-accent" />
            <textarea placeholder="Logo meaning" value={addDraft.logoMeaning} onChange={e => setAddDraft(d => ({ ...d, logoMeaning: e.target.value }))} rows={2} className="px-2.5 py-1.5 text-[11px] border border-border rounded-lg bg-surface-1 text-text-primary outline-none focus:border-accent" />
            <textarea placeholder="Voice notes" value={addDraft.voiceNotes} onChange={e => setAddDraft(d => ({ ...d, voiceNotes: e.target.value }))} rows={2} className="px-2.5 py-1.5 text-[11px] border border-border rounded-lg bg-surface-1 text-text-primary outline-none focus:border-accent" />
          </div>
          <div className="flex items-center gap-2">
            <button type="button" onClick={handleAdd} disabled={adding} className="flex items-center gap-1 px-2.5 py-1.5 bg-accent hover:bg-accent-hover text-white text-[11px] font-bold rounded-lg disabled:opacity-50">
              {adding ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />} Add
            </button>
            <button type="button" onClick={() => { setShowAdd(false); setAddDraft(emptyDraft); }} className="px-2.5 py-1.5 text-[11px] text-text-muted hover:text-danger">Cancel</button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="p-8 text-center text-text-muted text-xs">Loading…</div>
      ) : error ? (
        <div className="p-8 text-center text-danger text-xs">{error}</div>
      ) : (
        <div className="space-y-3">
          {collections.map(c => {
            const isEditing = editingId === c.id;
            return (
              <div key={c.id} className={`border border-border rounded-xl p-4 ${c.enabled ? "" : "opacity-50"}`}>
                {isEditing ? (
                  <div className="space-y-2">
                    <input type="text" value={editDraft.name} onChange={e => setEditDraft(d => ({ ...d, name: e.target.value }))} className="w-full px-2 py-1 text-[11px] border border-border rounded bg-surface-1" />
                    <textarea value={editDraft.narrativeKernel} onChange={e => setEditDraft(d => ({ ...d, narrativeKernel: e.target.value }))} rows={4} placeholder="Narrative kernel" className="w-full px-2 py-1 text-[11px] border border-border rounded bg-surface-1" />
                    <textarea value={editDraft.logoMeaning} onChange={e => setEditDraft(d => ({ ...d, logoMeaning: e.target.value }))} rows={2} placeholder="Logo meaning" className="w-full px-2 py-1 text-[11px] border border-border rounded bg-surface-1" />
                    <textarea value={editDraft.voiceNotes} onChange={e => setEditDraft(d => ({ ...d, voiceNotes: e.target.value }))} rows={2} placeholder="Voice notes" className="w-full px-2 py-1 text-[11px] border border-border rounded bg-surface-1" />
                    <div className="flex items-center gap-2">
                      <button type="button" onClick={saveEdit} disabled={busyId === c.id} className="flex items-center gap-1 px-2.5 py-1 bg-accent hover:bg-accent-hover text-white text-[10px] font-bold rounded">
                        {busyId === c.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />} Save
                      </button>
                      <button type="button" onClick={() => setEditingId(null)} className="px-2.5 py-1 text-[10px] text-text-muted hover:text-danger">Cancel</button>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <h3 className="text-xs font-bold text-text-primary">{c.name}</h3>
                        <button
                          type="button"
                          onClick={() => toggleEnabled(c)}
                          disabled={busyId === c.id}
                          className={`px-2 py-0.5 rounded text-[10px] font-bold border ${c.enabled ? "border-success/30 text-success bg-success/10" : "border-border text-text-muted"}`}
                        >
                          {c.enabled ? "Enabled" : "Disabled"}
                        </button>
                      </div>
                      <div className="flex items-center gap-1">
                        <button type="button" onClick={() => startEdit(c)} className="p-1 text-text-muted hover:text-accent" title="Edit">
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                        <button type="button" onClick={() => handleDelete(c)} disabled={busyId === c.id} className="p-1 text-text-muted hover:text-danger" title="Delete">
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                    <p className="text-[11px] text-text-secondary whitespace-pre-wrap">{c.narrative_kernel || <span className="text-text-muted">No narrative kernel set</span>}</p>
                    {c.logo_meaning && <p className="text-[10px] text-text-muted"><span className="font-semibold">Logo:</span> {c.logo_meaning}</p>}
                    {c.voice_notes && <p className="text-[10px] text-text-muted"><span className="font-semibold">Voice:</span> {c.voice_notes}</p>}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
