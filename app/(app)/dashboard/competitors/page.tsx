"use client";

import { useState, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { 
  Search, 
  LayoutGrid, 
  List, 
  Plus, 
  Trash2, 
  Play, 
  ChevronRight, 
  FileSpreadsheet, 
  RefreshCw,
  Star,
  ExternalLink,
  Target
} from "lucide-react";
import AddCompetitorModal from "@/components/competitors/AddCompetitorModal";
import { useAuth } from "@/hooks/useAuth";
import { useAmazonProduct } from "@/hooks/useAmazonProduct";
import { toast } from "sonner";

type TabView = "all" | "analysis" | "manual";

export default function CompetitorsPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user } = useAuth();
  
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<TabView>("all");
  const [manualCompetitors, setManualCompetitors] = useState<any[]>([]);
  const [analysisCompetitors, setAnalysisCompetitors] = useState<any[]>([]);
  
  // Filter & UI states
  const [viewMode, setViewMode] = useState<"table" | "grid">("table");
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [selectedTag, setSelectedTag] = useState("ALL");
  const [sortField, setSortField] = useState("name");
  const [sortOrder, setSortOrder] = useState("asc");
  
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [allTags, setAllTags] = useState<string[]>([]);

  // Open modal if URL query param has ?add=true
  useEffect(() => {
    if (searchParams.get("add") === "true") {
      setIsAddModalOpen(true);
    }
  }, [searchParams]);

  const loadAll = async () => {
    if (!user) return;
    try {
      setLoading(true);
      
      const manualRes = await fetch(`/api/competitors?source=manual&limit=100`);
      const manualData = await manualRes.json();
      
      const analysisRes = await fetch(`/api/competitors?source=analysis`);
      const analysisData = await analysisRes.json();
      
      const manual = manualData.competitors || [];
      const analysis = analysisData.competitors || [];
      
      setManualCompetitors(manual);
      setAnalysisCompetitors(analysis);
      
      // Extract unique tags for filtering
      const tagsSet = new Set<string>();
      manual.forEach((c: any) => {
        if (c.tags) c.tags.forEach((t: string) => tagsSet.add(t));
      });
      analysis.forEach((c: any) => {
        if (c.tags) c.tags.forEach((t: string) => tagsSet.add(t));
      });
      setAllTags(Array.from(tagsSet));
    } catch (e) {
      toast.error("Failed to load competitors list");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadAll();
  }, [user]);

  // Deduplicate analysis competitors by ASIN or name (keep most recent)
  const uniqueAnalysis = Object.values(
    (analysisCompetitors ?? []).reduce((acc: any, c: any) => {
      const key = c.asin ?? c.name;
      if (!acc[key] || c.created_at > acc[key].created_at) acc[key] = c;
      return acc;
    }, {})
  ) as any[];

  // Merge lists based on current tab selection
  const allCompetitors = tab === "manual"   ? manualCompetitors
                       : tab === "analysis" ? uniqueAnalysis
                       : [...manualCompetitors, ...uniqueAnalysis];

  // Apply client-side filters
  const filtered = allCompetitors.filter(c => {
    const matchesSearch = !searchQuery ||
      c.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      c.brand?.toLowerCase().includes(searchQuery.toLowerCase());
      
    const isFromAnalysis = !c.status;
    const matchesStatus = statusFilter === "ALL" ||
      (isFromAnalysis && statusFilter === "ACTIVE") ||
      (c.status === statusFilter);
      
    const matchesTag = selectedTag === "ALL" ||
      (c.tags && c.tags.map((t: string) => t.toLowerCase()).includes(selectedTag.toLowerCase()));

    return matchesSearch && matchesStatus && matchesTag;
  });

  // Apply sorting
  const sorted = [...filtered].sort((a, b) => {
    let valA: any = a.name.toLowerCase();
    let valB: any = b.name.toLowerCase();
    
    if (sortField === "date") {
      valA = new Date(a.createdAt || a.created_at || 0).getTime();
      valB = new Date(b.createdAt || b.created_at || 0).getTime();
    } else if (sortField === "updated") {
      valA = new Date(a.updatedAt || a.created_at || 0).getTime();
      valB = new Date(b.updatedAt || b.created_at || 0).getTime();
    }
    
    if (valA < valB) return sortOrder === "asc" ? -1 : 1;
    if (valA > valB) return sortOrder === "asc" ? 1 : -1;
    return 0;
  });

  const handleSelectRow = (id: string) => {
    setSelectedIds(prev =>
      prev.includes(id) ? prev.filter(item => item !== id) : [...prev, id]
    );
  };

  const handleSelectAll = () => {
    if (selectedIds.length === sorted.length) {
      setSelectedIds([]);
    } else {
      setSelectedIds(sorted.map(c => c.id || `${c.analysis_id}_${c.asin || c.name}`));
    }
  };

  const handleBulkDelete = async () => {
    if (!window.confirm(`Are you sure you want to delete ${selectedIds.length} manual competitors?`)) return;
    
    let successCount = 0;
    for (const id of selectedIds) {
      // Only delete manual ones (analysis competitors are read-only)
      if (id.startsWith("an_") || id.includes("_p")) continue;
      try {
        const res = await fetch(`/api/competitors/${id}`, { method: "DELETE" });
        if (res.ok) successCount++;
      } catch (e) {}
    }
    
    toast.success(`Deleted ${successCount} manual competitors`);
    setSelectedIds([]);
    loadAll();
  };

  const handleBulkExportCSV = () => {
    const selectedList = sorted.filter(c => {
      const id = c.id || `${c.analysis_id}_${c.asin || c.name}`;
      return selectedIds.includes(id);
    });
    if (selectedList.length === 0) return;
    
    const headers = ["Name", "Website", "Brand", "Tier", "ASIN", "Price", "Rating", "Reviews"];
    const rows = selectedList.map(c => [
      c.name,
      c.website || c.amazon_url || "",
      c.brand || "",
      c.tier || "",
      c.asin || "",
      c.price || "",
      c.rating || "",
      c.review_count || ""
    ]);
    
    const csvContent = "data:text/csv;charset=utf-8," 
      + [headers.join(","), ...rows.map(e => e.map(val => `"${String(val).replace(/"/g, '""')}"`).join(","))].join("\n");
      
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `stylecraft-competitors-export.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    
    toast.success("CSV file downloaded");
  };

  const handleDeleteCompetitor = async (id: string) => {
    if (!window.confirm("Are you sure you want to delete this competitor?")) return;
    try {
      const res = await fetch(`/api/competitors/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error();
      toast.success("Competitor deleted");
      loadAll();
    } catch (e) {
      toast.error("Failed to delete competitor");
    }
  };

  const totalCount = manualCompetitors.length + uniqueAnalysis.length;

  return (
    <div className="space-y-6 text-xs">
      
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex items-center gap-3">
          <h1 className="text-display">Competitors</h1>
          <span className="inline-flex items-center justify-center bg-surface-3 border border-border px-2 py-0.5 rounded-full text-xs font-semibold text-text-secondary">
            {totalCount} total
          </span>
        </div>
        <button
          onClick={() => setIsAddModalOpen(true)}
          className="flex items-center gap-1.5 px-4 py-2 bg-accent hover:bg-accent-hover text-white text-xs font-bold rounded-lg transition-colors shadow shadow-accent/25 shrink-0 self-start sm:self-auto"
        >
          <Plus className="w-4 h-4" />
          <span>Add competitor</span>
        </button>
      </div>

      {/* Tab select bar */}
      <div className="flex items-center gap-1 border-b border-border">
        {([
          { key: "all", label: `All (${totalCount})` },
          { key: "analysis", label: `From analyses (${uniqueAnalysis.length})` },
          { key: "manual", label: `Manual (${manualCompetitors.length})` }
        ] as { key: TabView; label: string }[]).map(t => (
          <button
            key={t.key}
            onClick={() => { setTab(t.key); setSelectedIds([]); }}
            className={`px-4 py-2 border-b-2 font-bold text-xs transition-colors ${
              tab === t.key 
                ? "border-accent text-accent" 
                : "border-transparent text-text-secondary hover:text-text-primary"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Filter Toolbar */}
      <div className="flex flex-col md:flex-row gap-3 items-stretch md:items-center justify-between p-3 bg-surface-2 border border-border rounded-xl">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-2.5 w-4 h-4 text-text-muted" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search by name or brand..."
            className="w-full pl-9 pr-4 py-1.5 text-xs border border-border rounded-lg bg-surface-1 outline-none text-text-primary placeholder-text-muted transition-colors focus:border-accent"
          />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="px-2.5 py-1.5 text-xs bg-surface-1 border border-border rounded-lg text-text-primary outline-none focus:border-accent"
          >
            <option value="ALL">All Statuses</option>
            <option value="ACTIVE">Active</option>
            <option value="MONITORING">Monitoring</option>
            <option value="ARCHIVED">Archived</option>
          </select>

          <select
            value={selectedTag}
            onChange={(e) => setSelectedTag(e.target.value)}
            className="px-2.5 py-1.5 text-xs bg-surface-1 border border-border rounded-lg text-text-primary outline-none focus:border-accent"
          >
            <option value="ALL">All Tags</option>
            {allTags.map(tag => (
              <option key={tag} value={tag}>{tag}</option>
            ))}
          </select>

          <select
            value={sortField}
            onChange={(e) => setSortField(e.target.value)}
            className="px-2.5 py-1.5 text-xs bg-surface-1 border border-border rounded-lg text-text-primary outline-none focus:border-accent"
          >
            <option value="name">Sort: Name A–Z</option>
            <option value="updated">Sort: Last Updated</option>
            <option value="date">Sort: Date Added</option>
          </select>

          <div className="flex items-center rounded-lg border border-border p-0.5 bg-surface-1">
            <button
              onClick={() => setViewMode("table")}
              className={`p-1 rounded transition-colors ${
                viewMode === "table" ? "bg-surface-3 text-accent" : "text-text-muted hover:text-text-primary"
              }`}
              title="Table view"
            >
              <List className="w-4 h-4" />
            </button>
            <button
              onClick={() => setViewMode("grid")}
              className={`p-1 rounded transition-colors ${
                viewMode === "grid" ? "bg-surface-3 text-accent" : "text-text-muted hover:text-text-primary"
              }`}
              title="Grid view"
            >
              <LayoutGrid className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      {/* Bulk Actions Bar */}
      {selectedIds.length > 0 && (
        <div className="flex items-center justify-between p-3 border border-accent-border bg-accent-bg rounded-xl animate-pulse-soft">
          <span className="text-xs font-semibold text-accent-text">
            {selectedIds.length} competitors selected
          </span>
          <div className="flex items-center gap-2">
            <button
              onClick={handleBulkExportCSV}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border bg-surface-2 hover:bg-surface-3 text-[11px] font-bold text-text-primary transition-colors"
            >
              <FileSpreadsheet className="w-3.5 h-3.5" />
              <span>Export CSV</span>
            </button>
            <button
              onClick={handleBulkDelete}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-danger/10 border border-danger/25 text-danger text-[11px] font-bold hover:bg-danger/20 transition-colors"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>Delete manual</span>
            </button>
          </div>
        </div>
      )}

      {/* Main Content Listing */}
      {loading ? (
        <div className="flex flex-col items-center justify-center p-20 bg-surface-2 border border-border rounded-xl">
          <RefreshCw className="w-8 h-8 text-accent animate-spin mb-3" />
          <p className="text-xs text-text-muted font-medium animate-pulse">Syncing competitors workspace...</p>
        </div>
      ) : sorted.length > 0 ? (
        viewMode === "table" ? (
          <div className="bg-surface-2 border border-border rounded-xl overflow-hidden shadow-md">
            <div className="overflow-x-auto">
              <table className="w-full text-xs text-left border-collapse">
                <thead>
                  <tr className="border-b border-border/80 text-text-muted font-bold bg-surface-3/20">
                    <th className="py-3 px-4 w-10">
                      <input
                        type="checkbox"
                        checked={selectedIds.length === sorted.length && sorted.length > 0}
                        onChange={handleSelectAll}
                        className="rounded border-border bg-surface-1 focus:ring-accent w-3.5 h-3.5 accent-indigo-500"
                      />
                    </th>
                    <th className="py-3 px-4">Name & Website</th>
                    <th className="py-3 px-4">Brand</th>
                    <th className="py-3 px-4">Source / Status</th>
                    <th className="py-3 px-4">Tags</th>
                    <th className="py-3 px-4">Amazon ASIN</th>
                    <th className="py-3 px-4 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/40">
                  {sorted.map((c) => {
                    const isFromAnalysis = !c.status;
                    const id = c.id || `${c.analysis_id}_${c.asin || c.name}`;
                    const isSelected = selectedIds.includes(id);
                    return (
                      <tr 
                        key={id} 
                        className={`hover:bg-surface-3/20 transition-colors ${
                          isSelected ? "bg-accent-bg/10" : ""
                        }`}
                      >
                        <td className="py-3 px-4">
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => handleSelectRow(id)}
                            className="rounded border-border bg-surface-1 focus:ring-accent w-3.5 h-3.5 accent-indigo-500"
                          />
                        </td>
                        <td className="py-3 px-4 font-sans">
                          {isFromAnalysis ? (
                            <span className="font-bold text-text-primary block">
                              {c.name}
                            </span>
                          ) : (
                            <span 
                              onClick={() => router.push(`/dashboard/competitors/${c.id}`)}
                              className="font-bold text-text-primary hover:text-accent cursor-pointer transition-colors block"
                            >
                              {c.name}
                            </span>
                          )}
                          {c.website || c.amazon_url ? (
                            <a 
                              href={c.website || c.amazon_url} 
                              target="_blank" 
                              rel="noreferrer"
                              className="text-[10px] text-text-muted hover:underline block mt-0.5 flex items-center gap-0.5"
                            >
                              <span>{c.website || "View Listing"}</span>
                              <ExternalLink size={10} className="text-text-muted/60" />
                            </a>
                          ) : (
                            <span className="text-[10px] text-text-muted block mt-0.5">No domain</span>
                          )}
                        </td>
                        <td className="py-3 px-4 text-text-secondary">{c.brand || "—"}</td>
                        <td className="py-3 px-4">
                          {isFromAnalysis ? (
                            <span className="inline-flex items-center gap-1.5 px-2 py-0.5 text-[10px] font-bold rounded bg-indigo-950/60 border border-indigo-900/60 text-indigo-400">
                              <span className="w-1 h-1 rounded-full bg-indigo-400" />
                              From analysis
                            </span>
                          ) : (
                            <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 text-[10px] font-semibold rounded ${
                              c.status === "ACTIVE" ? "bg-success-bg border border-success/20 text-success" :
                              c.status === "MONITORING" ? "bg-warning-bg border border-warning/20 text-warning" :
                              "bg-zinc-800 border border-zinc-700 text-zinc-400"
                            }`}>
                              <span className={`w-1.5 h-1.5 rounded-full ${
                                c.status === "ACTIVE" ? "bg-success" :
                                c.status === "MONITORING" ? "bg-warning" : "bg-zinc-500"
                              }`} />
                              {c.status.charAt(0) + c.status.slice(1).toLowerCase()}
                            </span>
                          )}
                        </td>
                        <td className="py-3 px-4">
                          <div className="flex flex-wrap gap-1 max-w-[200px]">
                            {(c.tags || []).slice(0, 3).map((tag: string) => (
                              <span key={tag} className="px-1.5 py-0.5 rounded bg-surface-3 border border-border text-[9px] text-text-secondary">
                                {tag}
                              </span>
                            ))}
                            {c.tags?.length > 3 && (
                              <span className="px-1 py-0.5 text-[9px] text-text-muted">+{c.tags.length - 3}</span>
                            )}
                          </div>
                        </td>
                        <td className="py-3 px-4 font-mono text-[10px] text-text-secondary">{c.asin || "—"}</td>
                        <td className="py-3 px-4 text-right">
                          {!isFromAnalysis && (
                            <button
                              onClick={() => handleDeleteCompetitor(c.id)}
                              className="p-1 rounded hover:bg-surface-3 text-text-muted hover:text-danger transition-colors"
                              title="Delete competitor"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {sorted.map((c) => {
              const isFromAnalysis = !c.status;
              const id = c.id || `${c.analysis_id}_${c.asin || c.name}`;
              return (
                <CompetitorGridCard 
                  key={id} 
                  competitor={c} 
                  isFromAnalysis={isFromAnalysis} 
                  onDelete={() => handleDeleteCompetitor(c.id)} 
                />
              );
            })}
          </div>
        )
      ) : (
        <div className="flex flex-col items-center justify-center p-16 bg-surface-2 border border-border rounded-xl text-center">
          <div className="p-4 rounded-full bg-surface-3 border border-border-strong text-text-secondary mb-4">
            <Target className="w-10 h-10 opacity-70 animate-pulse" />
          </div>
          <h2 className="text-base font-bold text-text-primary mb-1">No competitors found</h2>
          <p className="text-xs text-text-muted max-w-sm mb-6">
            Refine your query terms or click the button below to register a new competitor.
          </p>
          <button
            onClick={() => setIsAddModalOpen(true)}
            className="px-4 py-2 bg-accent hover:bg-accent-hover text-white text-xs font-bold rounded-lg transition-colors shadow shadow-accent/25"
          >
            Add competitor manually
          </button>
        </div>
      )}

      {/* Add Competitor Modal */}
      {isAddModalOpen && (
        <AddCompetitorModal
          isOpen={isAddModalOpen}
          onClose={() => setIsAddModalOpen(false)}
          onSuccess={loadAll}
        />
      )}
    </div>
  );
}

// ─── Grid Card wrapper with live fetching ────────────────────────────────
function CompetitorGridCard({ 
  competitor: c, 
  isFromAnalysis,
  onDelete 
}: { 
  competitor: any; 
  isFromAnalysis: boolean;
  onDelete: () => void;
}) {
  const { data: live, loading } = useAmazonProduct(c.asin);

  const displayPrice   = live?.price        ?? c.price        ?? "—";
  const displayRating  = live?.rating_str   ?? c.rating       ?? "—";
  const displayReviews = live?.reviews_str  ?? c.review_count ?? "—";

  const amazonUrl = c.asin ? `https://www.amazon.com/dp/${c.asin}` : c.website;

  return (
    <div className={`bg-surface-2 border border-border rounded-xl p-5 flex flex-col justify-between shadow hover:border-border-strong transition-all duration-200 ${
      isFromAnalysis ? "border-l-4 border-l-accent" : ""
    }`}>
      <div>
        <div className="flex justify-between items-start mb-3 gap-2">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-surface-3 border border-border-strong flex items-center justify-center font-bold text-xs text-accent">
              {c.initials ?? c.name.substring(0, 2).toUpperCase()}
            </div>
            <div>
              <h3 className="text-sm font-bold text-text-primary truncate max-w-[150px]" title={c.name}>
                {c.name}
              </h3>
              <p className="text-[10px] text-text-muted mt-0.5 truncate max-w-[150px]">by {c.brand || "—"}</p>
            </div>
          </div>

          {isFromAnalysis ? (
            <span className="px-1.5 py-0.5 rounded text-[8px] font-bold uppercase tracking-wider bg-indigo-950 text-indigo-400 border border-indigo-900">
              Analysis
            </span>
          ) : (
            <span className={`inline-flex px-1.5 py-0.5 rounded text-[8px] font-bold uppercase tracking-wider ${
              c.status === "ACTIVE" ? "bg-success-bg border border-success/20 text-success" :
              c.status === "MONITORING" ? "bg-warning-bg border border-warning/20 text-warning" :
              "bg-zinc-800 border border-zinc-700 text-zinc-400"
            }`}>
              {c.status}
            </span>
          )}
        </div>

        {c.description && (
          <p className="text-[10px] text-text-secondary line-clamp-2 leading-relaxed mb-3">
            {c.description}
          </p>
        )}

        {/* Live Amazon Data */}
        {c.asin && (
          <div className="grid grid-cols-3 gap-1.5 py-2 border-y border-border/40 text-center font-mono my-3">
            <div className="text-left font-sans">
              <span className="text-[8px] text-text-muted block uppercase">Price</span>
              <span className="font-bold text-text-primary text-[10px] mt-0.5 block truncate">
                {loading ? "…" : displayPrice}
              </span>
            </div>
            <div className="font-sans">
              <span className="text-[8px] text-text-muted block uppercase">Rating</span>
              <span className="font-bold text-text-primary text-[10px] mt-0.5 flex items-center justify-center gap-0.5 block">
                <Star className="w-2.5 h-2.5 text-warning fill-warning" />
                <span>{loading ? "…" : displayRating}</span>
              </span>
            </div>
            <div className="text-right font-sans">
              <span className="text-[8px] text-text-muted block uppercase">Reviews</span>
              <span className="font-bold text-text-primary text-[10px] mt-0.5 block truncate">
                {loading ? "…" : displayReviews}
              </span>
            </div>
          </div>
        )}

        {/* Tags */}
        {c.tags?.length > 0 && (
          <div className="flex flex-wrap gap-1 mb-4">
            {c.tags.slice(0, 3).map((t: string) => (
              <span key={t} className="px-1.5 py-0.5 rounded bg-surface-3 border border-border text-[9px] text-text-secondary">
                {t}
              </span>
            ))}
          </div>
        )}
      </div>

      <div className="pt-3 border-t border-border/60 mt-auto flex items-center justify-between">
        {c.asin && <span className="font-mono text-[9px] text-text-muted">ASIN: {c.asin}</span>}
        {amazonUrl && (
          <a
            href={amazonUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[10px] font-bold text-accent hover:underline flex items-center gap-0.5 ml-auto"
          >
            <span>{c.asin ? "Amazon" : "Website"}</span>
            <ExternalLink size={10} />
          </a>
        )}
        {!isFromAnalysis && !c.asin && (
          <button
            onClick={onDelete}
            className="text-[10px] font-bold text-danger hover:underline ml-auto"
          >
            Delete
          </button>
        )}
      </div>
    </div>
  );
}
