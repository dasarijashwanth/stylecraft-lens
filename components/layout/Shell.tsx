"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { 
  Search, 
  Command, 
  Target, 
  FolderOpen, 
  FileText, 
  ArrowRight,
  Sparkles,
  Settings,
  HelpCircle,
  X
} from "lucide-react";
import Sidebar from "./Sidebar";
import Topbar from "./Topbar";
import { useAuth } from "@/hooks/useAuth";
import { Spinner } from "@/components/ui/Spinner";
import { Modal } from "@/components/ui/Modal";

export default function Shell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { isSignedIn, loading, user } = useAuth();

  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  
  // Search data stores
  const [competitors, setCompetitors] = useState<any[]>([]);
  const [projects, setProjects] = useState<any[]>([]);
  const [reports, setReports] = useState<any[]>([]);
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Redirect to sign-in if not signed in and loading is complete; force a
  // password change before allowing access to anything else if the seeded
  // admin hasn't replaced their temporary bootstrap password yet.
  useEffect(() => {
    if (loading) return;
    if (!isSignedIn) {
      router.push("/sign-in");
    } else if (user?.mustChangePassword) {
      router.push("/change-password");
    }
  }, [loading, isSignedIn, user, router]);

  // Fetch search index once when search opens
  useEffect(() => {
    if (searchOpen) {
      // Fetch competitors, projects, reports in parallel
      Promise.all([
        fetch("/api/competitors?limit=100").then(r => r.json()).catch(() => ({ competitors: [] })),
        fetch("/api/projects").then(r => r.json()).catch(() => ({ projects: [] })),
        fetch("/api/reports").then(r => r.json()).catch(() => ({ reports: [] }))
      ]).then(([compData, projData, repData]) => {
        setCompetitors(compData.competitors || []);
        setProjects(projData.projects || []);
        setReports(repData.reports || []);
      });
      
      // Reset search query and focus
      setSearchQuery("");
      setActiveIndex(0);
      setTimeout(() => searchInputRef.current?.focus(), 50);
    }
  }, [searchOpen]);

  // Keyboard shortcut listener (⌘K / Ctrl+K)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setSearchOpen(prev => !prev);
      }
      
      if (!searchOpen) return;

      if (e.key === "Escape") {
        setSearchOpen(false);
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        setActiveIndex(prev => (prev + 1) % Math.max(1, searchResults.length));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setActiveIndex(prev => (prev - 1 + searchResults.length) % Math.max(1, searchResults.length));
      } else if (e.key === "Enter") {
        e.preventDefault();
        if (searchResults[activeIndex]) {
          handleSelectResult(searchResults[activeIndex]);
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [searchOpen, searchResults, activeIndex]);

  // Client-side search and match logic
  useEffect(() => {
    if (!searchOpen) return;

    const actions = [
      { id: "act_analyze", title: "Run new AI analysis", category: "Actions", icon: Sparkles, url: "/dashboard/analyze" },
      { id: "act_comp_new", title: "Add new competitor", category: "Actions", icon: Target, url: "/dashboard/competitors?add=true" },
      { id: "act_proj_new", title: "Create new project", category: "Actions", icon: FolderOpen, url: "/dashboard/projects?new=true" },
      { id: "act_settings", title: "Configure settings", category: "Actions", icon: Settings, url: "/dashboard/settings" },
    ];

    if (!searchQuery) {
      // Show default/recent items
      const recentCompetitors = competitors.slice(0, 3).map(c => ({ id: c.id, title: c.name, category: "Competitors", icon: Target, url: `/dashboard/competitors/${c.id}` }));
      const recentProjects = projects.slice(0, 3).map(p => ({ id: p.id, title: p.name, category: "Projects", icon: FolderOpen, url: `/dashboard/projects/${p.id}` }));
      const recentReports = reports.slice(0, 3).map(r => ({ id: r.id, title: r.title, category: "Reports", icon: FileText, url: `/dashboard/reports/${r.id}` }));
      
      setSearchResults([...actions, ...recentCompetitors, ...recentProjects, ...recentReports]);
      setActiveIndex(0);
      return;
    }

    const q = searchQuery.toLowerCase();
    const matchedComps = competitors
      .filter(c => c.name.toLowerCase().includes(q) || (c.tags && c.tags.some((t: string) => t.toLowerCase().includes(q))))
      .map(c => ({ id: c.id, title: c.name, category: "Competitors", subtitle: c.website || undefined, icon: Target, url: `/dashboard/competitors/${c.id}` }));

    const matchedProjs = projects
      .filter(p => p.name.toLowerCase().includes(q) || p.productName.toLowerCase().includes(q))
      .map(p => ({ id: p.id, title: p.name, category: "Projects", subtitle: p.productName, icon: FolderOpen, url: `/dashboard/projects/${p.id}` }));

    const matchedReps = reports
      .filter(r => r.title.toLowerCase().includes(q))
      .map(r => ({ id: r.id, title: r.title, category: "Reports", icon: FileText, url: `/dashboard/reports/${r.id}` }));

    const matchedActions = actions.filter(a => a.title.toLowerCase().includes(q));

    setSearchResults([...matchedActions, ...matchedComps, ...matchedProjs, ...matchedReps]);
    setActiveIndex(0);
  }, [searchQuery, competitors, projects, reports, searchOpen]);

  const handleSelectResult = (result: any) => {
    setSearchOpen(false);
    
    // Check if adding competitor via modal trigger parameter
    if (result.url === "/dashboard/competitors?add=true") {
      router.push("/dashboard/competitors");
      // Trigger modal open via storage or custom event emitter
      setTimeout(() => window.dispatchEvent(new CustomEvent("trigger-add-competitor")), 100);
    } else {
      router.push(result.url);
    }
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-bg">
        <Spinner size="lg" className="text-accent" />
        <span className="text-xs text-text-muted mt-3 font-medium">Authorizing session...</span>
      </div>
    );
  }

  if (!isSignedIn) return null;

  return (
    <div className="min-h-screen bg-bg text-text-primary">
      {/* Sidebar navigation */}
      <Sidebar isOpen={sidebarOpen} setIsOpen={setSidebarOpen} />

      {/* Main content wrapper */}
      <div className="flex flex-col lg:pl-[var(--sidebar-width)] min-h-screen">
        <Topbar 
          onMenuClick={() => setSidebarOpen(true)} 
          onSearchClick={() => setSearchOpen(true)} 
        />
        
        <main className="flex-1 p-4 md:p-6 max-w-7xl w-full mx-auto">
          {children}
        </main>
      </div>

      {/* Global Command Palette Search Modal */}
      <Modal isOpen={searchOpen} onClose={() => setSearchOpen(false)} placement="top" size="xl" className="overflow-hidden max-h-[500px]">
            {/* Search Input bar */}
            <div className="flex items-center gap-3 px-4 py-3.5 border-b border-border bg-surface-3/50">
              <Search className="w-5 h-5 text-text-muted shrink-0" />
              <input
                ref={searchInputRef}
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Type a command or search term..."
                className="w-full text-sm bg-transparent outline-none border-none text-text-primary placeholder-text-muted"
              />
              <button 
                onClick={() => setSearchOpen(false)}
                className="p-1 rounded hover:bg-surface-3 text-text-secondary transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Results list */}
            <div className="flex-1 overflow-y-auto p-2 space-y-3">
              {searchResults.length > 0 ? (
                // Group results by category
                Array.from(new Set(searchResults.map(r => r.category))).map(category => (
                  <div key={category} className="space-y-1">
                    <p className="px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-text-muted">{category}</p>
                    
                    {searchResults
                      .filter(r => r.category === category)
                      .map((result) => {
                        const globalIndex = searchResults.indexOf(result);
                        const isSelected = globalIndex === activeIndex;
                        const Icon = result.icon;
                        
                        return (
                          <div
                            key={result.id}
                            onClick={() => handleSelectResult(result)}
                            onMouseEnter={() => setActiveIndex(globalIndex)}
                            className={`flex items-center justify-between px-3 py-2.5 rounded-lg cursor-pointer transition-colors ${
                              isSelected 
                                ? "bg-accent text-white" 
                                : "hover:bg-surface-3 text-text-primary"
                            }`}
                          >
                            <div className="flex items-center gap-3 min-w-0">
                              <Icon className={`w-4 h-4 shrink-0 ${isSelected ? "text-white" : "text-text-muted"}`} />
                              <div className="min-w-0">
                                <p className="text-xs font-semibold truncate leading-none">{result.title}</p>
                                {result.subtitle && (
                                  <p className={`text-[10px] mt-1 truncate ${isSelected ? "text-white/80" : "text-text-muted"}`}>
                                    {result.subtitle}
                                  </p>
                                )}
                              </div>
                            </div>
                            
                            {isSelected && (
                              <ArrowRight className="w-3.5 h-3.5 shrink-0 text-white animate-pulse" />
                            )}
                          </div>
                        );
                      })}
                  </div>
                ))
              ) : (
                <div className="p-8 text-center text-text-muted">
                  <Command className="w-8 h-8 mx-auto mb-2 text-text-muted/60 opacity-60" />
                  <p className="text-xs">No matches found for &quot;{searchQuery}&quot;</p>
                </div>
              )}
            </div>

            {/* Footer hints */}
            <div className="px-4 py-2 border-t border-border bg-surface-3/30 flex items-center justify-between text-[10px] text-text-muted">
              <div className="flex items-center gap-3">
                <span>↑↓ navigate</span>
                <span>↵ select</span>
                <span>esc close</span>
              </div>
              <div className="flex items-center gap-1 font-mono">
                <span>Ctrl</span>
                <span>+</span>
                <span>K</span>
              </div>
            </div>
      </Modal>
    </div>
  );
}
