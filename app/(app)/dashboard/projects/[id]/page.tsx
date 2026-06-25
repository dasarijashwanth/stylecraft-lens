"use client";

import { useEffect, useState } from "react";
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
  Settings,
  Target,
  Clock,
  Briefcase
} from "lucide-react";
import { toast } from "sonner";

export default function ProjectDetailPage() {
  const router = useRouter();
  const { id } = useParams();
  const [loading, setLoading] = useState(true);
  const [project, setProject] = useState<any>(null);

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
    } catch (e) {
      toast.error("Failed to load project details");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (id) fetchProjectDetails();
  }, [id]);

  const handleDeleteProject = async () => {
    if (!window.confirm("Are you sure you want to permanently delete this project? This will also remove related mock data indices.")) return;
    
    try {
      const res = await fetch(`/api/projects/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error();
      
      toast.success("Project deleted");
      router.push("/dashboard/projects");
    } catch (e) {
      toast.error("Failed to delete project");
    }
  };

  const handleRunAnalysis = () => {
    // Navigate to analyze page and pass project ID as query param
    router.push(`/dashboard/analyze?projectId=${id}`);
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center p-24">
        <Loader2 className="w-8 h-8 text-accent animate-spin mb-4" />
        <p className="text-xs text-text-muted">Loading project details...</p>
      </div>
    );
  }

  if (!project) return null;

  return (
    <div className="space-y-6">
      {/* Back Link */}
      <div className="flex flex-col gap-4">
        <button
          onClick={() => router.push("/dashboard/projects")}
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
                <span className="px-2 py-0.5 rounded-full text-[9px] font-bold bg-accent-bg border border-accent-border text-accent-text uppercase">
                  {project.industry}
                </span>
              </div>
              <p className="text-xs text-text-muted mt-1">Product: <span className="font-semibold text-text-secondary">{project.productName}</span></p>
            </div>
          </div>

          <div className="flex items-center gap-2 self-start md:self-auto">
            <button
              onClick={handleRunAnalysis}
              className="flex items-center gap-1.5 px-3.5 py-2 bg-accent hover:bg-accent-hover text-white text-xs font-bold rounded-lg transition-colors shadow shadow-accent/25"
            >
              <Sparkles className="w-3.5 h-3.5" />
              <span>Run new analysis</span>
            </button>
            <button
              onClick={handleDeleteProject}
              className="flex items-center gap-1.5 px-3.5 py-2 border border-danger/35 bg-danger/10 hover:bg-danger/20 text-danger text-xs font-bold rounded-lg transition-colors"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>Delete</span>
            </button>
          </div>
        </div>
      </div>

      {/* Main layout */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        
        {/* Left Side: Product Specifications (5/12) */}
        <div className="lg:col-span-5 space-y-6">
          
          {/* Product Specifications Card */}
          <div className="bg-surface-2 border border-border rounded-xl p-5 space-y-4">
            <h2 className="text-xs font-bold text-text-muted uppercase tracking-wider">Product specification</h2>
            
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
                  <span className="text-[10px] text-text-muted uppercase font-bold block">Technical & Positioning specs</span>
                  
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
                    <div className="space-y-1 pt-1.5">
                      <span className="text-[9px] text-text-muted uppercase font-bold block">Company Context</span>
                      <p className="text-text-secondary italic">{project.companyContext}</p>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Right Side: Linked Analyses & Reports (7/12) */}
        <div className="lg:col-span-7 space-y-6">
          
          {/* Linked Analyses Panel */}
          <div className="bg-surface-2 border border-border rounded-xl p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-xs font-bold text-text-muted uppercase tracking-wider">Linked Analyses</h2>
              <button 
                onClick={handleRunAnalysis}
                className="text-[11px] text-accent hover:underline flex items-center gap-1 font-semibold"
              >
                <span>Trigger analysis</span>
                <Plus className="w-3 h-3" />
              </button>
            </div>

            <div className="space-y-2 max-h-[250px] overflow-y-auto pr-1">
              {(project.analyses || []).map((an: any) => (
                <div 
                  key={an.id}
                  onClick={() => router.push(`/dashboard/analyze?id=${an.id}`)}
                  className="flex items-center justify-between p-3 rounded-lg border border-border bg-surface-3/30 hover:bg-surface-3/60 transition-colors cursor-pointer text-xs"
                >
                  <div className="space-y-1 min-w-0">
                    <p className="font-semibold text-text-primary truncate">
                      {an.phase3Result?.executive_summary ? "AI Market Research Deep Dive" : "Competitive Analysis"}
                    </p>
                    <span className="text-[10px] text-text-muted flex items-center gap-1.5">
                      <Clock className="w-3 h-3" />
                      {new Date(an.createdAt).toLocaleDateString()}
                      <span>•</span>
                      <span>Phase: {an.phase}/4</span>
                    </span>
                  </div>

                  <div className="flex items-center gap-2.5">
                    <span className={`inline-flex px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider ${
                      an.status === "COMPLETE" ? "bg-success/15 text-success" :
                      an.status === "RUNNING" ? "bg-accent-bg text-accent-text animate-pulse" :
                      an.status === "FAILED" ? "bg-danger/15 text-danger" : "bg-zinc-800 text-zinc-400"
                    }`}>
                      {an.status}
                    </span>
                    <ChevronRight className="w-4 h-4 text-text-muted" />
                  </div>
                </div>
              ))}

              {(project.analyses || []).length === 0 && (
                <div className="p-8 text-center text-text-muted border border-dashed border-border rounded-lg">
                  <Sparkles className="w-7 h-7 mx-auto mb-2 opacity-50" />
                  <p className="text-xs">No analyses completed for this project yet.</p>
                </div>
              )}
            </div>
          </div>

          {/* Linked Reports Panel */}
          <div className="bg-surface-2 border border-border rounded-xl p-5 space-y-4">
            <h2 className="text-xs font-bold text-text-muted uppercase tracking-wider">Generated reports</h2>
            
            <div className="space-y-2 max-h-[250px] overflow-y-auto pr-1">
              {(project.reports || []).map((rep: any) => (
                <div
                  key={rep.id}
                  onClick={() => router.push(`/dashboard/reports/${rep.id}`)}
                  className="flex items-center justify-between p-3 rounded-lg border border-border bg-surface-3/30 hover:bg-surface-3/60 transition-colors cursor-pointer text-xs"
                >
                  <div className="space-y-1 min-w-0">
                    <p className="font-semibold text-text-primary truncate">{rep.title}</p>
                    <span className="text-[10px] text-text-muted flex items-center gap-1.5">
                      <Clock className="w-3 h-3" />
                      Updated {new Date(rep.updatedAt).toLocaleDateString()}
                    </span>
                  </div>

                  <div className="flex items-center gap-2.5">
                    <span className={`inline-flex px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider ${
                      rep.status === "DRAFT" ? "bg-zinc-800 text-zinc-400 border border-zinc-700" :
                      rep.status === "READY" ? "bg-success/15 text-success" :
                      rep.status === "EXPORTED" ? "bg-accent-bg text-accent-text" : "bg-zinc-800 text-zinc-400"
                    }`}>
                      {rep.status}
                    </span>
                    <ChevronRight className="w-4 h-4 text-text-muted" />
                  </div>
                </div>
              ))}

              {(project.reports || []).length === 0 && (
                <div className="p-8 text-center text-text-muted border border-dashed border-border rounded-lg">
                  <FileText className="w-7 h-7 mx-auto mb-2 opacity-50" />
                  <p className="text-xs">No reports compiled from analyses yet.</p>
                </div>
              )}
            </div>
          </div>
          
        </div>
      </div>
    </div>
  );
}
