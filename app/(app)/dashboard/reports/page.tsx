"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { 
  FileText, 
  Search, 
  ChevronRight, 
  Clock, 
  Trash2, 
  Download, 
  Sparkles,
  RefreshCw,
  Plus
} from "lucide-react";
import { toast } from "sonner";
import { downloadReportPDF } from "@/lib/export-pdf";

export default function ReportsPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [reports, setReports] = useState<any[]>([]);
  
  // Filter & Search states
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [exportingId, setExportingId] = useState<string | null>(null);

  const fetchReports = async () => {
    try {
      setLoading(true);
      const params = new URLSearchParams({
        status: statusFilter,
        search: searchQuery
      });
      const res = await fetch(`/api/reports?${params.toString()}`);
      if (!res.ok) throw new Error();
      const data = await res.json();
      setReports(data.reports || []);
    } catch (e) {
      toast.error("Failed to load reports");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchReports();
  }, [statusFilter, searchQuery]);

  const handleDeleteReport = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!window.confirm("Are you sure you want to delete this report?")) return;
    
    try {
      const res = await fetch(`/api/reports/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error();
      toast.success("Report deleted");
      fetchReports();
    } catch (err) {
      toast.error("Failed to delete report");
    }
  };

  const handleExportPDF = async (id: string, title: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setExportingId(id);
    toast.loading("Exporting PDF…", { id: "pdf-export" });
    
    try {
      const res = await fetch(`/api/reports/${id}`);
      const data = await res.json();
      if (!res.ok) throw new Error("Failed to load report data");
      
      await downloadReportPDF(data.report);
      
      // Update status
      await fetch(`/api/reports/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "EXPORTED" })
      });
      
      toast.dismiss("pdf-export");
      toast.success("PDF exported successfully");
      fetchReports();
    } catch (err: any) {
      toast.dismiss("pdf-export");
      toast.error(err.message || "Failed to export PDF");
    } finally {
      setExportingId(null);
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

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <h1 className="text-display">Reports</h1>
          <span className="inline-flex items-center justify-center bg-surface-3 border border-border px-2 py-0.5 rounded-full text-xs font-semibold text-text-secondary">
            {reports.length} total
          </span>
        </div>
        
        <Link
          href="/dashboard/analyze"
          className="flex items-center gap-1.5 px-4 py-2 bg-accent hover:bg-accent-hover text-white text-xs font-bold rounded-lg transition-colors shadow shadow-accent/20 shrink-0"
        >
          <Sparkles className="w-4 h-4" />
          <span>Generate from analysis</span>
        </Link>
      </div>

      {/* Toolbar Filters */}
      <div className="flex flex-col md:flex-row gap-3 items-stretch md:items-center justify-between p-3 bg-surface-2 border border-border rounded-xl">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-2.5 w-4 h-4 text-text-muted" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search reports by title..."
            className="w-full pl-9 pr-4 py-1.5 text-xs border border-border rounded-lg bg-surface-1 outline-none text-text-primary placeholder-text-muted transition-colors focus:border-accent"
          />
        </div>

        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="px-2.5 py-1.5 text-xs bg-surface-1 border border-border rounded-lg text-text-primary outline-none focus:border-accent self-start md:self-auto"
        >
          <option value="ALL">All Statuses</option>
          <option value="DRAFT">Draft</option>
          <option value="IN_REVIEW">In Review</option>
          <option value="READY">Ready</option>
          <option value="EXPORTED">Exported</option>
        </select>
      </div>

      {/* Reports Grid */}
      {loading ? (
        <div className="flex flex-col items-center justify-center p-20 bg-surface-2 border border-border rounded-xl">
          <RefreshCw className="w-8 h-8 text-accent animate-spin mb-3" />
          <p className="text-xs text-text-muted">Fetching reports...</p>
        </div>
      ) : reports.length > 0 ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {reports.map((r) => (
            <div
              key={r.id}
              onClick={() => router.push(`/dashboard/reports/${r.id}`)}
              className="bg-surface-2 border border-border rounded-xl p-5 flex flex-col justify-between shadow hover:border-border-strong transition-all duration-200 cursor-pointer"
            >
              <div>
                <div className="flex items-center justify-between mb-3">
                  <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 text-[9px] font-semibold border rounded-full uppercase tracking-wider ${
                    r.status?.toUpperCase() === "DRAFT" ? "bg-zinc-800 text-zinc-400 border-zinc-700" :
                    r.status?.toUpperCase() === "IN_REVIEW" ? "bg-warning-bg border border-warning/20 text-warning" :
                    r.status?.toUpperCase() === "READY" ? "bg-success-bg border border-success/20 text-success" :
                    "bg-indigo-950 text-indigo-300 border-indigo-900"
                  }`}>
                    {r.status?.replace("_", " ")}
                  </span>
                  
                  <div className="flex items-center gap-1.5">
                    <button
                      onClick={(e) => handleExportPDF(r.id, r.title, e)}
                      disabled={exportingId === r.id}
                      title="Export PDF"
                      className="p-1 rounded hover:bg-surface-3 text-text-muted hover:text-text-primary disabled:opacity-50"
                    >
                      <Download className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={(e) => handleDeleteReport(r.id, e)}
                      title="Delete Report"
                      className="p-1 rounded hover:bg-surface-3 text-text-muted hover:text-danger"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                <h3 className="text-sm font-bold text-text-primary hover:text-accent transition-colors line-clamp-2">
                  {r.title}
                </h3>
                
                {r.projects && (
                  <p className="text-[10px] text-text-muted mt-1">Project: {r.projects.name}</p>
                )}
              </div>

              {/* Card Footer */}
              <div className="pt-4 border-t border-border/60 mt-4 flex items-center justify-between text-[10px] text-text-muted">
                <span className="flex items-center gap-1">
                  <Clock className="w-3 h-3" />
                  Edited {formatRelativeTime(r.updated_at)}
                </span>
                
                <span className="flex items-center gap-0.5 text-accent font-semibold hover:text-accent-hover">
                  <span>Edit report</span>
                  <ChevronRight className="w-3 h-3" />
                </span>
              </div>
            </div>
          ))}
        </div>
      ) : (
        /* Empty State */
        <div className="flex flex-col items-center justify-center p-16 bg-surface-2 border border-border rounded-xl text-center">
          <div className="p-4 rounded-full bg-surface-3 border border-border-strong text-text-secondary mb-4">
            <FileText className="w-10 h-10 opacity-70 animate-pulse" />
          </div>
          <h2 className="text-base font-bold text-text-primary mb-1">No reports yet</h2>
          <p className="text-xs text-text-muted max-w-sm mb-6">
            Reports are generated from competitive analyses. Run an analysis and choose &quot;Save as report&quot; to compile your dashboard.
          </p>
          <Link
            href="/dashboard/analyze"
            className="flex items-center gap-1.5 px-4 py-2 bg-accent hover:bg-accent-hover text-white text-xs font-bold rounded-lg transition-colors shadow shadow-accent/25"
          >
            <Sparkles className="w-4 h-4" />
            <span>Run first analysis</span>
          </Link>
        </div>
      )}
    </div>
  );
}
