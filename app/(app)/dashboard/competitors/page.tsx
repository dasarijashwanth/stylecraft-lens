// app/(app)/dashboard/competitors/page.tsx
"use client";

import { useState, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { 
  Search, 
  LayoutGrid, 
  List, 
  Plus, 
  Trash2, 
  FileSpreadsheet, 
  RefreshCw,
  Star,
  ExternalLink,
  Target,
  ShieldAlert
} from "lucide-react";
import AddCompetitorModal from "@/components/competitors/AddCompetitorModal";
import { useAuth } from "@/hooks/useAuth";
import { useAmazonProduct } from "@/hooks/useAmazonProduct";
import { toast } from "sonner";
import { Badge, type BadgeTone } from "@/components/ui/Badge";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { MagicBentoSection, MagicBentoCard } from "@/components/ui/MagicBento";

function statusBadgeTone(status: string): BadgeTone {
  const s = status.toUpperCase();
  return s === "ACTIVE" ? "status-active" : s === "MONITORING" ? "status-monitoring" : "status-archived";
}

type TabView = "all" | "analysis" | "manual";

export default function CompetitorsPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user } = useAuth();
  
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<TabView>("all");
  
  // raw data states
  const [allFetched, setAllFetched] = useState<any[]>([]);
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
  const [confirmBulkDeleteOpen, setConfirmBulkDeleteOpen] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

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
      
      const manualRes = await fetch(`/api/competitors?limit=100`);
      const manualData = await manualRes.json();
      
      const analysisRes = await fetch(`/api/competitors?source=analysis`);
      const analysisData = await analysisRes.json();
      
      const fetched = manualData.competitors || [];
      const analysis = analysisData.competitors || [];
      
      setAllFetched(fetched);
      setAnalysisCompetitors(analysis);
      
      // Extract unique tags for filtering
      const tagsSet = new Set<string>();
      fetched.forEach((c: any) => {
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

  // Split fixed reference list from manual/added/analysis ones
  const fixedReference = allFetched.filter(c => c.is_fixed === true);
  
  const nonFixedManual = allFetched.filter(c => c.is_fixed !== true);
  const activeUserCompetitors = tab === "manual" ? nonFixedManual
                              : tab === "analysis" ? uniqueAnalysis
                              : [...nonFixedManual, ...uniqueAnalysis];

  // Helper to apply client-side filtering & sorting
  const filterAndSort = (list: any[]) => {
    const filtered = list.filter(c => {
      const matchesSearch = !searchQuery ||
        c.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        c.brand?.toLowerCase().includes(searchQuery.toLowerCase());
        
      const isFromAnalysis = !c.status;
      const matchesStatus = statusFilter === "ALL" ||
        (isFromAnalysis && statusFilter === "ACTIVE") ||
        (c.status?.toUpperCase() === statusFilter);
        
      const matchesTag = selectedTag === "ALL" ||
        (c.tags && c.tags.map((t: string) => t.toLowerCase()).includes(selectedTag.toLowerCase()));

      return matchesSearch && matchesStatus && matchesTag;
    });

    return [...filtered].sort((a, b) => {
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
  };

  const processedFixed = filterAndSort(fixedReference);
  const processedUser = filterAndSort(activeUserCompetitors);

  const handleSelectRow = (id: string) => {
    setSelectedIds(prev =>
      prev.includes(id) ? prev.filter(item => item !== id) : [...prev, id]
    );
  };

  const handleSelectAllUser = () => {
    if (selectedIds.length === processedUser.length) {
      setSelectedIds([]);
    } else {
      setSelectedIds(processedUser.map(c => c.id || `${c.analysis_id}_${c.asin || c.name}`));
    }
  };

  const handleBulkDelete = async () => {
    setDeleting(true);
    let successCount = 0;
    for (const id of selectedIds) {
      // Do not allow deleting analysis / fixed competitors
      if (id.includes("_p1") || id.includes("_p2")) continue;
      const compObj = nonFixedManual.find(c => c.id === id);
      if (!compObj) continue;

      try {
        const res = await fetch(`/api/competitors/${id}`, { method: "DELETE" });
        if (res.ok) successCount++;
      } catch (e) {}
    }

    toast.success(`Deleted ${successCount} manual competitors`);
    setSelectedIds([]);
    setConfirmBulkDeleteOpen(false);
    setDeleting(false);
    loadAll();
  };

  const handleBulkExportCSV = () => {
    const selectedList = [...processedFixed, ...processedUser].filter(c => {
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

  const handleDeleteCompetitor = async () => {
    if (!confirmDeleteId) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/competitors/${confirmDeleteId}`, { method: "DELETE" });
      if (!res.ok) throw new Error();
      toast.success("Competitor deleted");
      setConfirmDeleteId(null);
      loadAll();
    } catch (e) {
      toast.error("Failed to delete competitor");
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="space-y-8 text-xs">
      
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex items-center gap-3">
          <h1 className="text-display font-sans">Competitors</h1>
          <span className="inline-flex items-center justify-center bg-surface-3 border border-border px-2.5 py-0.5 rounded-full text-[10px] font-bold text-text-secondary">
            {allFetched.length + uniqueAnalysis.length} total
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

      {/* Filter Toolbar */}
      <div className="flex flex-col md:flex-row gap-3 items-stretch md:items-center justify-between p-3 bg-surface-2 border border-border rounded-xl">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-2.5 w-4 h-4 text-text-muted" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search competitors..."
            className="w-full pl-9 pr-4 py-1.5 text-xs border border-border rounded-lg bg-surface-1 outline-none text-text-primary placeholder-text-muted transition-colors focus:border-accent"
          />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="px-2.5 py-1.5 text-xs bg-surface-1 border border-border rounded-lg text-text-primary outline-none focus:border-accent font-semibold"
          >
            <option value="ALL">All Statuses</option>
            <option value="ACTIVE">Active</option>
            <option value="MONITORING">Monitoring</option>
            <option value="ARCHIVED">Archived</option>
          </select>

          <select
            value={selectedTag}
            onChange={(e) => setSelectedTag(e.target.value)}
            className="px-2.5 py-1.5 text-xs bg-surface-1 border border-border rounded-lg text-text-primary outline-none focus:border-accent font-semibold"
          >
            <option value="ALL">All Tags</option>
            {allTags.map(tag => (
              <option key={tag} value={tag}>{tag}</option>
            ))}
          </select>

          <select
            value={sortField}
            onChange={(e) => setSortField(e.target.value)}
            className="px-2.5 py-1.5 text-xs bg-surface-1 border border-border rounded-lg text-text-primary outline-none focus:border-accent font-semibold"
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
        <div className="flex items-center justify-between p-3 border border-accent-border bg-accent-bg rounded-xl">
          <span className="text-xs font-semibold text-accent-text">
            {selectedIds.length} items selected
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
              onClick={() => setConfirmBulkDeleteOpen(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-danger/10 border border-danger/25 text-danger text-[11px] font-bold hover:bg-danger/20 transition-colors"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>Delete selected</span>
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="flex flex-col items-center justify-center py-24 bg-surface-2 border border-border rounded-xl">
          <RefreshCw className="w-8 h-8 text-accent animate-spin mb-3" />
          <p className="text-xs text-text-muted font-medium animate-pulse">Syncing competitors database...</p>
        </div>
      ) : (
        <div className="space-y-10">
          
          {/* SECTION 1: FIXED REFERENCE BRANDS */}
          <div className="space-y-3.5">
            <div className="border-b border-border pb-2 flex items-center justify-between bg-surface-3/10 px-3 py-2 rounded-t-lg">
              <div>
                <h2 className="text-sm font-bold text-text-primary">Fixed Reference Brands</h2>
                <p className="text-[10px] text-text-muted mt-0.5">Permanent industry benchmark brands (locked for modifications)</p>
              </div>
              <span className="bg-surface-3 px-2 py-0.5 rounded text-[10px] font-bold text-text-secondary border border-border">
                {processedFixed.length} brands
              </span>
            </div>

            {processedFixed.length === 0 ? (
              <p className="text-xs text-text-muted p-4 border border-dashed border-border rounded-xl text-center bg-surface-2">
                No fixed reference brands match the search query.
              </p>
            ) : viewMode === "table" ? (
              <div className="bg-surface-2 border border-border rounded-xl overflow-hidden shadow-sm">
                <table className="w-full text-xs text-left border-collapse">
                  <thead>
                    <tr className="border-b border-border/80 text-text-muted font-bold bg-surface-3/20">
                      <th className="py-2.5 px-4">Name & Website</th>
                      <th className="py-2.5 px-4">Main Categories / Products</th>
                      <th className="py-2.5 px-4">Tags</th>
                      <th className="py-2.5 px-4 text-right">Access</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/40">
                    {processedFixed.map(c => (
                      <tr key={c.id} className="hover:bg-surface-3/10 transition-colors">
                        <td className="py-3 px-4">
                          <span className="font-bold text-text-primary block">{c.name}</span>
                          {c.website && (
                            <a 
                              href={c.website} 
                              target="_blank" 
                              rel="noreferrer"
                              className="text-[10px] text-accent hover:underline inline-flex items-center gap-0.5 mt-0.5"
                            >
                              <span>{c.website}</span>
                              <ExternalLink size={9} />
                            </a>
                          )}
                        </td>
                        <td className="py-3 px-4 text-text-secondary">{c.main_products || "Grooming & Styling Tools"}</td>
                        <td className="py-3 px-4">
                          <div className="flex flex-wrap gap-1">
                            {(c.tags || []).map((tag: string) => (
                              <span key={tag} className="px-1.5 py-0.5 rounded bg-surface-3 border border-border text-[9px] font-mono text-text-secondary">
                                {tag}
                              </span>
                            ))}
                          </div>
                        </td>
                        <td className="py-3 px-4 text-right">
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-surface-3 border border-border text-[9px] text-text-muted font-semibold">
                            Reference Only
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <MagicBentoSection className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {processedFixed.map(c => (
                  <MagicBentoCard key={c.id} className="p-5 flex flex-col justify-between">
                    <div>
                      <div className="flex items-center justify-between gap-2 mb-2">
                        <h4 className="text-xs font-bold text-text-primary">{c.name}</h4>
                        <span className="bg-surface-3 border border-border px-1.5 py-0.5 rounded text-[8px] font-bold text-text-muted uppercase">Fixed</span>
                      </div>
                      <p className="text-[10px] text-text-secondary leading-relaxed mb-3">
                        {c.main_products || "Leading industry product references for performance & sizing."}
                      </p>
                      <div className="flex flex-wrap gap-1 mb-2">
                        {(c.tags || []).map((tag: string) => (
                          <span key={tag} className="px-1.5 py-0.5 rounded bg-surface-3 border border-border text-[9px] text-text-secondary font-mono">
                            {tag}
                          </span>
                        ))}
                      </div>
                    </div>
                    {c.website && (
                      <a href={c.website} target="_blank" rel="noreferrer" className="text-[9px] text-accent hover:underline flex items-center gap-0.5 mt-2 self-start font-bold">
                        <span>Visit Site</span>
                        <ExternalLink size={9} />
                      </a>
                    )}
                  </MagicBentoCard>
                ))}
              </MagicBentoSection>
            )}
          </div>

          {/* SECTION 2: DISCOVERED & ADDED COMPETITORS */}
          <div className="space-y-3.5">
            <div className="border-b border-border pb-2 flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-surface-3/10 px-3 py-2 rounded-t-lg">
              <div>
                <h2 className="text-sm font-bold text-text-primary">Discovered & Added Competitors</h2>
                <p className="text-[10px] text-text-muted mt-0.5">Competitors added manually or mapped via analysis engines</p>
              </div>

              {/* Sub-tab filter */}
              <div className="flex items-center gap-1 p-0.5 rounded-lg border border-border bg-surface-1 self-start sm:self-auto">
                {([
                  { key: "all", label: "All User" },
                  { key: "analysis", label: "From Analyses" },
                  { key: "manual", label: "Manual Entries" }
                ] as { key: TabView; label: string }[]).map(t => (
                  <button
                    key={t.key}
                    onClick={() => { setTab(t.key); setSelectedIds([]); }}
                    className={`px-3 py-1 rounded text-[10px] font-bold transition-all ${
                      tab === t.key 
                        ? "bg-surface-3 text-text-primary border border-border-strong shadow-sm" 
                        : "text-text-secondary hover:text-text-primary"
                    }`}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
            </div>

            {processedUser.length === 0 ? (
              <div className="flex flex-col items-center justify-center p-12 bg-surface-2 border border-border border-dashed rounded-xl text-center">
                <Target className="w-8 h-8 text-text-muted mb-2 opacity-50" />
                <p className="text-xs font-bold text-text-primary">No manual or discovered competitors</p>
                <p className="text-[10px] text-text-muted max-w-xs mt-1 leading-normal">
                  Run competitive analyses or use &quot;Add competitor&quot; to populate your local database workspace.
                </p>
              </div>
            ) : viewMode === "table" ? (
              <div className="bg-surface-2 border border-border rounded-xl overflow-hidden shadow-sm">
                <table className="w-full text-xs text-left border-collapse">
                  <thead>
                    <tr className="border-b border-border/80 text-text-muted font-bold bg-surface-3/20">
                      <th className="py-2.5 px-4 w-10">
                        <input
                          type="checkbox"
                          checked={selectedIds.length === processedUser.length && processedUser.length > 0}
                          onChange={handleSelectAllUser}
                          className="rounded border-border bg-surface-1 focus:ring-accent w-3.5 h-3.5 accent-indigo-500"
                        />
                      </th>
                      <th className="py-2.5 px-4">Name & URL</th>
                      <th className="py-2.5 px-4">Type / Status</th>
                      <th className="py-2.5 px-4">Tags</th>
                      <th className="py-2.5 px-4">Amazon ASIN</th>
                      <th className="py-2.5 px-4 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/40">
                    {processedUser.map(c => {
                      const isFromAnalysis = !c.status;
                      const id = c.id || `${c.analysis_id}_${c.asin || c.name}`;
                      const isSelected = selectedIds.includes(id);
                      return (
                        <tr 
                          key={id} 
                          className={`hover:bg-surface-3/15 transition-colors ${
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
                          <td className="py-3 px-4">
                            <span className="font-bold text-text-primary block">{c.name}</span>
                            {c.website || c.amazon_url ? (
                              <a 
                                href={c.website || c.amazon_url} 
                                target="_blank" 
                                rel="noreferrer"
                                className="text-[10px] text-accent hover:underline inline-flex items-center gap-0.5 mt-0.5"
                              >
                                <span>{c.website || "View Listing"}</span>
                                <ExternalLink size={9} />
                              </a>
                            ) : (
                              <span className="text-[10px] text-text-muted mt-0.5 block">No URL</span>
                            )}
                          </td>
                          <td className="py-3 px-4">
                            {isFromAnalysis ? (
                              <Badge tone="accent" dot>Analysis Mapped</Badge>
                            ) : (
                              <Badge tone={statusBadgeTone(c.status)} dot>{c.status}</Badge>
                            )}
                          </td>
                          <td className="py-3 px-4">
                            <div className="flex flex-wrap gap-1 max-w-[200px]">
                              {(c.tags || []).slice(0, 3).map((tag: string) => (
                                <span key={tag} className="px-1.5 py-0.5 rounded bg-surface-3 border border-border text-[9px] text-text-secondary font-mono">
                                  {tag}
                                </span>
                              ))}
                            </div>
                          </td>
                          <td className="py-3 px-4 font-mono text-[10px] text-text-secondary">{c.asin || "—"}</td>
                          <td className="py-3 px-4 text-right">
                            {!isFromAnalysis && (
                              <button
                                onClick={() => setConfirmDeleteId(c.id)}
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
            ) : (
              <MagicBentoSection className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {processedUser.map(c => {
                  const isFromAnalysis = !c.status;
                  const id = c.id || `${c.analysis_id}_${c.asin || c.name}`;
                  return (
                    <CompetitorGridCard
                      key={id}
                      competitor={c}
                      isFromAnalysis={isFromAnalysis}
                      onDelete={() => setConfirmDeleteId(c.id)}
                    />
                  );
                })}
              </MagicBentoSection>
            )}
          </div>

        </div>
      )}

      {/* Add Competitor Modal */}
      <AddCompetitorModal
        isOpen={isAddModalOpen}
        onClose={() => setIsAddModalOpen(false)}
        onSuccess={loadAll}
      />

      <ConfirmDialog
        isOpen={confirmBulkDeleteOpen}
        title={`Delete ${selectedIds.length} competitors?`}
        description="This will permanently delete the selected manual competitors. Analysis-mapped and fixed reference competitors are never removed by bulk delete. This action is irreversible."
        confirmLabel="Delete selected"
        loading={deleting}
        onConfirm={handleBulkDelete}
        onClose={() => setConfirmBulkDeleteOpen(false)}
      />

      <ConfirmDialog
        isOpen={!!confirmDeleteId}
        title="Delete this competitor?"
        description="This will permanently delete the competitor. This action is irreversible."
        confirmLabel="Delete competitor"
        loading={deleting}
        onConfirm={handleDeleteCompetitor}
        onClose={() => setConfirmDeleteId(null)}
      />
    </div>
  );
}

// ─── Grid Card Wrapper ───────────────────────────────────────────
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
    <MagicBentoCard className={`p-5 flex flex-col justify-between ${isFromAnalysis ? "border-l-4 border-l-accent" : ""}`}>
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
            <Badge tone="accent" uppercase>Analysis</Badge>
          ) : (
            <Badge tone={statusBadgeTone(c.status)} uppercase>{c.status}</Badge>
          )}
        </div>

        {c.description && (
          <p className="text-[10px] text-text-secondary line-clamp-2 leading-relaxed mb-3">
            {c.description}
          </p>
        )}

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

        {c.tags?.length > 0 && (
          <div className="flex flex-wrap gap-1 mb-4">
            {c.tags.slice(0, 3).map((t: string) => (
              <span key={t} className="px-1.5 py-0.5 rounded bg-surface-3 border border-border text-[9px] text-text-secondary font-mono">
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
    </MagicBentoCard>
  );
}
