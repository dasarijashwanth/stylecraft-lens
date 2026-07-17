"use client";

import { useEffect, useState } from "react";
import { useRouter, useParams } from "next/navigation";
import { 
  ArrowLeft, 
  ExternalLink, 
  Play, 
  Archive, 
  Edit3, 
  Trash2, 
  Plus, 
  Loader2, 
  Save, 
  Sparkles,
  Calendar,
  AlertTriangle,
  FileText
} from "lucide-react";
import { toast } from "sonner";
import { Badge, type BadgeTone } from "@/components/ui/Badge";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { MagicBentoSection, MagicBentoCard } from "@/components/ui/MagicBento";

function statusBadgeTone(status: string): BadgeTone {
  const s = (status || "").toUpperCase();
  return s === "ACTIVE" ? "status-active" : s === "MONITORING" ? "status-monitoring" : "status-archived";
}

export default function CompetitorDetailPage() {
  const router = useRouter();
  const { id } = useParams();
  
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<"overview" | "analyses" | "notes" | "settings">("overview");
  
  const [competitor, setCompetitor] = useState<any>(null);
  const [notes, setNotes] = useState<any[]>([]);
  const [analyses, setAnalyses] = useState<any[]>([]);
  
  // Note input state
  const [noteContent, setNoteContent] = useState("");
  const [submittingNote, setSubmittingNote] = useState(false);
  
  // Settings edit state
  const [editName, setEditName] = useState("");
  const [editWebsite, setEditWebsite] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editStatus, setEditStatus] = useState<"ACTIVE" | "MONITORING" | "ARCHIVED">("ACTIVE");
  const [editTags, setEditTags] = useState<string[]>([]);
  const [newTagInput, setNewTagInput] = useState("");
  const [savingSettings, setSavingSettings] = useState(false);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const fetchDetails = async () => {
    try {
      const res = await fetch(`/api/competitors/${id}`);
      if (!res.ok) {
        if (res.status === 404) {
          toast.error("Competitor not found");
          router.push("/dashboard/competitors");
          return;
        }
        throw new Error();
      }
      
      const data = await res.json();
      setCompetitor(data.competitor);
      setNotes(data.competitor.notes || []);
      setAnalyses(data.competitor.analyses || []);
      
      // Initialize settings edit form
      setEditName(data.competitor.name);
      setEditWebsite(data.competitor.website || "");
      setEditDescription(data.competitor.description || "");
      setEditStatus(data.competitor.status);
      setEditTags(data.competitor.tags || []);
    } catch (e) {
      toast.error("Failed to load competitor details");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (id) {
      fetchDetails();
    }
  }, [id]);

  const handleAddNote = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!noteContent.trim()) return;
    
    setSubmittingNote(true);
    try {
      const res = await fetch(`/api/competitors/${id}/notes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: noteContent.trim() })
      });
      
      const data = await res.json();
      if (!res.ok) throw new Error(data.message);
      
      toast.success("Note added");
      setNotes([data.note, ...notes]);
      setNoteContent("");
    } catch (err: any) {
      toast.error(err.message || "Failed to add note");
    } finally {
      setSubmittingNote(false);
    }
  };

  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editName.trim()) {
      toast.error("Company name is required");
      return;
    }
    
    setSavingSettings(true);
    try {
      const res = await fetch(`/api/competitors/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: editName.trim(),
          website: editWebsite.trim() || null,
          description: editDescription.trim() || null,
          status: editStatus,
          tags: editTags
        })
      });
      
      const data = await res.json();
      if (!res.ok) throw new Error(data.message);
      
      toast.success("Settings updated");
      setCompetitor(data.competitor);
    } catch (err: any) {
      toast.error(err.message || "Failed to save settings");
    } finally {
      setSavingSettings(false);
    }
  };

  const handleDelete = async () => {
    setDeleting(true);
    try {
      const res = await fetch(`/api/competitors/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error();
      toast.success("Competitor deleted");
      router.push("/dashboard/competitors");
    } catch (e) {
      toast.error("Failed to delete competitor");
      setDeleting(false);
    }
  };

  const handleQuickToggleArchive = async () => {
    try {
      const target = competitor.status === "ARCHIVED" ? "ACTIVE" : "ARCHIVED";
      const res = await fetch(`/api/competitors/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: target })
      });
      if (!res.ok) throw new Error();
      toast.success(target === "ARCHIVED" ? "Archived competitor" : "Restored competitor");
      fetchDetails();
    } catch (e) {
      toast.error("Failed to update status");
    }
  };

  const handleAddTag = () => {
    const clean = newTagInput.trim().toLowerCase();
    if (!clean) return;
    if (editTags.includes(clean)) return;
    if (editTags.length >= 10) {
      toast.error("Maximum 10 tags reached");
      return;
    }
    setEditTags([...editTags, clean]);
    setNewTagInput("");
  };

  const handleRemoveTag = (tag: string) => {
    setEditTags(editTags.filter(t => t !== tag));
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center p-24">
        <Loader2 className="w-8 h-8 text-accent animate-spin mb-4" />
        <p className="text-xs text-text-muted">Loading details...</p>
      </div>
    );
  }

  if (!competitor) return null;

  // Threat score circular gauge configurations
  const threatScore = competitor.threatScore || 50;
  const strokeDashoffset = 251.2 - (251.2 * threatScore) / 100;
  
  // Threat color determination
  const threatColorClass = 
    threatScore >= 75 ? "text-danger stroke-danger" : 
    threatScore >= 45 ? "text-warning stroke-warning" : 
    "text-success stroke-success";

  return (
    <div className="space-y-6">
      {/* Navigation Banner Header */}
      <div className="flex flex-col gap-4">
        <button
          onClick={() => router.back()}
          className="flex items-center gap-1.5 text-xs text-text-muted hover:text-text-primary self-start transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Back to competitors</span>
        </button>

        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 p-5 bg-surface-2 border border-border rounded-xl">
          <div className="flex items-center gap-4">
            <img
              src={competitor.logoUrl || `https://ui-avatars.com/api/?name=${competitor.name}&background=1C1C22&color=6366F1`}
              alt={competitor.name}
              className="w-12 h-12 rounded-lg object-cover border border-border bg-surface-3"
            />
            <div>
              <div className="flex items-center gap-2.5">
                <h1 className="text-display leading-none">{competitor.name}</h1>
                <Badge tone={statusBadgeTone(competitor.status)} uppercase className="rounded-full">
                  {competitor.status}
                </Badge>
              </div>
              {competitor.website && (
                <a
                  href={competitor.website}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-xs text-text-muted hover:text-accent mt-1.5 transition-colors"
                >
                  <span>{competitor.website}</span>
                  <ExternalLink className="w-3 h-3" />
                </a>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2 self-start md:self-auto">
            <button
              onClick={() => router.push("/dashboard/analyze")}
              className="flex items-center gap-1.5 px-3.5 py-2 bg-accent hover:bg-accent-hover text-white text-xs font-bold rounded-lg transition-colors shadow shadow-accent/25"
            >
              <Play className="w-3.5 h-3.5" />
              <span>Run analysis</span>
            </button>
            <button
              onClick={handleQuickToggleArchive}
              className="flex items-center gap-1.5 px-3.5 py-2 border border-border bg-surface-3/50 hover:bg-surface-3 text-text-primary text-xs font-bold rounded-lg transition-colors"
            >
              <Archive className="w-3.5 h-3.5" />
              <span>{competitor.status === "ARCHIVED" ? "Restore" : "Archive"}</span>
            </button>
          </div>
        </div>
      </div>

      {/* Tabs Switcher Navigation */}
      <div className="flex border-b border-border">
        {["overview", "analyses", "notes", "settings"].map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab as any)}
            className={`px-4 py-2.5 text-xs font-bold capitalize transition-all border-b-2 -mb-px ${
              activeTab === tab
                ? "border-accent text-accent"
                : "border-transparent text-text-secondary hover:text-text-primary"
            }`}
          >
            {tab}
          </button>
        ))}
      </div>

      {/* TAB CONTENTS */}
      <div className="space-y-6">
        
        {/* OVERVIEW TAB */}
        {activeTab === "overview" && (
          <MagicBentoSection className="grid grid-cols-1 lg:grid-cols-12 gap-6">

            {/* Left side info (8/12) */}
            <div className="lg:col-span-8 space-y-6">

              {/* Description card */}
              <MagicBentoCard className="p-5 space-y-3">
                <h2 className="text-xs font-bold text-text-muted uppercase tracking-wider">About Brand</h2>
                <p className="text-xs text-text-primary leading-relaxed">
                  {competitor.description || "No description provided for this competitor. You can add one in the Settings tab."}
                </p>
                
                {/* Tags list */}
                {competitor.tags && competitor.tags.length > 0 && (
                  <div className="pt-3 border-t border-border/60 flex flex-wrap gap-1.5">
                    {competitor.tags.map((t: string) => (
                      <span key={t} className="px-2 py-0.5 rounded-md bg-surface-3 border border-border text-[10px] text-text-secondary">
                        {t}
                      </span>
                    ))}
                  </div>
                )}
              </MagicBentoCard>

              {/* Recent Analysis Summary */}
              <MagicBentoCard className="p-5 space-y-4">
                <h2 className="text-xs font-bold text-text-muted uppercase tracking-wider">Latest Market Intelligence</h2>
                {analyses.length > 0 ? (
                  <div className="space-y-4">
                    <div className="p-4 border border-border rounded-lg bg-surface-3/30 space-y-3">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-1.5">
                          <Sparkles className="w-4 h-4 text-accent" />
                          <span className="text-xs font-bold text-text-primary">AI Recommendation Mapping</span>
                        </div>
                        <span className="text-[10px] text-text-muted">
                          {new Date(analyses[0].createdAt).toLocaleDateString()}
                        </span>
                      </div>
                      <p className="text-xs text-text-secondary italic">
                        &quot;{analyses[0].insight || "Brand presence remains strong. Recommend tracking pricing fluctuations."}&quot;
                      </p>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
                      <div className="p-4 rounded-lg bg-surface-3/30 border border-border">
                        <span className="text-[10px] text-text-muted uppercase font-bold block mb-1">Product category</span>
                        <p className="text-text-primary font-semibold">{analyses[0].category || "Clippers"}</p>
                      </div>
                      <div className="p-4 rounded-lg bg-surface-3/30 border border-border">
                        <span className="text-[10px] text-text-muted uppercase font-bold block mb-1">Standout features</span>
                        <p className="text-text-primary font-semibold">{analyses[0].standoutFeature || "Advanced motor technology"}</p>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="p-8 text-center text-text-muted border border-dashed border-border rounded-lg">
                    <Sparkles className="w-8 h-8 mx-auto mb-2 opacity-50" />
                    <p className="text-xs">No analysis has been run on this competitor yet.</p>
                  </div>
                )}
              </MagicBentoCard>
            </div>

            {/* Right side charts/stats (4/12) */}
            <div className="lg:col-span-4 space-y-6">

              {/* Circular Threat Gauge */}
              <MagicBentoCard className="p-5 flex flex-col items-center text-center">
                <h2 className="text-xs font-bold text-text-muted uppercase tracking-wider mb-4 w-full text-left">Threat Level</h2>
                
                <div className="relative flex items-center justify-center w-28 h-28 my-2">
                  <svg className="w-full h-full transform -rotate-90">
                    {/* Background Circle */}
                    <circle cx="56" cy="56" r="40" stroke="var(--surface-3)" strokeWidth="8" fill="transparent" />
                    {/* Foreground Gauge */}
                    <circle 
                      cx="56" 
                      cy="56" 
                      r="40" 
                      strokeDasharray="251.2" 
                      strokeDashoffset={strokeDashoffset} 
                      strokeWidth="8" 
                      fill="transparent"
                      className={`transition-all duration-500 ${threatColorClass}`}
                    />
                  </svg>
                  <div className="absolute flex flex-col items-center">
                    <span className="text-2xl font-black font-mono tracking-tight text-text-primary leading-none">{threatScore}</span>
                    <span className="text-[8px] uppercase tracking-wider text-text-muted font-bold mt-1">out of 100</span>
                  </div>
                </div>

                <p className="text-xs font-semibold text-text-primary mt-3">
                  {threatScore >= 75 ? "High Threat" : threatScore >= 45 ? "Medium Alert" : "Low Risk"}
                </p>
                <p className="text-[10px] text-text-muted mt-1 leading-normal">
                  Based on recent competitor momentum and strategic product capability comparisons.
                </p>
              </MagicBentoCard>

              {/* Key Stats Cards */}
              <MagicBentoCard className="p-5 space-y-4">
                <h2 className="text-xs font-bold text-text-muted uppercase tracking-wider">Metrics Overview</h2>
                
                <div className="space-y-3.5 text-xs">
                  <div className="flex justify-between items-center py-1.5 border-b border-border/60">
                    <span className="text-text-secondary">Date added</span>
                    <span className="font-semibold text-text-primary">
                      {new Date(competitor.createdAt).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" })}
                    </span>
                  </div>
                  <div className="flex justify-between items-center py-1.5 border-b border-border/60">
                    <span className="text-text-secondary">Total analyses run</span>
                    <span className="font-semibold text-text-primary">{analyses.length}</span>
                  </div>
                  <div className="flex justify-between items-center py-1.5 border-b border-border/60">
                    <span className="text-text-secondary">Related notes</span>
                    <span className="font-semibold text-text-primary">{notes.length}</span>
                  </div>
                </div>
              </MagicBentoCard>
            </div>
          </MagicBentoSection>
        )}

        {/* ANALYSES TIMELINE TAB */}
        {activeTab === "analyses" && (
          <MagicBentoCard className="p-5 space-y-6">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-bold text-text-primary">Historical Analyses</h2>
            </div>

            {analyses.length > 0 ? (
              <div className="relative border-l border-border pl-6 ml-3 space-y-6">
                {analyses.map((an, idx) => (
                  <div key={an.id} className="relative">
                    {/* Circle timeline indicator */}
                    <span className="absolute -left-[31px] top-1 w-2.5 h-2.5 rounded-full border-2 border-accent bg-surface-2" />
                    
                    <div className="bg-surface-3/30 border border-border rounded-xl p-4 space-y-3 max-w-2xl">
                      <div className="flex justify-between items-start">
                        <div>
                          <p className="text-xs font-bold text-text-primary">{an.name || "AI Market Deep Dive"}</p>
                          <div className="flex items-center gap-1.5 mt-1 text-[10px] text-text-muted">
                            <Calendar className="w-3 h-3" />
                            <span>{new Date(an.createdAt || Date.now()).toLocaleDateString()}</span>
                            <span>•</span>
                            <span>Threat score: {an.threatScore}</span>
                          </div>
                        </div>
                        
                        <span className="px-1.5 py-0.5 rounded bg-surface-3 border border-border text-[9px] text-text-secondary font-mono">
                          {an.tier}
                        </span>
                      </div>
                      
                      {an.insight && (
                        <p className="text-xs text-text-secondary leading-relaxed">
                          {an.insight}
                        </p>
                      )}
                      
                      <div className="flex flex-wrap gap-2 text-[10px]">
                        {an.category && (
                          <Badge tone="neutral">Category: {an.category}</Badge>
                        )}
                        {an.standoutFeature && (
                          <span className="px-1.5 py-0.5 rounded bg-indigo-950/60 text-indigo-300 border border-indigo-900/40">Feature: {an.standoutFeature}</span>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="p-12 text-center text-text-muted">
                <Sparkles className="w-8 h-8 mx-auto mb-2 opacity-50 animate-pulse" />
                <p className="text-xs">No analysis entries recorded for this competitor.</p>
                <button
                  onClick={() => router.push("/dashboard/analyze")}
                  className="mt-4 px-3 py-1.5 bg-accent hover:bg-accent-hover text-white text-[11px] font-bold rounded-lg transition-colors"
                >
                  Run analysis now
                </button>
              </div>
            )}
          </MagicBentoCard>
        )}

        {/* NOTES TAB */}
        {activeTab === "notes" && (
          <MagicBentoSection className="grid grid-cols-1 lg:grid-cols-12 gap-6">

            {/* Add note inline form (5/12) */}
            <MagicBentoCard className="lg:col-span-5 p-5 h-fit">
              <h2 className="text-xs font-bold text-text-muted uppercase tracking-wider mb-4">Add Note</h2>
              <form onSubmit={handleAddNote} className="space-y-4">
                <textarea
                  value={noteContent}
                  onChange={(e) => setNoteContent(e.target.value)}
                  placeholder="Type notes here. Markdown and list points supported..."
                  rows={4}
                  className="w-full px-3 py-2 text-xs border border-border rounded-lg bg-surface-1 outline-none text-text-primary placeholder-text-muted transition-colors focus:border-accent resize-y min-h-[100px]"
                />
                
                <button
                  type="submit"
                  disabled={submittingNote || !noteContent.trim()}
                  className="w-full py-2 bg-accent hover:bg-accent-hover text-white text-xs font-bold rounded-lg transition-colors shadow disabled:opacity-50 flex items-center justify-center gap-1.5"
                >
                  {submittingNote ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      <span>Saving note...</span>
                    </>
                  ) : (
                    <>
                      <Save className="w-3.5 h-3.5" />
                      <span>Save note</span>
                    </>
                  )}
                </button>
              </form>
            </MagicBentoCard>

            {/* Notes history list (7/12) */}
            <MagicBentoCard className="lg:col-span-7 p-5 space-y-4">
              <h2 className="text-xs font-bold text-text-muted uppercase tracking-wider">Notes Timeline</h2>
              
              <div className="space-y-3.5 max-h-[400px] overflow-y-auto pr-1">
                {notes.map((note) => (
                  <div key={note.id} className="p-3.5 rounded-lg border border-border bg-surface-3/30 text-xs">
                    <p className="text-text-primary whitespace-pre-wrap leading-relaxed">{note.content}</p>
                    <span className="text-[10px] text-text-muted mt-2 block font-medium">
                      {new Date(note.createdAt).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                    </span>
                  </div>
                ))}
                
                {notes.length === 0 && (
                  <div className="p-8 text-center text-text-muted border border-dashed border-border rounded-lg">
                    <FileText className="w-7 h-7 mx-auto mb-2 opacity-50" />
                    <p className="text-xs">No notes saved for this competitor yet.</p>
                  </div>
                )}
              </div>
            </MagicBentoCard>
          </MagicBentoSection>
        )}

        {/* SETTINGS TAB */}
        {activeTab === "settings" && (
          <MagicBentoSection className="grid grid-cols-1 lg:grid-cols-12 gap-6">

            {/* Edit fields (8/12) */}
            <MagicBentoCard className="lg:col-span-8 p-5">
              <h2 className="text-xs font-bold text-text-muted uppercase tracking-wider mb-4">Edit Profile details</h2>
              
              <form onSubmit={handleSaveSettings} className="space-y-4 text-xs">
                {/* Company Name */}
                <div className="space-y-1">
                  <label className="font-semibold text-text-primary">Company name *</label>
                  <input
                    type="text"
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    className="w-full px-3 py-2 border border-border rounded-lg bg-surface-1 text-text-primary outline-none focus:border-accent"
                  />
                </div>

                {/* Website */}
                <div className="space-y-1">
                  <label className="font-semibold text-text-primary">Website URL</label>
                  <input
                    type="text"
                    value={editWebsite}
                    onChange={(e) => setEditWebsite(e.target.value)}
                    className="w-full px-3 py-2 border border-border rounded-lg bg-surface-1 text-text-primary outline-none focus:border-accent"
                  />
                </div>

                {/* Description */}
                <div className="space-y-1">
                  <label className="font-semibold text-text-primary">Description</label>
                  <textarea
                    value={editDescription}
                    onChange={(e) => setEditDescription(e.target.value)}
                    rows={4}
                    className="w-full px-3 py-2 border border-border rounded-lg bg-surface-1 text-text-primary outline-none focus:border-accent resize-y"
                  />
                </div>

                {/* Status Toggle */}
                <div className="space-y-1">
                  <label className="font-semibold text-text-primary block mb-1">Status</label>
                  <div className="flex gap-2 max-w-sm">
                    {["ACTIVE", "MONITORING", "ARCHIVED"].map((s) => (
                      <button
                        key={s}
                        type="button"
                        onClick={() => setEditStatus(s as any)}
                        className={`flex-1 py-1.5 border rounded-lg font-semibold transition-colors ${
                          editStatus === s 
                            ? "bg-surface-3 text-text-primary border-border-strong" 
                            : "text-text-secondary hover:text-text-primary bg-surface-1 border-border"
                        }`}
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Tags */}
                <div className="space-y-1.5">
                  <label className="font-semibold text-text-primary block">Tags (max 10)</label>
                  <div className="flex gap-2 max-w-sm">
                    <input
                      type="text"
                      value={newTagInput}
                      onChange={(e) => setNewTagInput(e.target.value)}
                      placeholder="e.g. cordless"
                      className="w-full px-3 py-1.5 border border-border rounded-lg bg-surface-1 text-text-primary outline-none focus:border-accent"
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          handleAddTag();
                        }
                      }}
                    />
                    <button
                      type="button"
                      onClick={handleAddTag}
                      className="px-3 py-1.5 bg-surface-3 hover:bg-surface-1 border border-border rounded-lg font-semibold"
                    >
                      Add
                    </button>
                  </div>
                  
                  {editTags.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 pt-2">
                      {editTags.map(tag => (
                        <Badge key={tag} tone="neutral">
                          <span>{tag}</span>
                          <button
                            type="button"
                            onClick={() => handleRemoveTag(tag)}
                            className="opacity-50 hover:opacity-100 font-bold text-xs"
                          >
                            ×
                          </button>
                        </Badge>
                      ))}
                    </div>
                  )}
                </div>

                <div className="pt-4 border-t border-border flex justify-end">
                  <button
                    type="submit"
                    disabled={savingSettings}
                    className="px-4 py-2 bg-accent hover:bg-accent-hover text-white font-bold rounded-lg transition-colors flex items-center gap-1.5 disabled:opacity-50"
                  >
                    {savingSettings ? (
                      <>
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        <span>Saving...</span>
                      </>
                    ) : (
                      <>
                        <Save className="w-3.5 h-3.5" />
                        <span>Save Changes</span>
                      </>
                    )}
                  </button>
                </div>
              </form>
            </MagicBentoCard>

            {/* Danger Zone (4/12) — kept as a plain themed box, not a MagicBentoCard:
                the destructive-action warning border/glow would clash with the danger
                red styling and undercut its seriousness with a playful hover effect. */}
            <div className="lg:col-span-4 bg-surface-2 border border-danger/25 rounded-xl p-5 h-fit space-y-4">
              <div className="flex items-center gap-2 text-danger">
                <AlertTriangle className="w-4 h-4" />
                <h2 className="text-xs font-bold uppercase tracking-wider">Danger Zone</h2>
              </div>
              <p className="text-[11px] text-text-muted leading-normal">
                Permanently delete this competitor profile, all historical analysis references, and saved comments. This action is irreversible.
              </p>

              <button
                onClick={() => setConfirmDeleteOpen(true)}
                className="w-full py-2 bg-danger/10 border border-danger/35 hover:bg-danger/20 text-danger text-xs font-bold rounded-lg transition-all flex items-center justify-center gap-1.5"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Delete competitor</span>
              </button>
            </div>
          </MagicBentoSection>
        )}

      </div>

      <ConfirmDialog
        isOpen={confirmDeleteOpen}
        title="Delete this competitor?"
        description="This will permanently delete this competitor profile, all historical analysis references, and saved comments. This action is irreversible."
        confirmLabel="Delete competitor"
        loading={deleting}
        onConfirm={handleDelete}
        onClose={() => setConfirmDeleteOpen(false)}
      />
    </div>
  );
}
