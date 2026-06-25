"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { 
  FolderOpen, 
  Plus, 
  Search, 
  Sparkles, 
  Target, 
  FileText, 
  ChevronRight,
  Clock,
  Briefcase
} from "lucide-react";
import { toast } from "sonner";

export default function ProjectsPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [projects, setProjects] = useState<any[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [industryFilter, setIndustryFilter] = useState("ALL");

  const fetchProjects = async () => {
    try {
      setLoading(true);
      const res = await fetch("/api/projects");
      if (!res.ok) throw new Error();
      const data = await res.json();
      setProjects(data.projects || []);
    } catch (e) {
      toast.error("Failed to load projects");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchProjects();
  }, []);

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

  // Unique industries list for filtering
  const industries = Array.from(new Set(projects.map(p => p.industry)));

  // Client-side filtering
  const filteredProjects = projects.filter(p => {
    const matchesSearch = 
      p.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      p.productName.toLowerCase().includes(searchQuery.toLowerCase()) ||
      p.description.toLowerCase().includes(searchQuery.toLowerCase());
      
    const matchesIndustry = industryFilter === "ALL" || p.industry === industryFilter;
    
    return matchesSearch && matchesIndustry;
  });

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <h1 className="text-display">Projects</h1>
          <span className="inline-flex items-center justify-center bg-surface-3 border border-border px-2 py-0.5 rounded-full text-xs font-semibold text-text-secondary">
            {filteredProjects.length} total
          </span>
        </div>
        
        <Link
          href="/dashboard/projects/new"
          className="flex items-center gap-1.5 px-4 py-2 bg-accent hover:bg-accent-hover text-white text-xs font-bold rounded-lg transition-colors shadow shadow-accent/20 shrink-0"
        >
          <Plus className="w-4 h-4" />
          <span>New project</span>
        </Link>
      </div>

      {/* Toolbar Filter */}
      <div className="flex flex-col md:flex-row gap-3 items-stretch md:items-center justify-between p-3 bg-surface-2 border border-border rounded-xl">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-2.5 w-4 h-4 text-text-muted" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search by project name, description..."
            className="w-full pl-9 pr-4 py-1.5 text-xs border border-border rounded-lg bg-surface-1 outline-none text-text-primary placeholder-text-muted transition-colors focus:border-accent"
          />
        </div>

        <select
          value={industryFilter}
          onChange={(e) => setIndustryFilter(e.target.value)}
          className="px-2.5 py-1.5 text-xs bg-surface-1 border border-border rounded-lg text-text-primary outline-none focus:border-accent self-start md:self-auto"
        >
          <option value="ALL">All Industries</option>
          {industries.map(ind => (
            <option key={ind} value={ind}>{ind.charAt(0).toUpperCase() + ind.slice(1)}</option>
          ))}
        </select>
      </div>

      {/* Projects Grid */}
      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 animate-pulse">
          {[1, 2, 3].map(i => (
            <div key={i} className="h-[210px] bg-surface-2 border border-border rounded-xl" />
          ))}
        </div>
      ) : filteredProjects.length > 0 ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredProjects.map((p) => (
            <div 
              key={p.id}
              className="bg-surface-2 border border-border rounded-xl p-5 flex flex-col justify-between shadow hover:border-border-strong transition-all duration-200"
            >
              <div>
                <div className="flex items-center gap-1.5 mb-2">
                  <span className="px-2 py-0.5 rounded-full text-[9px] font-bold bg-surface-3 border border-border text-text-secondary uppercase">
                    {p.industry}
                  </span>
                  <span className="px-2 py-0.5 rounded-full text-[9px] font-bold bg-accent-bg border border-accent-border text-accent-text uppercase">
                    {p.targetMarket === "pro" ? "Pro / Salon" : p.targetMarket === "consumer" ? "Retail / Consumer" : "Both Markets"}
                  </span>
                </div>

                <h3 
                  onClick={() => router.push(`/dashboard/projects/${p.id}`)}
                  className="text-sm font-bold text-text-primary hover:text-accent cursor-pointer transition-colors"
                >
                  {p.name}
                </h3>
                <p className="text-[10px] text-text-muted mt-0.5">Product: {p.productName}</p>

                <p className="text-xs text-text-secondary leading-normal mt-3 line-clamp-2" title={p.description}>
                  {p.description}
                </p>
              </div>

              {/* Stats & footer */}
              <div className="pt-4 border-t border-border/60 mt-4 flex items-center justify-between">
                <div className="flex items-center gap-4 text-text-secondary">
                  <div className="flex items-center gap-1" title="Analyses">
                    <Sparkles className="w-3.5 h-3.5 text-text-muted" />
                    <span className="text-[11px] font-bold font-mono">{(p.analyses || []).length}</span>
                  </div>
                  <div className="flex items-center gap-1" title="Linked Competitors">
                    <Target className="w-3.5 h-3.5 text-text-muted" />
                    <span className="text-[11px] font-bold font-mono">{(p.competitors || []).length}</span>
                  </div>
                  <div className="flex items-center gap-1" title="Reports">
                    <FileText className="w-3.5 h-3.5 text-text-muted" />
                    <span className="text-[11px] font-bold font-mono">{(p.reports || []).length}</span>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <span className="text-[9px] text-text-muted flex items-center gap-1">
                    <Clock className="w-2.5 h-2.5" />
                    {formatRelativeTime(p.updatedAt)}
                  </span>
                  
                  <button
                    onClick={() => router.push(`/dashboard/projects/${p.id}`)}
                    className="p-1 rounded hover:bg-surface-3 text-text-muted hover:text-text-primary transition-all"
                  >
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        /* Empty state */
        <div className="flex flex-col items-center justify-center p-16 bg-surface-2 border border-border rounded-xl text-center">
          <div className="p-4 rounded-full bg-surface-3 border border-border-strong text-text-secondary mb-4">
            <FolderOpen className="w-10 h-10 opacity-70 animate-pulse" />
          </div>
          <h2 className="text-base font-bold text-text-primary mb-1">No projects yet</h2>
          <p className="text-xs text-text-muted max-w-sm mb-6">
            Create a project to organise your competitive research, link competitors, and synthesize intelligence.
          </p>
          
          <Link
            href="/dashboard/projects/new"
            className="flex items-center gap-1.5 px-4 py-2 bg-accent hover:bg-accent-hover text-white text-xs font-bold rounded-lg transition-colors shadow shadow-accent/25"
          >
            <Plus className="w-4 h-4" />
            <span>Create new project</span>
          </Link>
        </div>
      )}
    </div>
  );
}
