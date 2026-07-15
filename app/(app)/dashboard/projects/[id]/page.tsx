// app/(app)/dashboard/projects/[id]/page.tsx
"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter, useParams } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft,
  Sparkles,
  FileText,
  Plus,
  Trash2,
  ChevronRight,
  Loader2,
  Briefcase,
  TrendingUp,
  AlertTriangle,
  Lightbulb,
  DollarSign,
  Download,
  Edit2,
  Check,
  Globe,
  Sliders,
  Target,
  Eye,
  RefreshCw,
  Undo2,
  AlertCircle
} from "lucide-react";
import { toast } from "sonner";
import { downloadTabPDF, downloadReportPDF } from "@/lib/export-pdf";
import { SaveToDriveButton } from "@/components/ui/SaveToDriveButton";
import { ArtworkTab } from "@/components/project/ArtworkTab";
import { LinkReportModal } from "@/components/project/LinkReportModal";
import { GTM_FIELD_SCHEMA, GTM_SECTIONS, GTM_SOURCE_LABELS } from "@/lib/gtm-field-schema";
import { TDS_FIELD_SCHEMA, TDS_SECTIONS } from "@/lib/tds-field-schema";
import { ProjectGenerationProgress } from "@/components/projects/ProjectGenerationProgress";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";

type Tab = "competitive-analysis" | "pricing" | "go-to-market" | "content-form" | "artwork";

export default function ProjectDetailPage() {
  const router = useRouter();
  const { id } = useParams<{ id: string }>();
  const [loading, setLoading] = useState(true);
  const [project, setProject] = useState<any>(null);
  const [reports, setReports] = useState<any[]>([]);
  const [activeTab, setActiveTab] = useState<Tab>("competitive-analysis");
  const [selectedReport, setSelectedReport] = useState<any>(null);
  const [linkingReport, setLinkingReport] = useState(false);
  const [pipelineState, setPipelineState] = useState<any>(null);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const fetchProjectDetails = async () => {
    try {
      setLoading(true);
      const res = await fetch(`/api/projects/${id}`);
      if (!res.ok) {
        if (res.status === 404) {
          toast.error("Project not found");
          router.push("/dashboard/projects");
          return;
        }
        throw new Error();
      }
      const data = await res.json();
      setProject(data.project);
      
      // Load reports linked to this project
      const reps = data.project.reports || [];
      setReports(reps);
      if (reps.length > 0) {
        // Retain selection if possible
        const alreadySelected = selectedReport ? reps.find((r: any) => r.id === selectedReport.id) : null;
        setSelectedReport(alreadySelected || reps[0]);
      } else {
        setSelectedReport(null);
      }
    } catch (e) {
      toast.error("Failed to load project details");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (id) fetchProjectDetails();
  }, [id]);

  useEffect(() => {
    if (!id) return;
    fetch(`/api/projects/${id}/pipeline`)
      .then(r => r.json())
      .then(data => setPipelineState(data.state ?? null))
      .catch(() => {});
  }, [id]);

  const handleDeleteProject = async () => {
    setDeleting(true);
    try {
      const res = await fetch(`/api/projects/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error();

      toast.success("Project deleted");
      router.push("/dashboard/projects");
    } catch (e) {
      toast.error("Failed to delete project");
      setDeleting(false);
    }
  };

  const formatRelativeTime = (dateString: string) => {
    if (!dateString) return "Never";
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    if (diffDays === 0) return "Today";
    if (diffDays === 1) return "Yesterday";
    return `${diffDays} days ago`;
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center p-24">
        <Loader2 className="w-8 h-8 text-accent animate-spin mb-4" />
        <p className="text-xs text-text-muted">Loading project workspace...</p>
      </div>
    );
  }

  if (!project) return null;

  return (
    <div className="space-y-6">
      {/* Back Link */}
      <div className="flex flex-col gap-4">
        <button
          onClick={() => router.back()}
          className="flex items-center gap-1.5 text-xs text-text-muted hover:text-text-primary self-start transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Back to projects</span>
        </button>

        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 p-5 bg-surface-2 border border-border rounded-xl">
          <div className="flex items-center gap-4">
            <div className="w-10 h-10 rounded-lg bg-accent/10 border border-accent/25 flex items-center justify-center text-accent">
              <Briefcase className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2.5">
                <h1 className="text-display leading-none">{project.name}</h1>
                <span className="px-2.5 py-0.5 rounded-full text-[9px] font-bold bg-accent-bg border border-accent-border text-accent-text uppercase tracking-wider">
                  {project.industry === "grooming-barbering" ? "Grooming & Barbering" : "Hair Care & Styling"}
                </span>
              </div>
              <p className="text-xs text-text-muted mt-1">Product: <span className="font-semibold text-text-secondary">{project.productName}</span></p>
            </div>
          </div>

          <div className="flex items-center gap-2 self-start md:self-auto">
            <button
              onClick={() => router.push(`/dashboard/analyze?projectId=${id}`)}
              className="flex items-center gap-1.5 px-3.5 py-2 bg-accent hover:bg-accent-hover text-white text-xs font-bold rounded-lg transition-colors shadow shadow-accent/25"
            >
              <Sparkles className="w-3.5 h-3.5" />
              <span>Run analysis</span>
            </button>
          </div>
        </div>
      </div>

      {/* Main layout */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        
        {/* Left Side: Product Specifications (4/12) */}
        <div className="lg:col-span-4 bg-surface-2 border border-border rounded-xl p-5 space-y-4">
          <h2 className="text-xs font-bold text-text-muted uppercase tracking-wider">Product specs & context</h2>
          
          <div className="space-y-4 text-xs">
            <div className="space-y-1">
              <span className="text-[10px] text-text-muted uppercase font-bold block">Description</span>
              <p className="text-text-primary leading-relaxed">{project.description}</p>
            </div>

            {project.category && (
              <div className="space-y-1">
                <span className="text-[10px] text-text-muted uppercase font-bold block">Market / Amazon Category</span>
                <p className="text-text-primary font-semibold">{project.category}</p>
              </div>
            )}

            {project.pricePoint && (
              <div className="space-y-1">
                <span className="text-[10px] text-text-muted uppercase font-bold block">Target Price Point</span>
                <p className="text-text-primary font-semibold">{project.pricePoint}</p>
              </div>
            )}

            {project.targetMarket && (
              <div className="space-y-1">
                <span className="text-[10px] text-text-muted uppercase font-bold block">Target Market Tier</span>
                <p className="text-text-primary font-semibold uppercase">{project.targetMarket}</p>
              </div>
            )}

            {(project.motorTech || project.keyDiff || project.companyContext) && (
              <div className="pt-3 border-t border-border/60 space-y-3">
                <span className="text-[10px] text-text-muted uppercase font-bold block font-mono">Hardware & Brand specs</span>
                
                {project.motorTech && (
                  <div className="flex justify-between py-1 border-b border-border/40">
                    <span className="text-text-secondary">Motor type</span>
                    <span className="text-text-primary font-semibold">{project.motorTech}</span>
                  </div>
                )}
                {project.keyDiff && (
                  <div className="flex justify-between py-1 border-b border-border/40">
                    <span className="text-text-secondary">Differentiator</span>
                    <span className="text-text-primary font-semibold">{project.keyDiff}</span>
                  </div>
                )}
                {project.companyContext && (
                  <div className="space-y-1 pt-1">
                    <span className="text-[9px] text-text-muted uppercase font-bold block">Company Context</span>
                    <p className="text-text-secondary italic leading-relaxed">{project.companyContext}</p>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Right Side: Linked Reports Workspace (8/12) */}
        <div className="lg:col-span-8 space-y-6">
          {/* Project Outputs & Document Generators Bar — renders regardless
              of whether a report is linked; Sales Kit still needs one for
              its "Active Report" cross-references, but TDS/GTM download
              and Save-to-Drive buttons work off the project alone. */}
          <ProjectOutputsBar project={project} report={selectedReport} />

          {reports.length === 0 ? (
            /* Empty State */
            <div className="flex flex-col items-center justify-center p-12 bg-surface-2 border border-border border-dashed rounded-xl text-center space-y-4">
              <div className="w-12 h-12 rounded-full bg-surface-3 border border-border flex items-center justify-center text-lg">📊</div>
              <div className="space-y-1">
                <h3 className="text-sm font-bold text-text-primary">No report linked</h3>
                <p className="text-xs text-text-muted max-w-sm">Run a competitive analysis to compile a report, or link an existing report in your database.</p>
              </div>
              <div className="flex items-center gap-3">
                <button
                  onClick={() => router.push(`/dashboard/analyze?projectId=${id}`)}
                  className="px-4 py-2 bg-accent hover:bg-accent-hover text-white text-xs font-bold rounded-lg transition-colors shadow"
                >
                  Run analysis
                </button>
                <button
                  onClick={() => setLinkingReport(true)}
                  className="px-4 py-2 border border-border bg-surface-3/50 hover:bg-surface-3 text-text-primary text-xs font-bold rounded-lg transition-colors"
                >
                  Link report
                </button>
              </div>
            </div>
          ) : (
            /* Linked Reports detail area */
            <div className="space-y-4">
              {/* Report selector and download bar */}
              <div className="flex flex-wrap items-center justify-between gap-3 p-3.5 bg-surface-2 border border-border rounded-xl">
                <div className="flex items-center gap-3">
                  <span className="text-[10px] text-text-muted uppercase font-mono tracking-wider">Active Report:</span>
                  <select
                    value={selectedReport?.id}
                    onChange={e => setSelectedReport(reports.find(r => r.id === e.target.value))}
                    className="px-2.5 py-1.5 border border-border rounded-lg bg-surface-1 text-text-primary text-xs outline-none focus:border-accent font-semibold"
                  >
                    {reports.map(r => (
                      <option key={r.id} value={r.id}>
                        {r.title} — {formatRelativeTime(r.created_at)}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setLinkingReport(true)}
                    className="px-3 py-1.5 border border-border bg-surface-3/40 hover:bg-surface-3 text-text-primary text-xs font-bold rounded-lg transition-colors"
                  >
                    Link report
                  </button>
                  <button
                    onClick={() => downloadReportPDF(selectedReport)}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-accent hover:bg-accent-hover text-white text-xs font-bold rounded-lg transition-colors shadow shadow-accent/20"
                    title="Export whole report PDF"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>Export full PDF</span>
                  </button>
                </div>
              </div>

              {/* 5-Tab Navigation */}
              <div className="flex items-center gap-1 border-b border-border overflow-x-auto">
                {(["competitive-analysis", "pricing", "go-to-market", "content-form", "artwork"] as Tab[]).map(tab => (
                  <button
                    key={tab}
                    className={`px-4 py-2 border-b-2 font-bold text-xs transition-colors whitespace-nowrap ${
                      activeTab === tab
                        ? "border-accent text-accent"
                        : "border-transparent text-text-secondary hover:text-text-primary"
                    }`}
                    onClick={() => setActiveTab(tab)}
                  >
                    {TAB_LABELS[tab]}
                  </button>
                ))}
              </div>

              {/* Tab Content Canvas */}
              <div className="bg-surface-2 border border-border rounded-xl p-5 md:p-6 shadow-sm">
                {selectedReport && (
                  <ReportTabContent
                    report={selectedReport}
                    activeTab={activeTab}
                    onUpdate={fetchProjectDetails}
                    projectId={id}
                  />
                )}
              </div>
            </div>
          )}

          {/* TDS + GTM live independently of whether a report is linked —
              every project now gets this pipeline automatically on
              creation. Mount condition intentionally only excludes
              "complete" — a "failed" pipeline must stay visible (with its
              Retry button) on every page load, not just live in the same
              session where it failed. */}
          {pipelineState && pipelineState.status !== "complete" && (
            <ProjectGenerationProgress projectId={id} onDone={() => { fetchProjectDetails(); setPipelineState((s: any) => s ? { ...s, status: "complete" } : s); }} />
          )}
          <TdsKnowledgeSection projectId={id} />
          <ProductKnowledgeSection projectId={id} pipelineStatus={pipelineState?.status} pipelinePhase={pipelineState?.phase} />
        </div>
      </div>

      {/* Danger Zone */}
      <div className="bg-surface-2 border border-danger/25 rounded-xl p-5 space-y-3">
        <div className="flex items-center gap-2 text-danger">
          <AlertTriangle className="w-4 h-4" />
          <h2 className="text-xs font-bold uppercase tracking-wider">Danger Zone</h2>
        </div>
        <p className="text-[11px] text-text-muted leading-normal">
          Permanently delete this project and its related database indexes. This action is irreversible.
        </p>
        <button
          onClick={() => setConfirmDeleteOpen(true)}
          className="px-4 py-2 bg-danger/10 border border-danger/35 hover:bg-danger/20 text-danger text-xs font-bold rounded-lg transition-all flex items-center justify-center gap-1.5 w-full sm:w-auto"
        >
          <Trash2 className="w-3.5 h-3.5" />
          <span>Delete project</span>
        </button>
      </div>

      {/* Link Report Modal */}
      <LinkReportModal
        isOpen={linkingReport}
        projectId={id}
        onLinked={fetchProjectDetails}
        onClose={() => setLinkingReport(false)}
      />

      <ConfirmDialog
        isOpen={confirmDeleteOpen}
        title="Delete this project?"
        description="This will permanently delete the project and remove related database indexes. This action is irreversible."
        confirmLabel="Delete project"
        loading={deleting}
        onConfirm={handleDeleteProject}
        onClose={() => setConfirmDeleteOpen(false)}
      />
    </div>
  );
}

const TAB_LABELS: Record<Tab, string> = {
  "competitive-analysis": "Competitive Analysis",
  "pricing":              "Pricing",
  "go-to-market":         "Go To Market",
  "content-form":         "Content Form",
  "artwork":              "Artwork",
};

// ─── Tab Content Container ──────────────────────────────────────────────────
function ReportTabContent({
  report,
  activeTab,
  onUpdate,
  projectId,
}: {
  report: any;
  activeTab: Tab;
  onUpdate: () => void;
  projectId: string;
}) {
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [localData, setLocalData] = useState<any>(null);

  const dataKey = {
    "competitive-analysis": "competitive_analysis",
    "pricing":              "pricing_analysis",
    "go-to-market":         "go_to_market",
    "content-form":         "content_form",
    "artwork":              "artwork",
  }[activeTab];

  const tabData = report[dataKey] || {};

  // Sync local editing state when tab or report changes
  useEffect(() => {
    setLocalData(tabData);
    setEditing(false);
  }, [report.id, activeTab]);

  async function saveEdit() {
    setSaving(true);
    try {
      const res = await fetch(`/api/reports/${report.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [dataKey]: localData })
      });
      if (!res.ok) throw new Error();
      toast.success("Changes saved successfully");
      setEditing(false);
      onUpdate();
    } catch (e) {
      toast.error("Failed to save changes");
    } finally {
      setSaving(false);
    }
  }

  if (activeTab === "artwork") {
    return <ArtworkTab projectId={projectId} />;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between pb-3 border-b border-border">
        <h3 className="text-sm font-bold text-text-primary flex items-center gap-2">
          {activeTab === "competitive-analysis" && <Globe className="w-4 h-4 text-accent" />}
          {activeTab === "pricing" && <DollarSign className="w-4 h-4 text-accent" />}
          {activeTab === "go-to-market" && <Sliders className="w-4 h-4 text-accent" />}
          {activeTab === "content-form" && <Target className="w-4 h-4 text-accent" />}
          <span>{TAB_LABELS[activeTab]}</span>
        </h3>
        
        <div className="flex items-center gap-2">
          <button
            onClick={() => downloadTabPDF(report, activeTab)}
            className="flex items-center gap-1.5 px-3 py-1.5 border border-border bg-surface-3/50 hover:bg-surface-3 text-text-secondary text-[11px] font-bold rounded-lg transition-colors"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Export tab PDF</span>
          </button>
          
          {editing ? (
            <>
              <button 
                onClick={() => { setEditing(false); setLocalData(tabData); }} 
                className="px-3 py-1.5 hover:bg-surface-3 text-text-secondary text-[11px] font-bold rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button 
                onClick={saveEdit} 
                disabled={saving} 
                className="flex items-center gap-1 px-3 py-1.5 bg-accent hover:bg-accent-hover text-white text-[11px] font-bold rounded-lg disabled:opacity-50 transition-colors shadow"
              >
                {saving ? (
                  <Loader2 className="w-3 h-3 animate-spin" />
                ) : (
                  <Check className="w-3 h-3" />
                )}
                <span>Save</span>
              </button>
            </>
          ) : (
            <button 
              onClick={() => { setEditing(true); setLocalData(tabData); }} 
              className="flex items-center gap-1 px-3 py-1.5 border border-border hover:border-border-strong text-text-secondary text-[11px] font-bold rounded-lg transition-colors"
            >
              <Edit2 className="w-3 h-3" />
              <span>Edit</span>
            </button>
          )}
        </div>
      </div>

      {/* RENDER ACTIVE TAB */}
      {activeTab === "competitive-analysis" && (
        <CompetitiveAnalysisTab
          data={tabData}
          editing={editing}
          localData={localData}
          setLocalData={setLocalData}
        />
      )}
      {activeTab === "pricing" && (
        <PricingTab
          data={tabData}
          editing={editing}
          localData={localData}
          setLocalData={setLocalData}
        />
      )}
      {activeTab === "go-to-market" && (
        <GoToMarketTab
          data={tabData}
          editing={editing}
          localData={localData}
          setLocalData={setLocalData}
          projectId={projectId}
        />
      )}
      {activeTab === "content-form" && (
        <ContentFormTab
          data={tabData}
          editing={editing}
          localData={localData}
          setLocalData={setLocalData}
        />
      )}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// COMPETITIVE ANALYSIS TAB VIEW & EDIT
// ────────────────────────────────────────────────────────────────────────────
function CompetitiveAnalysisTab({ data, editing, localData, setLocalData }: any) {
  if (editing) {
    return (
      <div className="space-y-4 text-xs">
        <div className="space-y-1">
          <label className="font-semibold text-text-primary">Market Snapshot Overview</label>
          <textarea
            rows={4}
            value={localData?.market_snapshot?.overview_paragraph || ""}
            onChange={e => setLocalData({
              ...localData,
              market_snapshot: {
                ...localData.market_snapshot,
                overview_paragraph: e.target.value
              }
            })}
            className="w-full px-3 py-2 border border-border rounded-lg bg-surface-1 text-text-primary outline-none focus:border-accent resize-y"
          />
        </div>
        <div className="space-y-1">
          <label className="font-semibold text-text-primary">Positioning Strategy Statement</label>
          <textarea
            rows={3}
            value={localData?.positioning_recommendation || ""}
            onChange={e => setLocalData({
              ...localData,
              positioning_recommendation: e.target.value
            })}
            className="w-full px-3 py-2 border border-border rounded-lg bg-surface-1 text-text-primary outline-none focus:border-accent resize-y"
          />
        </div>
      </div>
    );
  }

  const snapshot = data.market_snapshot || {};
  const trends = data.key_trends || [];
  const gaps = data.market_gaps || [];
  const threats = data.top_threats || [];
  const opps = data.top_opportunities || [];
  const largeComps = data.large_brand_competitors || [];
  const emergingComps = data.indie_emerging_competitors || [];

  return (
    <div className="space-y-6 text-xs">
      {/* Overview Block */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 items-start">
        <div className="p-4 border border-border bg-surface-3/20 rounded-xl space-y-1.5">
          <span className="inline-block px-1.5 py-0.5 rounded text-[8px] font-bold bg-success-bg border border-success/20 text-success uppercase tracking-wider">
            growth
          </span>
          <p className="text-base font-black text-text-primary leading-tight">
            {snapshot.headline_stat_value || snapshot.market_size_current || "Market Growth Analysis"}
          </p>
        </div>
        <p className="md:col-span-3 text-text-secondary leading-relaxed p-1">
          {snapshot.overview_paragraph}
        </p>
      </div>

      {/* Lists block */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5 pt-2">
        {/* Trends */}
        <div className="space-y-2.5">
          <h4 className="text-[10px] font-bold text-text-muted uppercase tracking-wider">Key Industry Trends</h4>
          <ul className="space-y-2">
            {trends.map((t: any, i: number) => (
              <li key={i} className="flex gap-2">
                <span className="text-accent font-bold mt-0.5">•</span>
                <p className="text-text-secondary">
                  <strong className="text-text-primary">{t.trend_name}:</strong> {t.description}
                </p>
              </li>
            ))}
          </ul>
        </div>
        {/* Gaps */}
        <div className="space-y-2.5">
          <h4 className="text-[10px] font-bold text-text-muted uppercase tracking-wider">Market Gaps</h4>
          <ul className="space-y-2">
            {gaps.map((g: any, i: number) => (
              <li key={i} className="flex gap-2 text-text-secondary">
                <span className="text-text-muted font-bold mt-0.5">·</span>
                <span>{g}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>

      {/* Threats / Opportunities */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5 pt-2 border-t border-border/40">
        {/* Threats */}
        <div className="space-y-2.5">
          <h4 className="text-[10px] font-bold text-text-muted uppercase tracking-wider flex items-center gap-1.5">
            <AlertTriangle className="w-3.5 h-3.5 text-danger" />
            <span>Top Threats</span>
          </h4>
          <ul className="space-y-2">
            {threats.map((t: any, i: number) => (
              <li key={i} className="flex gap-2">
                <span className="text-danger font-bold mt-0.5">−</span>
                <p className="text-text-secondary">
                  <strong className="text-text-primary">{t.competitor_name}:</strong> {t.threat_description}
                </p>
              </li>
            ))}
          </ul>
        </div>
        {/* Opportunities */}
        <div className="space-y-2.5">
          <h4 className="text-[10px] font-bold text-text-muted uppercase tracking-wider flex items-center gap-1.5">
            <Lightbulb className="w-3.5 h-3.5 text-success" />
            <span>Top Opportunities</span>
          </h4>
          <ul className="space-y-2">
            {opps.map((o: any, i: number) => (
              <li key={i} className="flex gap-2">
                <span className="text-success font-bold mt-0.5">+</span>
                <p className="text-text-secondary">
                  <strong className="text-text-primary">{o.action}:</strong> {o.description}
                </p>
              </li>
            ))}
          </ul>
        </div>
      </div>

      {/* Competitors List (Legacy) */}
      <div className="space-y-3 pt-3 border-t border-border/40">
        <h4 className="text-[10px] font-bold text-text-muted uppercase tracking-wider">Large & Established Brands</h4>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {largeComps.map((c: any, i: number) => (
            <div key={i} className="p-3 bg-surface-3/30 border border-border rounded-lg space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="font-bold text-text-primary">{c.name}</span>
                <a href={c.amazon_url} target="_blank" rel="noopener noreferrer" className="text-[10px] text-accent hover:underline">
                  {c.verified_by_rainforest === false ? "Search Amazon ↗" : "Amazon Listing ↗"}
                </a>
              </div>
              <div className="text-[10px] text-text-muted flex justify-between">
                <span>Brand: {c.brand}</span>
                <span className="text-text-secondary font-bold">{c.price || "—"}</span>
                <span>★ {c.rating || "—"} ({c.review_count || "—"})</span>
              </div>
              {c.verified_by_rainforest === false && (
                <span className="inline-block px-1.5 py-0.5 rounded text-[8px] font-bold bg-warning-bg border border-warning/20 text-warning uppercase tracking-wider">
                  Unverified — not matched on Amazon
                </span>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Competitors List (Emerging) */}
      <div className="space-y-3 pt-3 border-t border-border/40">
        <h4 className="text-[10px] font-bold text-text-muted uppercase tracking-wider">Indie & Emerging Brands</h4>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {emergingComps.map((c: any, i: number) => (
            <div key={i} className="p-3 bg-surface-3/30 border border-border rounded-lg space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="font-bold text-text-primary">{c.name}</span>
                <a href={c.amazon_url} target="_blank" rel="noopener noreferrer" className="text-[10px] text-accent hover:underline">
                  {c.verified_by_rainforest === false ? "Search Amazon ↗" : "Amazon Listing ↗"}
                </a>
              </div>
              <div className="text-[10px] text-text-muted flex justify-between">
                <span>Brand: {c.brand}</span>
                <span className="text-text-secondary font-bold">{c.price || "—"}</span>
                <span>★ {c.rating || "—"} ({c.review_count || "—"})</span>
              </div>
              {c.verified_by_rainforest === false && (
                <span className="inline-block px-1.5 py-0.5 rounded text-[8px] font-bold bg-warning-bg border border-warning/20 text-warning uppercase tracking-wider">
                  Unverified — not matched on Amazon
                </span>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Positioning Statement */}
      <div className="p-4 bg-accent-bg/10 border border-accent-border/50 rounded-xl space-y-1 mt-4">
        <h4 className="text-[10px] font-bold text-accent-text uppercase tracking-wider">Positioning Recommendation</h4>
        <p className="text-text-secondary leading-relaxed italic">{data.positioning_recommendation}</p>
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// PRICING TAB VIEW & EDIT
// ────────────────────────────────────────────────────────────────────────────
function PricingTab({ data, editing, localData, setLocalData }: any) {
  if (editing) {
    return (
      <div className="space-y-4 text-xs">
        <div className="space-y-1">
          <label className="font-semibold text-text-primary">Pricing Index / Headline Positioning</label>
          <input
            type="text"
            value={localData?.price_positioning || ""}
            onChange={e => setLocalData({ ...localData, price_positioning: e.target.value })}
            className="w-full px-3 py-2 border border-border rounded-lg bg-surface-1 text-text-primary outline-none focus:border-accent"
          />
        </div>
        <div className="space-y-1">
          <label className="font-semibold text-text-primary">Pricing Strategy Notes</label>
          <textarea
            rows={5}
            value={localData?.notes || ""}
            onChange={e => setLocalData({ ...localData, notes: e.target.value })}
            className="w-full px-3 py-2 border border-border rounded-lg bg-surface-1 text-text-primary outline-none focus:border-accent resize-y"
            placeholder="Type strategic pricing notes here..."
          />
        </div>
      </div>
    );
  }

  const prices = data.competitors_pricing || [];

  return (
    <div className="space-y-5 text-xs">
      <div className="p-4 bg-surface-3/30 border border-border rounded-xl">
        <span className="text-[10px] text-text-muted uppercase font-bold tracking-wider">Price Positioning Headline</span>
        <p className="text-sm font-bold text-text-primary mt-1">{data.price_positioning || "No pricing headline recorded."}</p>
      </div>

      <div className="space-y-2">
        <h4 className="text-[10px] font-bold text-text-muted uppercase tracking-wider">Competitor Price Index</h4>
        <div className="border border-border rounded-xl overflow-hidden">
          <table className="w-full border-collapse text-left">
            <thead>
              <tr className="bg-surface-3/50 border-b border-border text-[10px] text-text-muted uppercase font-mono">
                <th className="p-3">Competitor Name</th>
                <th className="p-3">Price Point</th>
                <th className="p-3">Market Tier</th>
              </tr>
            </thead>
            <tbody>
              {prices.map((p: any, i: number) => (
                <tr key={i} className="border-b border-border hover:bg-surface-3/10 transition-colors">
                  <td className="p-3 font-semibold text-text-primary">{p.name}</td>
                  <td className="p-3 font-mono text-accent font-bold">{p.price || "—"}</td>
                  <td className="p-3">
                    <span className={`inline-flex px-1.5 py-0.5 rounded text-[8px] font-bold uppercase tracking-wider ${
                      p.tier === "large" ? "bg-indigo-950 text-indigo-300" : "bg-emerald-950 text-emerald-300"
                    }`}>
                      {p.tier}
                    </span>
                  </td>
                </tr>
              ))}
              {prices.length === 0 && (
                <tr>
                  <td colSpan={3} className="p-4 text-center text-text-muted">No competitor pricing mapped.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="space-y-1.5">
        <h4 className="text-[10px] font-bold text-text-muted uppercase tracking-wider">Pricing Strategy Notes</h4>
        <p className="text-text-secondary leading-relaxed bg-surface-3/15 p-3 rounded-lg border border-border/40 whitespace-pre-wrap">
          {data.notes || "Add strategy notes by clicking Edit."}
        </p>
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// GO TO MARKET TAB VIEW & EDIT
// ────────────────────────────────────────────────────────────────────────────
function GoToMarketTab({ data, editing, localData, setLocalData, projectId }: any) {
  const [recsOpen, setRecsOpen] = useState(false);

  const editBlock = editing && (
    <div className="space-y-4 text-xs">
      <div className="space-y-1">
        <label className="font-semibold text-text-primary">Positioning Strategy</label>
        <textarea
          rows={3}
          value={localData?.positioning || ""}
          onChange={e => setLocalData({ ...localData, positioning: e.target.value })}
          className="w-full px-3 py-2 border border-border rounded-lg bg-surface-1 text-text-primary outline-none focus:border-accent resize-y"
        />
      </div>
      <div className="space-y-1">
        <label className="font-semibold text-text-primary">Strategic notes & deployment details</label>
        <textarea
          rows={4}
          value={localData?.notes || ""}
          onChange={e => setLocalData({ ...localData, notes: e.target.value })}
          className="w-full px-3 py-2 border border-border rounded-lg bg-surface-1 text-text-primary outline-none focus:border-accent resize-y"
          placeholder="Type strategic details..."
        />
      </div>
    </div>
  );

  const recs = data.recommendations || [];
  const wins = data.quick_wins || [];

  return (
    <div className="space-y-6 text-xs">
      {editing ? (
        editBlock
      ) : (
        <div className="border border-border rounded-xl overflow-hidden">
          <button
            type="button"
            onClick={() => setRecsOpen(o => !o)}
            className="w-full flex items-center justify-between px-4 py-3 bg-surface-3/30 hover:bg-surface-3/50 transition-colors"
          >
            <span className="text-[10px] font-bold text-text-muted uppercase tracking-wider">Strategic Recommendations</span>
            <ChevronRight className={`w-3.5 h-3.5 text-text-muted transition-transform ${recsOpen ? "rotate-90" : ""}`} />
          </button>
          {recsOpen && (
            <div className="p-4 space-y-5">
              <div className="p-4 bg-surface-3/30 border border-border rounded-xl">
                <span className="text-[10px] text-text-muted uppercase font-bold tracking-wider">Core Positioning Statement</span>
                <p className="text-text-primary leading-relaxed mt-1 italic">{data.positioning || "No core positioning recorded."}</p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                <div className="space-y-2.5">
                  <h4 className="text-[10px] font-bold text-text-muted uppercase tracking-wider">Strategic Recommendations</h4>
                  <div className="space-y-3">
                    {recs.map((r: any, i: number) => {
                      const priorityColors =
                        r.priority === "high" ? "border-l-2 border-danger bg-danger-bg/5 p-3 rounded-lg" :
                        r.priority === "medium" ? "border-l-2 border-warning bg-warning-bg/5 p-3 rounded-lg" :
                        "border-l-2 border-zinc-500 bg-surface-3/20 p-3 rounded-lg";
                      return (
                        <div key={i} className={priorityColors}>
                          <div className="flex items-center justify-between">
                            <span className="font-bold text-text-primary">{r.title || r.headline}</span>
                            <span className={`px-1.5 py-0.5 rounded text-[8px] font-bold uppercase tracking-wider border ${
                              r.priority === "high" ? "bg-danger/10 border-danger/25 text-danger" :
                              r.priority === "medium" ? "bg-warning/10 border-warning/25 text-warning" :
                              "bg-zinc-800 border-zinc-700 text-zinc-400"
                            }`}>
                              {r.priority}
                            </span>
                          </div>
                          <p className="text-text-muted text-[10px] mt-1.5 leading-relaxed">{r.detail || r.explanation}</p>
                        </div>
                      );
                    })}
                  </div>
                </div>

                <div className="space-y-2.5">
                  <h4 className="text-[10px] font-bold text-text-muted uppercase tracking-wider">Tactical Quick Wins</h4>
                  <ul className="space-y-2">
                    {wins.map((w: any, i: number) => (
                      <li key={i} className="flex gap-2">
                        <span className="text-accent font-bold font-mono mt-0.5">»</span>
                        <span className="text-text-secondary leading-normal">{w}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>

              <div className="space-y-1.5 pt-3 border-t border-border/40">
                <h4 className="text-[10px] font-bold text-text-muted uppercase tracking-wider">GTM Deployment Notes</h4>
                <p className="text-text-secondary leading-relaxed bg-surface-3/15 p-3 rounded-lg border border-border/40 whitespace-pre-wrap">
                  {data.notes || "Add deployment details by clicking Edit."}
                </p>
              </div>
            </div>
          )}
        </div>
      )}

    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// TECHNICAL DATA SHEET (live product snapshot — no AI regenerate)
// ────────────────────────────────────────────────────────────────────────────
const TDS_SOURCE_LABELS: Record<string, string> = {
  amazon: "Amazon",
  official_site: "Product Page",
  product_snapshot: "Snapshot",
  project_record: "Project",
  manual_edit: "Manual",
  none: "Not Listed",
};

function isTdsFieldComplete(answer: string | null | undefined) {
  const trimmed = (answer || "").trim();
  return trimmed !== "" && trimmed.toUpperCase() !== "N/A" && trimmed !== "Not listed on product page";
}

function tdsFlagReason(detail: any): string {
  if (!detail) return "Flagged";
  if (detail.reason === "ungrounded") return `Rejected — the extracted answer ("${detail.rejectedAnswer}") wasn't found in the snapshot`;
  if (detail.conflict) return `Sources disagree: ${detail.conflict.map((c: any) => `${c.source}="${c.answer}"`).join(" vs ")}`;
  return "Flagged for review";
}

function snapshotDomain(sourceUrl: string | null | undefined, asin: string | null | undefined): string | null {
  if (sourceUrl) {
    try { return new URL(sourceUrl).hostname.replace(/^www\./, ""); } catch { return sourceUrl; }
  }
  return asin ? `Amazon (${asin})` : null;
}

function TdsKnowledgeSection({ projectId }: { projectId: string }) {
  const [documentId, setDocumentId] = useState<string | null>(null);
  const [snapshotMeta, setSnapshotMeta] = useState<{ capturedAt: string | null; sourceUrl: string | null; asin: string | null }>({ capturedAt: null, sourceUrl: null, asin: null });
  const [fields, setFields] = useState<Record<string, FieldRow>>({});
  const [loading, setLoading] = useState(true);
  const [capturing, setCapturing] = useState(false);
  const [fieldStatus, setFieldStatus] = useState<Record<string, FieldStatus>>({});
  const debounceTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/documents/tds?projectId=${projectId}`);
        const data = await res.json();
        if (data.document) {
          setDocumentId(data.document.id);
          setSnapshotMeta({
            capturedAt: data.document.snapshot_captured_at ?? null,
            sourceUrl: data.document.snapshot_source_url ?? null,
            asin: data.document.snapshot_asin ?? null,
          });
          const map: Record<string, FieldRow> = {};
          for (const f of data.fields) map[f.field_id] = f;
          setFields(map);
        }
      } catch (e) {}
      setLoading(false);
    })();
  }, [projectId]);

  const completedCount = TDS_FIELD_SCHEMA.reduce((n, f) => n + (isTdsFieldComplete(fields[f.id]?.answer) ? 1 : 0), 0);

  async function handleCapture() {
    setCapturing(true);
    try {
      const res = await fetch(`/api/projects/${projectId}/snapshot`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Snapshot capture failed");
      setDocumentId(data.document.id);
      setSnapshotMeta({
        capturedAt: data.document.snapshot_captured_at ?? null,
        sourceUrl: data.document.snapshot_source_url ?? null,
        asin: data.document.snapshot_asin ?? null,
      });
      const map: Record<string, FieldRow> = {};
      for (const f of data.fields) map[f.field_id] = f;
      setFields(map);
      toast.success("Live product snapshot captured");
    } catch (err: any) {
      toast.error(err.message || "Failed to capture snapshot");
    } finally {
      setCapturing(false);
    }
  }

  function handleFieldChange(fieldId: string, value: string) {
    setFields(prev => ({ ...prev, [fieldId]: { ...prev[fieldId], answer: value } }));
    if (debounceTimers.current[fieldId]) clearTimeout(debounceTimers.current[fieldId]);
    debounceTimers.current[fieldId] = setTimeout(() => saveField(fieldId, value), 800);
  }

  async function saveField(fieldId: string, value: string) {
    if (!documentId) return;
    setFieldStatus(prev => ({ ...prev, [fieldId]: "saving" }));
    try {
      const res = await fetch(`/api/documents/tds/${documentId}/fields/${fieldId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ answer: value }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setFields(prev => ({ ...prev, [fieldId]: data.field }));
      setFieldStatus(prev => ({ ...prev, [fieldId]: "saved" }));
      setTimeout(() => setFieldStatus(prev => (prev[fieldId] === "saved" ? { ...prev, [fieldId]: "idle" } : prev)), 1500);
    } catch (e) {
      toast.error("Failed to save field");
      setFieldStatus(prev => ({ ...prev, [fieldId]: "idle" }));
    }
  }

  async function handleRevert(fieldId: string) {
    if (!documentId) return;
    setFieldStatus(prev => ({ ...prev, [fieldId]: "saving" }));
    try {
      const res = await fetch(`/api/documents/tds/${documentId}/fields/${fieldId}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Nothing to revert to");
      setFields(prev => ({ ...prev, [fieldId]: data.field }));
      toast.success("Reverted to previous value");
    } catch (err: any) {
      toast.error(err.message || "Failed to revert field");
    } finally {
      setFieldStatus(prev => ({ ...prev, [fieldId]: "idle" }));
    }
  }

  const hasDocument = !!documentId;
  const domain = snapshotDomain(snapshotMeta.sourceUrl, snapshotMeta.asin);

  return (
    <div className="border border-border rounded-xl overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 bg-surface-3/30 border-b border-border flex-wrap gap-2">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[10px] font-bold text-text-muted uppercase tracking-wider">Technical Data Sheet</span>
          {hasDocument && (
            <span className="text-[10px] font-mono text-text-secondary px-1.5 py-0.5 rounded bg-surface-3 border border-border">
              {completedCount}/{TDS_FIELD_SCHEMA.length} fields completed
            </span>
          )}
          {snapshotMeta.capturedAt && (
            <span className="text-[10px] text-text-muted italic">
              Live snapshot captured {new Date(snapshotMeta.capturedAt).toLocaleString()}{domain ? ` from ${domain}` : ""}
            </span>
          )}
        </div>
        <button
          onClick={handleCapture}
          disabled={capturing || loading}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-accent hover:bg-accent-hover text-white text-[11px] font-bold rounded-lg disabled:opacity-50 transition-colors shadow"
        >
          {capturing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
          <span>{hasDocument ? "Re-capture snapshot" : "Capture snapshot"}</span>
        </button>
      </div>

      {loading ? (
        <p className="p-4 text-text-muted text-[11px]">Loading…</p>
      ) : !hasDocument ? (
        <p className="p-4 text-text-muted text-[11px]">
          Capture a live snapshot from the product&apos;s official page and/or Amazon listing to fill this Technical
          Data Sheet with real, verifiable specs — no AI regeneration, just a real-time capture you can hand-edit.
          {!snapshotMeta.sourceUrl && !snapshotMeta.asin && " Add a product URL or ASIN to this project first."}
        </p>
      ) : (
        <div className="divide-y divide-border/60">
          {TDS_SECTIONS.map(section => (
            <div key={section} className="p-4 space-y-3">
              <h4 className="text-[10px] font-bold text-text-muted uppercase tracking-wider">{section}</h4>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-3">
                {TDS_FIELD_SCHEMA.filter(f => f.section === section).map(f => {
                  const entry = fields[f.id];
                  const complete = isTdsFieldComplete(entry?.answer);
                  const status = fieldStatus[f.id] || "idle";
                  const flagged = !!entry?.flagged;
                  // Same distinction as the GTM grid below: "never captured yet"
                  // (still needs attention) vs "captured but confirmed not
                  // listed" (a settled, non-urgent answer) — previously both
                  // rendered as an identical amber chip.
                  const isPending = !complete && (entry?.answer ?? "").trim() === "";
                  const isSettledNA = !complete && !isPending;
                  const chipClass = flagged
                    ? "bg-danger/10 border-danger/30 text-danger"
                    : isPending
                    ? "bg-warning/10 border-warning/25 text-warning"
                    : isSettledNA
                    ? "bg-surface-3 border-border text-text-muted"
                    : "bg-surface-3 border-border text-text-muted";
                  return (
                    <div key={f.id} className="flex flex-col gap-1">
                      <div className="flex items-center justify-between gap-2">
                        <label className="font-semibold text-text-primary text-[11px] flex items-center gap-1">
                          {f.question}
                          {flagged && (
                            <AlertCircle className="w-3 h-3 text-danger shrink-0" aria-label={tdsFlagReason(entry?.source_detail)} />
                          )}
                        </label>
                        <div className="flex items-center gap-1 shrink-0">
                          <span className={`text-[8px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded border ${chipClass}`}>
                            {TDS_SOURCE_LABELS[entry?.source || "none"]}
                          </span>
                          <button
                            type="button"
                            title="Revert to previous value"
                            onClick={() => handleRevert(f.id)}
                            className="p-0.5 text-text-muted hover:text-text-primary transition-colors"
                          >
                            <Undo2 className="w-3 h-3" />
                          </button>
                        </div>
                      </div>
                      <textarea
                        rows={2}
                        value={entry?.answer || ""}
                        onChange={e => handleFieldChange(f.id, e.target.value)}
                        title={flagged ? tdsFlagReason(entry?.source_detail) : undefined}
                        className={`w-full px-2.5 py-1.5 border rounded-lg bg-surface-1 text-text-primary outline-none focus:border-accent resize-y text-[11px] ${
                          flagged ? "border-danger/40" : "border-border"
                        }`}
                      />
                      <div className="h-3 text-[9px] text-text-muted">
                        {status === "saving" && "Saving…"}
                        {status === "saved" && "Saved ✓"}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// PRODUCT KNOWLEDGE (74-field GTM generator)
// ────────────────────────────────────────────────────────────────────────────
const SOURCE_LABELS = GTM_SOURCE_LABELS;

const OWNER_OPTIONS = ["Product Marketing", "Marketing", "Sales", "Legal", "Ops"];

function isFieldComplete(answer: string | null | undefined) {
  const trimmed = (answer || "").trim();
  return trimmed !== "" && trimmed.toUpperCase() !== "N/A";
}

type FieldRow = {
  field_id: string;
  answer: string | null;
  source: string | null;
  source_detail: any;
  flagged: boolean;
  owner?: string | null;
  notes?: string | null;
};
type FieldStatus = "idle" | "saving" | "saved" | "regenerating";

function flagReason(detail: any): string {
  if (!detail) return "Flagged";
  if (detail.reason === "ungrounded") return `Rejected — AI's answer ("${detail.rejectedAnswer}") wasn't found in any source`;
  if (detail.reason === "boilerplate") return `Too similar to another product's answer for this field: "${detail.similarTo}"`;
  if (detail.conflict) return `Sources disagree: ${detail.conflict.map((c: any) => `${c.source}="${c.answer}"`).join(" vs ")}`;
  return "Flagged for review";
}

function ProductKnowledgeSection({ projectId, pipelineStatus, pipelinePhase }: { projectId: string; pipelineStatus?: string; pipelinePhase?: string }) {
  const [documentId, setDocumentId] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, FieldRow>>({});
  const [loading, setLoading] = useState(true);
  const [fieldStatus, setFieldStatus] = useState<Record<string, FieldStatus>>({});
  const debounceTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/documents/gtm?projectId=${projectId}`);
        const data = await res.json();
        if (data.document) {
          setDocumentId(data.document.id);
          const map: Record<string, FieldRow> = {};
          for (const f of data.fields) map[f.field_id] = f;
          setFields(map);
        }
      } catch (e) {}
      setLoading(false);
    })();
    // Re-fetch whenever the auto-generation pipeline's status changes (e.g.
    // transitions to "complete") — otherwise a freshly-finished GTM document
    // only ever appeared after a manual page reload, since this fetch used
    // to depend only on projectId.
  }, [projectId, pipelineStatus]);

  const completedCount = GTM_FIELD_SCHEMA.reduce((n, f) => n + (isFieldComplete(fields[f.id]?.answer) ? 1 : 0), 0);

  function handleFieldChange(fieldId: string, value: string) {
    setFields(prev => ({ ...prev, [fieldId]: { ...prev[fieldId], answer: value } }));
    if (debounceTimers.current[fieldId]) clearTimeout(debounceTimers.current[fieldId]);
    debounceTimers.current[fieldId] = setTimeout(() => saveField(fieldId, value), 800);
  }

  async function saveField(fieldId: string, value: string) {
    if (!documentId) return;
    setFieldStatus(prev => ({ ...prev, [fieldId]: "saving" }));
    try {
      const res = await fetch(`/api/documents/gtm/${documentId}/fields/${fieldId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ answer: value }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setFields(prev => ({ ...prev, [fieldId]: data.field }));
      setFieldStatus(prev => ({ ...prev, [fieldId]: "saved" }));
      setTimeout(() => setFieldStatus(prev => (prev[fieldId] === "saved" ? { ...prev, [fieldId]: "idle" } : prev)), 1500);
    } catch (e) {
      toast.error("Failed to save field");
      setFieldStatus(prev => ({ ...prev, [fieldId]: "idle" }));
    }
  }

  async function handleRegenerate(fieldId: string) {
    if (!documentId) return;
    setFieldStatus(prev => ({ ...prev, [fieldId]: "regenerating" }));
    try {
      const res = await fetch(`/api/documents/gtm/${documentId}/fields/${fieldId}/regenerate`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Regeneration failed");
      setFields(prev => ({ ...prev, [fieldId]: data.field }));
      toast.success("Field regenerated");
    } catch (err: any) {
      toast.error(err.message || "Failed to regenerate field");
    } finally {
      setFieldStatus(prev => ({ ...prev, [fieldId]: "idle" }));
    }
  }

  async function handleRevert(fieldId: string) {
    if (!documentId) return;
    setFieldStatus(prev => ({ ...prev, [fieldId]: "saving" }));
    try {
      const res = await fetch(`/api/documents/gtm/${documentId}/fields/${fieldId}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Nothing to revert to");
      setFields(prev => ({ ...prev, [fieldId]: data.field }));
      toast.success("Reverted to previous value");
    } catch (err: any) {
      toast.error(err.message || "Failed to revert field");
    } finally {
      setFieldStatus(prev => ({ ...prev, [fieldId]: "idle" }));
    }
  }

  function handleOwnerChange(fieldId: string, owner: string) {
    setFields(prev => ({ ...prev, [fieldId]: { ...prev[fieldId], owner } }));
    saveMeta(fieldId, { owner });
  }

  function handleNotesChange(fieldId: string, notes: string) {
    setFields(prev => ({ ...prev, [fieldId]: { ...prev[fieldId], notes } }));
    if (debounceTimers.current[`notes:${fieldId}`]) clearTimeout(debounceTimers.current[`notes:${fieldId}`]);
    debounceTimers.current[`notes:${fieldId}`] = setTimeout(() => saveMeta(fieldId, { notes }), 800);
  }

  async function saveMeta(fieldId: string, meta: { owner?: string; notes?: string }) {
    if (!documentId) return;
    setFieldStatus(prev => ({ ...prev, [fieldId]: "saving" }));
    try {
      const res = await fetch(`/api/documents/gtm/${documentId}/fields/${fieldId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(meta),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setFields(prev => ({ ...prev, [fieldId]: data.field }));
      setFieldStatus(prev => ({ ...prev, [fieldId]: "saved" }));
      setTimeout(() => setFieldStatus(prev => (prev[fieldId] === "saved" ? { ...prev, [fieldId]: "idle" } : prev)), 1500);
    } catch (e) {
      toast.error("Failed to save");
      setFieldStatus(prev => ({ ...prev, [fieldId]: "idle" }));
    }
  }

  const hasDocument = !!documentId;
  // GTM now generates automatically (see app/api/projects/route.ts +
  // lib/project-generation-engine.ts) — no manual trigger button. This is a
  // read-only reflection of the same project_generation_state the top-level
  // ProjectGenerationProgress banner drives; deliberately not a second
  // independent poller/retry (see that banner for the Retry action).
  const isGtmPhaseRunning = pipelinePhase === "gtm" && (pipelineStatus === "running" || pipelineStatus === "pending");
  const isQueued = !hasDocument && !isGtmPhaseRunning && (pipelineStatus === "pending" || pipelineStatus === "running");
  const pipelineFailed = !hasDocument && pipelineStatus === "failed";

  return (
    <div className="border border-border rounded-xl overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 bg-surface-3/30 border-b border-border">
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-bold text-text-muted uppercase tracking-wider">Product Knowledge</span>
          {hasDocument && (
            <span className="text-[10px] font-mono text-text-secondary px-1.5 py-0.5 rounded bg-surface-3 border border-border">
              {completedCount}/{GTM_FIELD_SCHEMA.length} fields completed
            </span>
          )}
          {!hasDocument && isGtmPhaseRunning && (
            <span className="flex items-center gap-1.5 text-[10px] font-bold text-accent px-1.5 py-0.5 rounded bg-accent-bg border border-accent-border">
              <Loader2 className="w-3 h-3 animate-spin" /> Generating…
            </span>
          )}
          {!hasDocument && isQueued && (
            <span className="text-[10px] font-bold text-text-muted px-1.5 py-0.5 rounded bg-surface-3 border border-border">Queued</span>
          )}
          {pipelineFailed && (
            <span className="text-[10px] font-bold text-danger px-1.5 py-0.5 rounded bg-danger-bg border border-danger/25">
              Generation failed — see retry above
            </span>
          )}
        </div>
        {hasDocument && (
          <a
            href={`/api/documents/gtm/${documentId}/export-csv`}
            className="flex items-center gap-1.5 px-3 py-1.5 border border-border hover:border-border-strong text-text-secondary text-[11px] font-bold rounded-lg transition-colors"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Download CSV</span>
          </a>
        )}
      </div>

      {loading ? (
        <p className="p-4 text-text-muted text-[11px]">Loading…</p>
      ) : !hasDocument ? (
        <p className="p-4 text-text-muted text-[11px]">
          {isGtmPhaseRunning
            ? "Generating the 74-field product knowledge sheet now…"
            : isQueued
            ? "Queued for automatic generation from this project's Sales Kit, TDS, and Active Report."
            : pipelineFailed
            ? "Automatic generation failed — use Retry above to resume."
            : "This project hasn't been queued for Go-To-Market generation yet."}
        </p>
      ) : (
        <div className="divide-y divide-border/60">
          {GTM_SECTIONS.map(section => (
            <div key={section} className="p-4 space-y-3">
              <h4 className="text-[10px] font-bold text-text-muted uppercase tracking-wider">{section}</h4>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-3">
                {GTM_FIELD_SCHEMA.filter(f => f.section === section).map(f => {
                  const entry = fields[f.id];
                  const complete = isFieldComplete(entry?.answer);
                  const status = fieldStatus[f.id] || "idle";
                  const flagged = !!entry?.flagged;
                  // Distinguish "never generated yet" (no answer at all — still
                  // needs attention) from "AI/derivation explicitly decided N/A"
                  // (a real, settled answer) — both used to render as an
                  // identical amber "N/A" chip, indistinguishable at a glance
                  // across a 74-row grid.
                  const isPending = !complete && (entry?.answer ?? "").trim() === "";
                  const isSettledNA = !complete && !isPending;
                  const chipClass = flagged
                    ? "bg-danger/10 border-danger/30 text-danger"
                    : isPending
                    ? "bg-warning/10 border-warning/25 text-warning"
                    : isSettledNA
                    ? "bg-surface-3 border-border text-text-muted"
                    : entry?.source === "web"
                    ? "bg-accent-bg border-accent-border text-accent-text"
                    : "bg-surface-3 border-border text-text-muted";
                  return (
                    <div key={f.id} className="flex flex-col gap-1">
                      <div className="flex items-center justify-between gap-2">
                        <label className="font-semibold text-text-primary text-[11px] flex items-center gap-1">
                          {f.question}
                          {flagged && (
                            <AlertCircle className="w-3 h-3 text-danger shrink-0" aria-label={flagReason(entry?.source_detail)} />
                          )}
                        </label>
                        <div className="flex items-center gap-1 shrink-0">
                          <span className={`text-[8px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded border ${chipClass}`}>
                            {SOURCE_LABELS[entry?.source || "none"]}
                          </span>
                          <button
                            type="button"
                            title="Regenerate this field"
                            onClick={() => handleRegenerate(f.id)}
                            disabled={status === "regenerating"}
                            className="p-0.5 text-text-muted hover:text-accent transition-colors disabled:opacity-50"
                          >
                            <RefreshCw className={`w-3 h-3 ${status === "regenerating" ? "animate-spin" : ""}`} />
                          </button>
                          <button
                            type="button"
                            title="Revert to previous value"
                            onClick={() => handleRevert(f.id)}
                            className="p-0.5 text-text-muted hover:text-text-primary transition-colors"
                          >
                            <Undo2 className="w-3 h-3" />
                          </button>
                        </div>
                      </div>
                      <textarea
                        rows={2}
                        value={entry?.answer || ""}
                        onChange={e => handleFieldChange(f.id, e.target.value)}
                        title={flagged ? flagReason(entry?.source_detail) : undefined}
                        className={`w-full px-2.5 py-1.5 border rounded-lg bg-surface-1 text-text-primary outline-none focus:border-accent resize-y text-[11px] ${
                          flagged ? "border-danger/40" : "border-border"
                        }`}
                      />
                      <div className="flex items-center gap-2">
                        <select
                          value={entry?.owner || "Product Marketing"}
                          onChange={e => handleOwnerChange(f.id, e.target.value)}
                          title="Owner"
                          className="px-1.5 py-1 border border-border rounded-md bg-surface-1 text-text-secondary text-[9px] outline-none focus:border-accent"
                        >
                          {OWNER_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
                        </select>
                        <input
                          type="text"
                          value={entry?.notes || ""}
                          onChange={e => handleNotesChange(f.id, e.target.value)}
                          placeholder="Notes…"
                          className="flex-1 px-1.5 py-1 border border-border rounded-md bg-surface-1 text-text-secondary placeholder-text-muted text-[9px] outline-none focus:border-accent"
                        />
                      </div>
                      <div className="h-3 text-[9px] text-text-muted">
                        {status === "saving" && "Saving…"}
                        {status === "saved" && "Saved ✓"}
                        {status === "regenerating" && "Regenerating…"}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// CREATIVE BRIEF / CONTENT FORM TAB VIEW & EDIT
// ────────────────────────────────────────────────────────────────────────────
function ContentFormTab({ data, editing, localData, setLocalData }: any) {
  if (editing) {
    return (
      <div className="space-y-4 text-xs">
        <div className="space-y-1">
          <label className="font-semibold text-text-primary">Target Audience Personas</label>
          <textarea
            rows={3}
            value={localData?.target_audience || ""}
            onChange={e => setLocalData({ ...localData, target_audience: e.target.value })}
            className="w-full px-3 py-2 border border-border rounded-lg bg-surface-1 text-text-primary outline-none focus:border-accent resize-y"
            placeholder="Type target audience detail..."
          />
        </div>
        <div className="space-y-1">
          <label className="font-semibold text-text-primary">Content Strategy Notes</label>
          <textarea
            rows={4}
            value={localData?.notes || ""}
            onChange={e => setLocalData({ ...localData, notes: e.target.value })}
            className="w-full px-3 py-2 border border-border rounded-lg bg-surface-1 text-text-primary outline-none focus:border-accent resize-y"
            placeholder="Type custom creative specifications..."
          />
        </div>
      </div>
    );
  }

  const messages = data.key_messages || [];

  return (
    <div className="space-y-5 text-xs">
      <div className="p-4 bg-surface-3/30 border border-border rounded-xl space-y-1">
        <span className="text-[10px] text-text-muted uppercase font-bold tracking-wider block">Initiative / Product Name</span>
        <span className="text-sm font-bold text-text-primary">{data.product_name || "Stylecraft Tool Launch"}</span>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        <div className="space-y-2.5">
          <h4 className="text-[10px] font-bold text-text-muted uppercase tracking-wider">Core Creative Messages</h4>
          <ul className="space-y-2.5">
            {messages.map((m: any, i: number) => (
              <li key={i} className="flex gap-2">
                <span className="text-accent font-bold mt-0.5">•</span>
                <span className="text-text-secondary leading-normal font-medium">{m}</span>
              </li>
            ))}
            {messages.length === 0 && (
              <li className="text-text-muted italic">No key messages recorded.</li>
            )}
          </ul>
        </div>

        <div className="space-y-2.5">
          <h4 className="text-[10px] font-bold text-text-muted uppercase tracking-wider">Target Audience Profile</h4>
          <p className="text-text-secondary leading-relaxed bg-surface-3/15 p-3 rounded-lg border border-border/40 whitespace-pre-wrap">
            {data.target_audience || "Define a target audience segment by clicking Edit."}
          </p>
        </div>
      </div>

      <div className="space-y-1.5 pt-3 border-t border-border/40">
        <h4 className="text-[10px] font-bold text-text-muted uppercase tracking-wider">Brief Notes</h4>
        <p className="text-text-secondary leading-relaxed bg-surface-3/15 p-3 rounded-lg border border-border/40 whitespace-pre-wrap">
          {data.notes || "Add custom brief details by clicking Edit."}
        </p>
      </div>
    </div>
  );
}

// LinkReportModal subcomponent deleted in favor of shared import

// ────────────────────────────────────────────────────────────────────────────
// PROJECT OUTPUTS BAR COMPONENT (Sales Kit, TDS, Drive)
// ────────────────────────────────────────────────────────────────────────────
function ProjectOutputsBar({ project, report }: { project: any; report: any }) {
  const [generating, setGenerating] = useState<string | null>(null);
  const [viewing, setViewing] = useState<string | null>(null);
  const [downloadingPdf, setDownloadingPdf] = useState<string | null>(null);
  const [generatedHtml, setGeneratedHtml] = useState<Record<string, string>>({});
  const [driveUrls, setDriveUrls] = useState<Record<string, string | null>>({});
  const [hasGtm, setHasGtm] = useState(false);
  const [hasTds, setHasTds] = useState(false);

  // Preload any previously generated outputs so View/Drive state works without regenerating
  useEffect(() => {
    (["sales-kit"] as const).forEach(async (type) => {
      try {
        const res = await fetch(`/api/projects/${project.id}/${type}`);
        const data = await res.json();
        if (data.html) setGeneratedHtml(prev => ({ ...prev, [type]: data.html }));
        setDriveUrls(prev => ({ ...prev, [type]: data.driveUrl ?? null }));
      } catch (e) {}
    });
    (async () => {
      try {
        const res = await fetch(`/api/documents/gtm?projectId=${project.id}`);
        const data = await res.json();
        setHasGtm(!!data.document && (data.fields || []).some((f: any) => f.answer && f.answer.toUpperCase() !== "N/A"));
        setDriveUrls(prev => ({ ...prev, gtm: data.document?.drive_url ?? null }));
      } catch (e) {}
    })();
    (async () => {
      try {
        const res = await fetch(`/api/documents/tds?projectId=${project.id}`);
        const data = await res.json();
        setHasTds(!!data.document && (data.fields || []).some((f: any) => f.answer && f.answer.toUpperCase() !== "N/A" && f.answer !== "Not listed on product page"));
        setDriveUrls(prev => ({ ...prev, tds: data.document?.drive_url ?? null }));
      } catch (e) {}
    })();
  }, [project.id]);

  useEffect(() => {
    setDriveUrls(prev => ({ ...prev, "active-report": report?.drive_url ?? null }));
  }, [report?.id]);

  async function downloadPdf(docType: "sales-kit" | "tds" | "gtm" | "active-report", id: string) {
    setDownloadingPdf(docType);
    try {
      const res = await fetch(`/api/documents/${docType}/${id}/export-pdf`);
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "PDF export failed");
      }
      const blob = await res.blob();
      const disposition = res.headers.get("Content-Disposition") || "";
      const match = disposition.match(/filename="(.+)"/);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = match?.[1] || `${docType}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err: any) {
      toast.error(err.message || "Failed to download PDF");
    } finally {
      setDownloadingPdf(null);
    }
  }

  function writeHtmlToTab(win: Window, html: string) {
    win.document.open();
    win.document.write(html);
    win.document.close();
  }

  function openHtmlInNewTab(html: string) {
    const win = window.open("", "_blank");
    if (win) writeHtmlToTab(win, html);
  }

  async function generateOutput(type: "sales-kit") {
    // Open the tab synchronously, inside the click's user-activation window —
    // generation can take 10s+, and window.open() after that await is long
    // past Chrome's user-gesture grace period and gets silently popup-blocked.
    const win = window.open("", "_blank");
    setGenerating(type);
    try {
      const res = await fetch(`/api/projects/${project.id}/${type}`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Generation failed");

      toast.success("Sales Kit generated!");
      if (data.html) {
        setGeneratedHtml(prev => ({ ...prev, [type]: data.html }));
        if (win) {
          writeHtmlToTab(win, data.html);
          win.onload = () => setTimeout(() => win.print(), 400);
        }
      } else if (win) {
        win.close();
      }
    } catch (err: any) {
      toast.error(err.message || `Failed to generate ${type}`);
      if (win) win.close();
    } finally {
      setGenerating(null);
    }
  }

  async function viewOutput(type: "sales-kit") {
    if (generatedHtml[type]) {
      openHtmlInNewTab(generatedHtml[type]);
      return;
    }

    const win = window.open("", "_blank");
    setViewing(type);
    try {
      const res = await fetch(`/api/projects/${project.id}/${type}`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Generation failed");

      if (data.html) {
        setGeneratedHtml(prev => ({ ...prev, [type]: data.html }));
        if (win) writeHtmlToTab(win, data.html);
      } else {
        toast.error("No Sales Kit available to view");
        if (win) win.close();
      }
    } catch (err: any) {
      toast.error(err.message || `Failed to load ${type}`);
      if (win) win.close();
    } finally {
      setViewing(null);
    }
  }

  return (
    <div className="p-4 bg-surface-2 border border-border rounded-xl space-y-3 shadow-sm">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-bold text-text-primary uppercase tracking-wider flex items-center gap-1.5">
          <Sparkles className="w-3.5 h-3.5 text-accent" />
          <span>Exportable Project Outputs & Document Center</span>
        </h3>
        <span className="text-[10px] text-text-muted font-mono">Automated PDF & HTML Documents</span>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {/* Sales Kit Card */}
        <div className="p-3 bg-surface-1 border border-border rounded-lg flex flex-col gap-2">
          <div className="space-y-0.5">
            <h4 className="font-bold text-text-primary text-xs flex items-center gap-1.5">
              <span>💼 Sales Kit</span>
            </h4>
            <p className="text-[10px] text-text-muted">Elevator pitch, features, competitive advantage table & objection handlers</p>
          </div>
          <div className="flex items-center gap-1.5 flex-wrap">
            <button
              type="button"
              onClick={() => viewOutput("sales-kit")}
              disabled={viewing === "sales-kit"}
              className="flex items-center gap-1 px-3 py-1.5 border border-border hover:border-border-strong text-text-secondary text-[11px] font-bold rounded-lg transition-colors disabled:opacity-50"
            >
              <Eye className="w-3.5 h-3.5" />
              <span>{viewing === "sales-kit" ? "Loading…" : "View"}</span>
            </button>
            <button
              type="button"
              onClick={() => generateOutput("sales-kit")}
              disabled={generating === "sales-kit"}
              className="px-3 py-1.5 bg-accent hover:bg-accent-hover text-white text-[11px] font-bold rounded-lg transition-all disabled:opacity-50 shadow-sm"
            >
              {generating === "sales-kit" ? "Generating…" : "Regenerate"}
            </button>
            <button
              type="button"
              onClick={() => downloadPdf("sales-kit", project.id)}
              disabled={downloadingPdf === "sales-kit"}
              className="flex items-center gap-1 px-3 py-1.5 border border-border hover:border-border-strong text-text-secondary text-[11px] font-bold rounded-lg transition-colors disabled:opacity-50"
            >
              <Download className="w-3.5 h-3.5" />
              <span>{downloadingPdf === "sales-kit" ? "Rendering…" : "Download PDF"}</span>
            </button>
            <SaveToDriveButton docType="sales-kit" id={project.id} initialDriveUrl={driveUrls["sales-kit"]} />
          </div>
        </div>

        {/* Technical Data Sheet Card — a live snapshot, not a regeneratable
            document; the editable field grid lives in TdsKnowledgeSection
            below. No View/Regenerate here, same pattern as the GTM card. */}
        <div className="p-3 bg-surface-1 border border-border rounded-lg flex flex-col gap-2">
          <div className="space-y-0.5">
            <h4 className="font-bold text-text-primary text-xs flex items-center gap-1.5">
              <span>📄 Technical Data Sheet (TDS)</span>
            </h4>
            <p className="text-[10px] text-text-muted">Live snapshot of real specs — capture it below, no AI regeneration</p>
          </div>
          <div className="flex items-center gap-1.5 flex-wrap">
            <button
              type="button"
              onClick={() => downloadPdf("tds", project.id)}
              disabled={!hasTds || downloadingPdf === "tds"}
              className="flex items-center gap-1 px-3 py-1.5 border border-border hover:border-border-strong text-text-secondary text-[11px] font-bold rounded-lg transition-colors disabled:opacity-50"
            >
              <Download className="w-3.5 h-3.5" />
              <span>{downloadingPdf === "tds" ? "Rendering…" : "Download PDF"}</span>
            </button>
            {hasTds ? (
              <SaveToDriveButton docType="tds" id={project.id} initialDriveUrl={driveUrls["tds"]} />
            ) : (
              <span className="text-[10px] text-text-muted italic">No snapshot captured yet</span>
            )}
          </div>
        </div>

        {/* Go-To-Market Card */}
        <div className="p-3 bg-surface-1 border border-border rounded-lg flex flex-col gap-2">
          <div className="space-y-0.5">
            <h4 className="font-bold text-text-primary text-xs flex items-center gap-1.5">
              <span>🎯 Go-To-Market (Product Knowledge)</span>
            </h4>
            <p className="text-[10px] text-text-muted">74-field spec sheet — generate it from the Go To Market tab</p>
          </div>
          <div className="flex items-center gap-1.5 flex-wrap">
            <button
              type="button"
              onClick={() => downloadPdf("gtm", project.id)}
              disabled={!hasGtm || downloadingPdf === "gtm"}
              className="flex items-center gap-1 px-3 py-1.5 border border-border hover:border-border-strong text-text-secondary text-[11px] font-bold rounded-lg transition-colors disabled:opacity-50"
            >
              <Download className="w-3.5 h-3.5" />
              <span>{downloadingPdf === "gtm" ? "Rendering…" : "Download PDF"}</span>
            </button>
            {hasGtm ? (
              <SaveToDriveButton docType="gtm" id={project.id} initialDriveUrl={driveUrls["gtm"]} />
            ) : (
              <span className="text-[10px] text-text-muted italic">Not generated yet</span>
            )}
          </div>
        </div>

        {/* Active Report Card */}
        <div className="p-3 bg-surface-1 border border-border rounded-lg flex flex-col gap-2">
          <div className="space-y-0.5">
            <h4 className="font-bold text-text-primary text-xs flex items-center gap-1.5">
              <span>📊 Active Report</span>
            </h4>
            <p className="text-[10px] text-text-muted">Full competitive analysis, pricing, GTM & content brief</p>
          </div>
          <div className="flex items-center gap-1.5 flex-wrap">
            <button
              type="button"
              onClick={() => downloadPdf("active-report", report.id)}
              disabled={!report?.id || downloadingPdf === "active-report"}
              className="flex items-center gap-1 px-3 py-1.5 border border-border hover:border-border-strong text-text-secondary text-[11px] font-bold rounded-lg transition-colors disabled:opacity-50"
            >
              <Download className="w-3.5 h-3.5" />
              <span>{downloadingPdf === "active-report" ? "Rendering…" : "Download PDF"}</span>
            </button>
            {report?.id ? (
              <SaveToDriveButton docType="active-report" id={report.id} initialDriveUrl={driveUrls["active-report"]} />
            ) : (
              <span className="text-[10px] text-text-muted italic">No report linked yet</span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

