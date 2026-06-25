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
  AlertCircle,
  Edit2,
  Trash,
  Archive,
  RefreshCw,
  Target
} from "lucide-react";
import AddCompetitorModal from "@/components/competitors/AddCompetitorModal";
import { toast } from "sonner";

export default function CompetitorsPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  
  const [loading, setLoading] = useState(true);
  const [competitors, setCompetitors] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  
  // Filter and view states
  const [viewMode, setViewMode] = useState<"table" | "grid">("table");
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [selectedTag, setSelectedTag] = useState("ALL");
  const [sortField, setSortField] = useState("name");
  const [sortOrder, setSortOrder] = useState("asc");
  
  // Bulk selection states
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  
  // Available tags list for filter dropdown
  const [allTags, setAllTags] = useState<string[]>([]);

  // Open modal if URL query param has ?add=true
  useEffect(() => {
    if (searchParams.get("add") === "true") {
      setIsAddModalOpen(true);
    }
  }, [searchParams]);

  // Command palette listener
  useEffect(() => {
    const handleTriggerAdd = () => setIsAddModalOpen(true);
    window.addEventListener("trigger-add-competitor", handleTriggerAdd);
    return () => window.removeEventListener("trigger-add-competitor", handleTriggerAdd);
  }, []);

  const fetchCompetitors = async () => {
    try {
      setLoading(true);
      const params = new URLSearchParams({
        search: searchQuery,
        status: statusFilter,
        tags: selectedTag !== "ALL" ? selectedTag : "",
        sort: sortField,
        order: sortOrder,
        limit: "100"
      });
      
      const res = await fetch(`/api/competitors?${params.toString()}`);
      if (!res.ok) throw new Error("Failed to fetch");
      const data = await res.json();
      
      setCompetitors(data.competitors || []);
      setTotal(data.total || 0);
      
      // Extract all unique tags
      const tagsSet = new Set<string>();
      (data.competitors || []).forEach((c: any) => {
        if (c.tags) c.tags.forEach((t: string) => tagsSet.add(t));
      });
      setAllTags(Array.from(tagsSet));
    } catch (e: any) {
      toast.error("Failed to load competitors");
    } finally {
      setLoading(false);
    }
  };

  // Trigger fetch on filter change
  useEffect(() => {
    const delayDebounce = setTimeout(() => {
      fetchCompetitors();
    }, searchQuery ? 300 : 0); // debounce only when typing search query

    return () => clearTimeout(delayDebounce);
  }, [searchQuery, statusFilter, selectedTag, sortField, sortOrder]);

  const handleSelectRow = (id: string) => {
    setSelectedIds(prev =>
      prev.includes(id) ? prev.filter(item => item !== id) : [...prev, id]
    );
  };

  const handleSelectAll = () => {
    if (selectedIds.length === competitors.length) {
      setSelectedIds([]);
    } else {
      setSelectedIds(competitors.map(c => c.id));
    }
  };

  const handleBulkDelete = async () => {
    if (!window.confirm(`Are you sure you want to delete ${selectedIds.length} competitors?`)) return;
    
    let successCount = 0;
    for (const id of selectedIds) {
      try {
        const res = await fetch(`/api/competitors/${id}`, { method: "DELETE" });
        if (res.ok) successCount++;
      } catch (e) {}
    }
    
    toast.success(`Deleted ${successCount} competitors`);
    setSelectedIds([]);
    fetchCompetitors();
  };

  const handleBulkExportCSV = () => {
    const selectedList = competitors.filter(c => selectedIds.includes(c.id));
    if (selectedList.length === 0) return;
    
    const headers = ["Name", "Website", "Status", "Threat Score", "Tags", "Description"];
    const rows = selectedList.map(c => [
      c.name,
      c.website || "",
      c.status,
      c.threatScore,
      c.tags.join(";"),
      c.description || ""
    ]);
    
    const csvContent = "data:text/csv;charset=utf-8," 
      + [headers.join(","), ...rows.map(e => e.map(val => `"${val.replace(/"/g, '""')}"`).join(","))].join("\n");
      
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `stylecraft-competitors-export.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    
    toast.success("CSV file downloaded");
  };

  const handleBulkAnalysis = async () => {
    // Navigate to analyze page and auto-fill competitors
    toast.info("Opening analysis page with selected competitors...");
    router.push("/dashboard/analyze");
  };

  const handleArchiveCompetitor = async (id: string, currentStatus: string) => {
    try {
      const targetStatus = currentStatus === "ARCHIVED" ? "ACTIVE" : "ARCHIVED";
      const res = await fetch(`/api/competitors/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: targetStatus })
      });
      
      if (!res.ok) throw new Error();
      toast.success(targetStatus === "ARCHIVED" ? "Competitor archived" : "Competitor restored");
      fetchCompetitors();
    } catch (e) {
      toast.error("Failed to update status");
    }
  };

  const handleDeleteCompetitor = async (id: string) => {
    if (!window.confirm("Are you sure you want to delete this competitor?")) return;
    
    try {
      const res = await fetch(`/api/competitors/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error();
      toast.success("Competitor deleted");
      fetchCompetitors();
    } catch (e) {
      toast.error("Failed to delete competitor");
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
      {/* Header Row */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex items-center gap-3">
          <h1 className="text-display">Competitors</h1>
          <span className="inline-flex items-center justify-center bg-surface-3 border border-border px-2 py-0.5 rounded-full text-xs font-semibold text-text-secondary">
            {total} total
          </span>
        </div>
        <button
          onClick={() => setIsAddModalOpen(true)}
          className="flex items-center gap-1.5 px-4 py-2 bg-accent hover:bg-accent-hover text-white text-xs font-bold rounded-lg transition-colors shadow shadow-accent/20 shrink-0 self-start sm:self-auto"
        >
          <Plus className="w-4 h-4" />
          <span>Add competitor</span>
        </button>
      </div>

      {/* Filter Toolbar */}
      <div className="flex flex-col md:flex-row gap-3 items-stretch md:items-center justify-between p-3 bg-surface-2 border border-border rounded-xl">
        
        {/* Search Input */}
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-2.5 w-4 h-4 text-text-muted" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search by competitor name..."
            className="w-full pl-9 pr-4 py-1.5 text-xs border border-border rounded-lg bg-surface-1 outline-none text-text-primary placeholder-text-muted transition-colors focus:border-accent"
          />
        </div>

        {/* Dropdowns */}
        <div className="flex flex-wrap items-center gap-2">
          
          {/* Status Filter */}
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

          {/* Tags Filter */}
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

          {/* Sort Dropdown */}
          <select
            value={sortField}
            onChange={(e) => setSortField(e.target.value)}
            className="px-2.5 py-1.5 text-xs bg-surface-1 border border-border rounded-lg text-text-primary outline-none focus:border-accent"
          >
            <option value="name">Sort: Name A–Z</option>
            <option value="updated">Sort: Last Updated</option>
            <option value="date">Sort: Date Added</option>
          </select>

          {/* View Mode Toggle */}
          <div className="flex items-center rounded-lg border border-border p-0.5 bg-surface-1">
            <button
              onClick={() => setViewMode("table")}
              className={`p-1 rounded-md transition-colors ${
                viewMode === "table" ? "bg-surface-3 text-accent" : "text-text-muted hover:text-text-primary"
              }`}
              title="Table view"
            >
              <List className="w-4 h-4" />
            </button>
            <button
              onClick={() => setViewMode("grid")}
              className={`p-1 rounded-md transition-colors ${
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
              onClick={handleBulkAnalysis}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-accent text-white text-[11px] font-bold hover:bg-accent-hover transition-colors"
            >
              <Play className="w-3.5 h-3.5" />
              <span>Analyze selected</span>
            </button>
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
              <span>Delete</span>
            </button>
          </div>
        </div>
      )}

      {/* Main Listing Content */}
      {loading ? (
        <div className="flex flex-col items-center justify-center p-20 bg-surface-2 border border-border rounded-xl">
          <RefreshCw className="w-8 h-8 text-accent animate-spin mb-3" />
          <p className="text-xs text-text-muted font-medium">Fetching competitors data...</p>
        </div>
      ) : competitors.length > 0 ? (
        viewMode === "table" ? (
          /* TABLE VIEW */
          <div className="bg-surface-2 border border-border rounded-xl overflow-hidden shadow-md">
            <div className="overflow-x-auto">
              <table className="w-full text-xs text-left border-collapse">
                <thead>
                  <tr className="border-b border-border/80 text-text-muted font-bold bg-surface-3/20">
                    <th className="py-3 px-4 w-10">
                      <input
                        type="checkbox"
                        checked={selectedIds.length === competitors.length && competitors.length > 0}
                        onChange={handleSelectAll}
                        className="rounded border-border bg-surface-1 focus:ring-accent w-3.5 h-3.5 accent-indigo-500"
                      />
                    </th>
                    <th className="py-3 px-4 w-12">Logo</th>
                    <th className="py-3 px-4">Name & Website</th>
                    <th className="py-3 px-4">Status</th>
                    <th className="py-3 px-4">Tags</th>
                    <th className="py-3 px-4">Threat Score</th>
                    <th className="py-3 px-4">Last Analyzed</th>
                    <th className="py-3 px-4 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/40">
                  {competitors.map((c) => {
                    const isSelected = selectedIds.includes(c.id);
                    return (
                      <tr 
                        key={c.id} 
                        className={`hover:bg-surface-3/30 transition-colors ${
                          isSelected ? "bg-accent-bg/10" : ""
                        }`}
                      >
                        <td className="py-3 px-4">
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => handleSelectRow(c.id)}
                            className="rounded border-border bg-surface-1 focus:ring-accent w-3.5 h-3.5 accent-indigo-500"
                          />
                        </td>
                        <td className="py-3 px-4">
                          <img
                            src={c.logoUrl || `https://ui-avatars.com/api/?name=${c.name}&background=1C1C22&color=6366F1`}
                            alt={c.name}
                            onError={(e) => {
                              (e.target as HTMLImageElement).src = `https://ui-avatars.com/api/?name=${c.name}&background=1C1C22&color=6366F1`;
                            }}
                            className="w-7 h-7 rounded object-cover border border-border bg-surface-3"
                          />
                        </td>
                        <td className="py-3 px-4">
                          <span 
                            onClick={() => router.push(`/dashboard/competitors/${c.id}`)}
                            className="font-bold text-text-primary hover:text-accent cursor-pointer transition-colors block"
                          >
                            {c.name}
                          </span>
                          {c.website ? (
                            <a 
                              href={c.website} 
                              target="_blank" 
                              rel="noreferrer"
                              className="text-[10px] text-text-muted hover:underline block mt-0.5"
                            >
                              {c.website}
                            </a>
                          ) : (
                            <span className="text-[10px] text-text-muted block mt-0.5">No domain</span>
                          )}
                        </td>
                        <td className="py-3 px-4">
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
                        </td>
                        <td className="py-3 px-4">
                          <div className="flex flex-wrap gap-1 max-w-[200px]">
                            {c.tags.slice(0, 3).map((tag: string) => (
                              <span key={tag} className="px-1.5 py-0.5 rounded bg-surface-3 border border-border text-[9px] text-text-secondary">
                                {tag}
                              </span>
                            ))}
                            {c.tags.length > 3 && (
                              <span className="px-1 py-0.5 text-[9px] text-text-muted">+{c.tags.length - 3}</span>
                            )}
                          </div>
                        </td>
                        <td className="py-3 px-4">
                          <div className="flex items-center gap-2">
                            <div className="w-16 h-1.5 bg-surface-3 border border-border rounded-full overflow-hidden">
                              <div 
                                className="h-full bg-accent"
                                style={{ width: `${c.threatScore}%` }}
                              />
                            </div>
                            <span className="font-mono text-text-secondary">{c.threatScore}</span>
                          </div>
                        </td>
                        <td className="py-3 px-4 text-text-muted">
                          {formatRelativeTime(c.updatedAt)}
                        </td>
                        <td className="py-3 px-4 text-right space-x-1.5">
                          <button
                            onClick={() => router.push(`/dashboard/competitors/${c.id}`)}
                            title="View details"
                            className="p-1 rounded hover:bg-surface-3 text-text-secondary hover:text-text-primary transition-colors"
                          >
                            <ChevronRight className="w-4 h-4" />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        ) : (
          /* CARD GRID VIEW */
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {competitors.map((c) => (
              <div 
                key={c.id}
                className="bg-surface-2 border border-border rounded-xl p-5 flex flex-col justify-between shadow hover:border-border-strong transition-all duration-200"
              >
                <div>
                  <div className="flex justify-between items-start mb-3">
                    <img
                      src={c.logoUrl || `https://ui-avatars.com/api/?name=${c.name}&background=1C1C22&color=6366F1`}
                      alt={c.name}
                      onError={(e) => {
                        (e.target as HTMLImageElement).src = `https://ui-avatars.com/api/?name=${c.name}&background=1C1C22&color=6366F1`;
                      }}
                      className="w-10 h-10 rounded object-cover border border-border bg-surface-3"
                    />
                    <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 text-[9px] font-semibold border rounded-full ${
                      c.status === "ACTIVE" ? "bg-success-bg border-success/20 text-success" :
                      c.status === "MONITORING" ? "bg-warning-bg border-warning/20 text-warning" :
                      "bg-zinc-800 border-zinc-700 text-zinc-400"
                    }`}>
                      {c.status}
                    </span>
                  </div>

                  <h3 
                    onClick={() => router.push(`/dashboard/competitors/${c.id}`)}
                    className="text-sm font-bold text-text-primary hover:text-accent cursor-pointer transition-colors"
                  >
                    {c.name}
                  </h3>
                  
                  {c.website && (
                    <a 
                      href={c.website} 
                      target="_blank" 
                      rel="noreferrer"
                      className="text-[10px] text-text-muted hover:underline block mt-0.5 mb-2.5"
                    >
                      {c.website}
                    </a>
                  )}
                  
                  {c.description && (
                    <p className="text-xs text-text-secondary leading-normal mb-4 line-clamp-2" title={c.description}>
                      {c.description}
                    </p>
                  )}

                  {/* Tags */}
                  <div className="flex flex-wrap gap-1.5 mb-4">
                    {c.tags.slice(0, 3).map((tag: string) => (
                      <span key={tag} className="px-1.5 py-0.5 rounded bg-surface-3 border border-border text-[9px] text-text-secondary">
                        {tag}
                      </span>
                    ))}
                    {c.tags.length > 3 && (
                      <span className="px-1 py-0.5 text-[9px] text-text-muted">+{c.tags.length - 3}</span>
                    )}
                  </div>
                </div>

                {/* Threat Score + details link */}
                <div className="pt-4 border-t border-border/60 flex items-center justify-between">
                  <div>
                    <span className="text-[9px] text-text-muted font-semibold block uppercase">Threat Score</span>
                    <div className="flex items-center gap-2 mt-1">
                      <div className="w-16 h-1 bg-surface-3 rounded-full overflow-hidden">
                        <div className="h-full bg-accent" style={{ width: `${c.threatScore}%` }} />
                      </div>
                      <span className="text-xs font-bold font-mono text-text-secondary leading-none">{c.threatScore}</span>
                    </div>
                  </div>
                  
                  <button
                    onClick={() => router.push(`/dashboard/competitors/${c.id}`)}
                    className="flex items-center gap-1 text-[11px] font-bold text-accent hover:text-accent-hover transition-colors"
                  >
                    <span>View details</span>
                    <ChevronRight className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )
      ) : (
        /* EMPTY STATE */
        <div className="flex flex-col items-center justify-center p-16 bg-surface-2 border border-border rounded-xl text-center">
          <div className="p-4 rounded-full bg-surface-3 border border-border-strong text-text-secondary mb-4">
            <Target className="w-10 h-10 opacity-70 animate-pulse" />
          </div>
          <h2 className="text-base font-bold text-text-primary mb-1">No competitors yet</h2>
          <p className="text-xs text-text-muted max-w-sm mb-6">
            Add your first competitor to start tracking the market and generate AI competitive insights.
          </p>
          <button
            onClick={() => setIsAddModalOpen(true)}
            className="flex items-center gap-1.5 px-4 py-2 bg-accent hover:bg-accent-hover text-white text-xs font-bold rounded-lg transition-colors shadow shadow-accent/25"
          >
            <Plus className="w-4 h-4" />
            <span>Add competitor</span>
          </button>
        </div>
      )}

      {/* Add Competitor Drawer Modal Overlay */}
      <AddCompetitorModal
        isOpen={isAddModalOpen}
        onClose={() => setIsAddModalOpen(false)}
        onSuccess={fetchCompetitors}
      />
    </div>
  );
}
