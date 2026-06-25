"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { 
  Target, 
  Sparkles, 
  FileText, 
  TrendingUp, 
  ArrowRight,
  Plus,
  Play,
  Download,
  AlertCircle
} from "lucide-react";
import { 
  ResponsiveContainer, 
  BarChart, 
  XAxis, 
  YAxis, 
  Tooltip, 
  Bar, 
  Cell 
} from "recharts";
import KPICard from "@/components/dashboard/KPICard";
import { toast } from "sonner";

export default function DashboardOverview() {
  const router = useRouter();
  
  const [loading, setLoading] = useState(true);
  const [competitors, setCompetitors] = useState<any[]>([]);
  const [analyses, setAnalyses] = useState<any[]>([]);
  const [reports, setReports] = useState<any[]>([]);
  
  // Sparkline data
  const [sparklines] = useState({
    competitors: [{ value: 4 }, { value: 6 }, { value: 5 }, { value: 7 }, { value: 8 }, { value: 7 }, { value: 9 }],
    analyses: [{ value: 1 }, { value: 2 }, { value: 1 }, { value: 3 }, { value: 4 }, { value: 2 }, { value: 5 }],
    reports: [{ value: 1 }, { value: 1 }, { value: 2 }, { value: 2 }, { value: 3 }, { value: 3 }, { value: 4 }],
    insights: [{ value: 10 }, { value: 15 }, { value: 12 }, { value: 18 }, { value: 22 }, { value: 20 }, { value: 26 }],
  });

  const [activityFeed, setActivityFeed] = useState([
    { id: 1, type: "comp_added", text: "Competitor 'BaBylissPRO' was added.", time: "1 hour ago", icon: Target, color: "text-emerald-400 bg-emerald-950/40" },
    { id: 2, type: "analysis_run", text: "AI Analysis 'Apex Clipper launch' completed.", time: "2 hours ago", icon: Sparkles, color: "text-indigo-400 bg-indigo-950/40" },
    { id: 3, type: "report_saved", text: "Report 'BaBylissPRO Q2 Analysis' saved as draft.", time: "4 hours ago", icon: FileText, color: "text-amber-400 bg-amber-950/40" },
  ]);

  useEffect(() => {
    // Parallel fetch from actual API routes
    Promise.all([
      fetch("/api/competitors?limit=100").then(res => res.json()).catch(() => ({ competitors: [] })),
      fetch("/api/analyses").then(res => res.json()).catch(() => ({ analyses: [] })),
      fetch("/api/reports").then(res => res.json()).catch(() => ({ reports: [] }))
    ]).then(([compData, anData, repData]) => {
      setCompetitors(compData.competitors || []);
      setAnalyses(anData.analyses || []);
      setReports(repData.reports || []);
      setLoading(false);
    }).catch(err => {
      console.error("Dashboard fetch error:", err);
      setLoading(false);
    });
  }, []);

  if (loading) {
    return (
      <div className="space-y-6 animate-pulse">
        {/* KPI Skeleton */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map(i => (
            <div key={i} className="h-24 bg-surface-2 border border-border rounded-xl" />
          ))}
        </div>
        
        {/* Main Grid Skeleton */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <div className="lg:col-span-7 space-y-6">
            <div className="h-[250px] bg-surface-2 border border-border rounded-xl" />
            <div className="h-[280px] bg-surface-2 border border-border rounded-xl" />
          </div>
          <div className="lg:col-span-5 space-y-6">
            <div className="h-[320px] bg-surface-2 border border-border rounded-xl" />
            <div className="h-[210px] bg-surface-2 border border-border rounded-xl" />
          </div>
        </div>
      </div>
    );
  }

  // Derived dashboard variables
  const competitorsCount = competitors.length;
  const activeAnalysesCount = analyses.filter(a => a.status === "RUNNING" || a.status === "PENDING").length;
  const reportsCount = reports.length;
  const draftReportsCount = reports.filter(r => r.status === "DRAFT").length;
  
  // Threat score insights
  const highThreatCompetitors = [...competitors]
    .filter(c => c.status === "ACTIVE")
    .sort((a, b) => b.threatScore - a.threatScore);

  const top8Competitors = highThreatCompetitors.slice(0, 8).map(c => ({
    name: c.name,
    threatScore: c.threatScore,
    tier: c.tier || (c.status === "ACTIVE" ? "established" : "emerging")
  }));

  const emergingThreats = highThreatCompetitors.filter(c => c.threatScore > 65);

  const handleQuickAction = (action: string) => {
    if (action === "add") {
      router.push("/dashboard/competitors");
      // Delay to allow page transition before dispatching modal trigger
      setTimeout(() => window.dispatchEvent(new CustomEvent("trigger-add-competitor")), 150);
    } else if (action === "analyze") {
      router.push("/dashboard/analyze");
    } else if (action === "report") {
      router.push("/dashboard/reports");
    }
  };

  return (
    <div className="space-y-6">
      {/* KPI Cards Row */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <KPICard
          label="Competitors"
          value={competitorsCount}
          delta={`+${competitorsCount - 2 > 0 ? competitorsCount - 2 : 0}`}
          isPositive={true}
          sparklineData={sparklines.competitors}
          accentColor="#6366F1"
        />
        <KPICard
          label="Active Analyses"
          value={activeAnalysesCount}
          delta={activeAnalysesCount > 0 ? "Running" : "0 running"}
          isPositive={activeAnalysesCount > 0}
          sparklineData={sparklines.analyses}
          accentColor="#A5B4FC"
        />
        <KPICard
          label="Reports Generated"
          value={reportsCount}
          delta={`${draftReportsCount} draft`}
          isPositive={true}
          sparklineData={sparklines.reports}
          accentColor="#22C55E"
        />
        <KPICard
          label="AI Strategic Insights"
          value={competitorsCount * 2}
          delta={`+${competitorsCount}`}
          isPositive={true}
          sparklineData={sparklines.insights}
          accentColor="#F59E0B"
        />
      </div>

      {/* Main Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        
        {/* Left Column (7/12) */}
        <div className="lg:col-span-7 space-y-6 flex flex-col">
          
          {/* Recent Analyses Panel */}
          <div className="bg-surface-2 border border-border rounded-xl p-5 flex flex-col flex-1">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-bold text-text-primary">Recent Analyses</h2>
              <Link href="/dashboard/analyze" className="text-xs text-accent hover:underline flex items-center gap-1">
                <span>New Analysis</span>
                <Plus className="w-3.5 h-3.5" />
              </Link>
            </div>
            
            <div className="overflow-x-auto -mx-5 px-5">
              <table className="w-full text-xs text-left border-collapse">
                <thead>
                  <tr className="border-b border-border/60 text-text-muted font-bold">
                    <th className="pb-2.5">Project / Product</th>
                    <th className="pb-2.5">Status</th>
                    <th className="pb-2.5">Competitors</th>
                    <th className="pb-2.5">Date</th>
                    <th className="pb-2.5 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/40">
                  {analyses.slice(0, 5).map((an) => (
                    <tr key={an.id} className="hover:bg-surface-3/30 transition-colors">
                      <td className="py-3 font-semibold text-text-primary">
                        {an.project?.name || an.phase3Result?.executive_summary ? (
                          <div className="max-w-[200px] truncate" title={an.project?.name || "Product Analysis"}>
                            {an.project?.name || "Product Analysis"}
                          </div>
                        ) : (
                          "Competitive Deep Dive"
                        )}
                      </td>
                      <td className="py-3">
                        <span className={`inline-flex px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${
                          an.status === "COMPLETE" ? "bg-success/15 text-success" :
                          an.status === "RUNNING" ? "bg-accent-bg text-accent-text animate-pulse" :
                          an.status === "FAILED" ? "bg-danger/15 text-danger" : "bg-zinc-800 text-zinc-400"
                        }`}>
                          {an.status}
                        </span>
                      </td>
                      <td className="py-3 text-text-secondary">{an.competitors?.length || 10} found</td>
                      <td className="py-3 text-text-muted">
                        {new Date(an.createdAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                      </td>
                      <td className="py-3 text-right">
                        <button
                          onClick={() => router.push(`/dashboard/analyze?id=${an.id}`)}
                          className="px-2 py-1 rounded border border-border hover:bg-surface-3 hover:text-text-primary text-[10px] transition-colors"
                        >
                          View
                        </button>
                      </td>
                    </tr>
                  ))}
                  {analyses.length === 0 && (
                    <tr>
                      <td colSpan={5} className="py-8 text-center text-text-muted">
                        No analyses completed yet.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Top Competitors by Threat Score Chart */}
          <div className="bg-surface-2 border border-border rounded-xl p-5">
            <h2 className="text-sm font-bold text-text-primary mb-4">Top Competitors by Threat Score</h2>
            <div className="h-[250px] w-full text-xs">
              {top8Competitors.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={top8Competitors}
                    layout="vertical"
                    margin={{ top: 5, right: 30, left: 10, bottom: 5 }}
                  >
                    <XAxis type="number" domain={[0, 100]} stroke="#52525B" fontSize={10} />
                    <YAxis dataKey="name" type="category" stroke="#52525B" fontSize={10} width={90} />
                    <Tooltip
                      contentStyle={{ backgroundColor: "#16161A", borderColor: "rgba(255,255,255,0.08)", color: "#F4F4F5" }}
                      itemStyle={{ color: "#A5B4FC" }}
                    />
                    <Bar dataKey="threatScore" radius={[0, 4, 4, 0]}>
                      {top8Competitors.map((entry, index) => (
                        <Cell 
                          key={`cell-${index}`} 
                          fill={entry.tier === "established" ? "#6366F1" : "#A5B4FC"} 
                        />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <div className="flex flex-col items-center justify-center h-full text-text-muted">
                  <TrendingUp className="w-8 h-8 opacity-40 mb-2" />
                  <p>No competitor data available for plotting.</p>
                </div>
              )}
            </div>
          </div>
          
        </div>

        {/* Right Column (5/12) */}
        <div className="lg:col-span-5 space-y-6 flex flex-col">
          
          {/* Quick Actions Panel */}
          <div className="bg-surface-2 border border-border rounded-xl p-5">
            <h2 className="text-sm font-bold text-text-primary mb-4">Quick Actions</h2>
            <div className="grid grid-cols-1 gap-2.5">
              <button
                onClick={() => handleQuickAction("add")}
                className="flex items-center justify-between p-3.5 rounded-xl border border-border bg-surface-3/50 hover:bg-surface-3 transition-colors text-left"
              >
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-emerald-950/60 border border-emerald-900/60 text-emerald-400">
                    <Plus className="w-4 h-4" />
                  </div>
                  <div>
                    <p className="text-xs font-semibold text-text-primary">Add Competitor</p>
                    <p className="text-[10px] text-text-muted">Track a new brand or product</p>
                  </div>
                </div>
                <ArrowRight className="w-4 h-4 text-text-muted" />
              </button>
              
              <button
                onClick={() => handleQuickAction("analyze")}
                className="flex items-center justify-between p-3.5 rounded-xl border border-border bg-surface-3/50 hover:bg-surface-3 transition-colors text-left"
              >
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-indigo-950/60 border border-indigo-900/60 text-indigo-400">
                    <Play className="w-4 h-4" />
                  </div>
                  <div>
                    <p className="text-xs font-semibold text-text-primary">Run AI Analysis</p>
                    <p className="text-[10px] text-text-muted">Scan the market using Claude</p>
                  </div>
                </div>
                <ArrowRight className="w-4 h-4 text-text-muted" />
              </button>
              
              <button
                onClick={() => handleQuickAction("report")}
                className="flex items-center justify-between p-3.5 rounded-xl border border-border bg-surface-3/50 hover:bg-surface-3 transition-colors text-left"
              >
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-amber-950/60 border border-amber-900/60 text-amber-400">
                    <Download className="w-4 h-4" />
                  </div>
                  <div>
                    <p className="text-xs font-semibold text-text-primary">View Reports</p>
                    <p className="text-[10px] text-text-muted">Open and export generated reports</p>
                  </div>
                </div>
                <ArrowRight className="w-4 h-4 text-text-muted" />
              </button>
            </div>
          </div>

          {/* Activity Feed Panel */}
          <div className="bg-surface-2 border border-border rounded-xl p-5 flex flex-col flex-1">
            <h2 className="text-sm font-bold text-text-primary mb-4">Activity Feed</h2>
            <div className="space-y-4 flex-1 overflow-y-auto max-h-[300px] pr-1">
              {activityFeed.map((act) => {
                const Icon = act.icon;
                return (
                  <div key={act.id} className="flex gap-3 text-xs leading-normal">
                    <div className={`p-2 rounded-lg shrink-0 w-8 h-8 flex items-center justify-center ${act.color}`}>
                      <Icon className="w-4 h-4" />
                    </div>
                    <div className="space-y-0.5 min-w-0">
                      <p className="text-text-primary font-medium">{act.text}</p>
                      <p className="text-[10px] text-text-muted">{act.time}</p>
                    </div>
                  </div>
                );
              })}
              {activityFeed.length === 0 && (
                <p className="p-4 text-center text-text-muted">No recent activities</p>
              )}
            </div>
          </div>
          
        </div>
      </div>

      {/* Full Width: Emerging Threats Table */}
      <div className="bg-surface-2 border border-border rounded-xl p-5">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-bold text-text-primary">Emerging Market Threats</h2>
            <span className="bg-danger-bg border border-danger/20 text-danger text-[10px] font-bold px-1.5 py-0.5 rounded-full">
              Score &gt; 65
            </span>
          </div>
          <Link href="/dashboard/competitors" className="text-xs text-text-muted hover:text-text-primary flex items-center gap-1 transition-colors">
            <span>View All Competitors</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </Link>
        </div>
        
        <div className="overflow-x-auto -mx-5 px-5">
          <table className="w-full text-xs text-left border-collapse">
            <thead>
              <tr className="border-b border-border/60 text-text-muted font-bold">
                <th className="pb-2.5">Logo</th>
                <th className="pb-2.5">Name</th>
                <th className="pb-2.5">Status</th>
                <th className="pb-2.5">Threat Score</th>
                <th className="pb-2.5">Tags</th>
                <th className="pb-2.5 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/40">
              {emergingThreats.slice(0, 4).map((c) => (
                <tr key={c.id} className="hover:bg-surface-3/30 transition-colors">
                  <td className="py-3">
                    <img
                      src={c.logoUrl || `https://images.unsplash.com/photo-1522335789203-aabd1fc54bc9?auto=format&fit=crop&w=40&h=40`}
                      alt={c.name}
                      onError={(e) => {
                        (e.target as HTMLImageElement).src = `https://ui-avatars.com/api/?name=${c.name}&background=1C1C22&color=6366F1`;
                      }}
                      className="w-6 h-6 rounded object-cover border border-border bg-surface-3"
                    />
                  </td>
                  <td className="py-3 font-semibold text-text-primary">
                    <div>{c.name}</div>
                    {c.website && <span className="text-[10px] text-text-muted font-normal block">{c.website}</span>}
                  </td>
                  <td className="py-3">
                    <span className="inline-flex items-center gap-1.5 px-2 py-0.5 text-[10px] font-semibold rounded bg-success-bg border border-success/20 text-success">
                      <span className="w-1.5 h-1.5 rounded-full bg-success" />
                      Active
                    </span>
                  </td>
                  <td className="py-3">
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
                  <td className="py-3">
                    <div className="flex flex-wrap gap-1">
                      {c.tags.slice(0, 2).map((t: string) => (
                        <span key={t} className="px-1.5 py-0.5 rounded bg-surface-3 border border-border text-[9px] text-text-secondary">
                          {t}
                        </span>
                      ))}
                      {c.tags.length > 2 && (
                        <span className="px-1 py-0.5 text-[8px] text-text-muted">+{c.tags.length - 2}</span>
                      )}
                    </div>
                  </td>
                  <td className="py-3 text-right">
                    <button
                      onClick={() => router.push(`/dashboard/competitors/${c.id}`)}
                      className="px-2.5 py-1 rounded border border-border hover:bg-surface-3 hover:text-text-primary text-[10px] font-semibold transition-colors"
                    >
                      View details
                    </button>
                  </td>
                </tr>
              ))}
              {emergingThreats.length === 0 && (
                <tr>
                  <td colSpan={6} className="py-8 text-center text-text-muted">
                    No active competitors with high threat scores found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
