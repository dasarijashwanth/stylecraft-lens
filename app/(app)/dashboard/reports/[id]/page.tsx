"use client";

import { useEffect, useState } from "react";
import { useRouter, useParams } from "next/navigation";
import { 
  ArrowLeft, 
  Download, 
  Link as LinkIcon, 
  Loader2, 
  Sparkles, 
  Award,
  ChevronDown,
  ChevronUp,
  FileText
} from "lucide-react";
import { toast } from "sonner";
import ReportEditor from "@/components/reports/ReportEditor";

export default function ReportDetailPage() {
  const router = useRouter();
  const { id } = useParams();
  
  const [loading, setLoading] = useState(true);
  const [report, setReport] = useState<any>(null);
  
  // Sidebar states
  const [status, setStatus] = useState<"DRAFT" | "IN_REVIEW" | "READY" | "EXPORTED">("DRAFT");
  const [exporting, setExporting] = useState(false);
  const [showAnalysisRef, setShowAnalysisRef] = useState(true);

  const fetchReportDetails = async () => {
    try {
      setLoading(true);
      const res = await fetch(`/api/reports/${id}`);
      if (!res.ok) {
        if (res.status === 404) {
          toast.error("Report not found");
          router.push("/dashboard/reports");
          return;
        }
        throw new Error();
      }
      const data = await res.json();
      setReport(data.report);
      setStatus(data.report.status);
    } catch (e) {
      toast.error("Failed to load report");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (id) fetchReportDetails();
  }, [id]);

  const handleUpdateStatus = async (newStatus: typeof status) => {
    setStatus(newStatus);
    try {
      const res = await fetch(`/api/reports/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus })
      });
      if (!res.ok) throw new Error();
      toast.success(`Report marked as ${newStatus.replace("_", " ")}`);
    } catch (e) {
      toast.error("Failed to update report status");
    }
  };

  const handleSaveContent = async (newContent: any) => {
    try {
      const res = await fetch(`/api/reports/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: newContent })
      });
      if (!res.ok) throw new Error();
    } catch (e) {
      throw e;
    }
  };

  const handleExportPDF = async () => {
    setExporting(true);
    toast.loading("Exporting PDF…", { id: "pdf-export" });
    
    try {
      const res = await fetch(`/api/reports/${id}/export`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message);
      
      toast.dismiss("pdf-export");
      toast.success("PDF exported successfully");
      setStatus("EXPORTED");
      
      // Trigger download
      toast.info(`Mock PDF Download: "${report.title}.pdf"`);
    } catch (err: any) {
      toast.dismiss("pdf-export");
      toast.error(err.message || "Failed to export PDF");
    } finally {
      setExporting(false);
    }
  };

  const handleCopyLink = () => {
    const reportUrl = `${window.location.origin}/dashboard/reports/${id}`;
    navigator.clipboard.writeText(reportUrl);
    toast.success("Link copied to clipboard");
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center p-24">
        <Loader2 className="w-8 h-8 text-accent animate-spin mb-4" />
        <p className="text-xs text-text-muted">Loading editor...</p>
      </div>
    );
  }

  if (!report) return null;

  return (
    <div className="space-y-6">
      {/* Back button */}
      <div>
        <button
          onClick={() => router.push("/dashboard/reports")}
          className="flex items-center gap-1.5 text-xs text-text-muted hover:text-text-primary transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Back to reports</span>
        </button>
      </div>

      {/* Editor Panel Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        
        {/* Left Side: Editor Canvas (65% -> 8/12) */}
        <div className="lg:col-span-8 space-y-4">
          <div className="flex flex-col gap-1.5">
            <h1 className="text-display leading-tight">{report.title}</h1>
            {report.project && (
              <p className="text-xs text-text-muted">
                Linked project: <span className="font-semibold text-text-secondary">{report.project.name}</span>
              </p>
            )}
          </div>

          <ReportEditor 
            reportId={report.id}
            title={report.title}
            initialContent={report.content}
            onSave={handleSaveContent}
          />
        </div>

        {/* Right Side: Sidebar Metadata (35% -> 4/12) */}
        <div className="lg:col-span-4 space-y-6">
          
          {/* Metadata Card */}
          <div className="bg-surface-2 border border-border rounded-xl p-5 space-y-4 text-xs">
            <h2 className="text-xs font-bold text-text-muted uppercase tracking-wider">Report Metadata</h2>
            
            {/* Status Selector */}
            <div className="space-y-1">
              <label className="font-semibold text-text-primary block">Workflow Status</label>
              <select
                value={status}
                onChange={(e) => handleUpdateStatus(e.target.value as any)}
                className="w-full px-2.5 py-1.5 bg-surface-1 border border-border rounded-lg text-text-primary outline-none focus:border-accent font-semibold"
              >
                <option value="DRAFT">Draft</option>
                <option value="IN_REVIEW">In Review</option>
                <option value="READY">Ready</option>
                <option value="EXPORTED">Exported</option>
              </select>
            </div>

            {/* Export Section */}
            <div className="space-y-2 pt-3 border-t border-border/60">
              <label className="font-semibold text-text-primary block">Share & Export</label>
              
              <div className="flex flex-col gap-2">
                <button
                  onClick={handleExportPDF}
                  disabled={exporting}
                  className="w-full py-2 bg-accent hover:bg-accent-hover text-white font-bold rounded-lg transition-colors flex items-center justify-center gap-1.5 disabled:opacity-50 shadow shadow-accent/25"
                >
                  {exporting ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Download className="w-3.5 h-3.5" />
                  )}
                  <span>Export as PDF</span>
                </button>

                <button
                  onClick={handleCopyLink}
                  className="w-full py-2 border border-border bg-surface-3/55 hover:bg-surface-3 text-text-primary font-bold rounded-lg transition-colors flex items-center justify-center gap-1.5"
                >
                  <LinkIcon className="w-3.5 h-3.5" />
                  <span>Copy report link</span>
                </button>
              </div>
            </div>
          </div>

          {/* Collapsible Source Reference (If project linked) */}
          {report.project && (
            <div className="bg-surface-2 border border-border rounded-xl overflow-hidden">
              <button
                type="button"
                onClick={() => setShowAnalysisRef(!showAnalysisRef)}
                className="w-full px-5 py-4 border-b border-border bg-surface-3/10 flex items-center justify-between text-xs font-bold text-text-primary hover:bg-surface-3/30 transition-colors"
              >
                <div className="flex items-center gap-2">
                  <Sparkles className="w-4 h-4 text-text-muted" />
                  <span>Original AI Synthesis</span>
                </div>
                {showAnalysisRef ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
              </button>

              {showAnalysisRef && (
                <div className="p-5 space-y-3.5 text-[11px] leading-relaxed text-text-secondary max-h-[300px] overflow-y-auto">
                  <div className="space-y-1">
                    <span className="font-bold text-text-primary text-[10px] uppercase tracking-wider block">Context description</span>
                    <p className="p-2 border border-border rounded bg-surface-3/30 italic">
                      &quot;{report.project.description}&quot;
                    </p>
                  </div>

                  <div className="space-y-1">
                    <span className="font-bold text-text-primary text-[10px] uppercase tracking-wider block">Target Market</span>
                    <p className="font-semibold text-text-primary uppercase">{report.project.targetMarket}</p>
                  </div>

                  <div className="space-y-1">
                    <span className="font-bold text-text-primary text-[10px] uppercase tracking-wider block">Precision specifications</span>
                    <ul className="space-y-1">
                      <li>• Category: {report.project.category || "N/A"}</li>
                      <li>• Price: {report.project.pricePoint || "N/A"}</li>
                      <li>• Motor: {report.project.motorTech || "N/A"}</li>
                      <li>• Diff: {report.project.keyDiff || "N/A"}</li>
                    </ul>
                  </div>
                </div>
              )}
            </div>
          )}

        </div>
      </div>
    </div>
  );
}
