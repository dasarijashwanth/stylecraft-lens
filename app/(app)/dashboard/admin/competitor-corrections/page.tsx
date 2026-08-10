"use client";

import { useEffect, useState } from "react";
import { Undo2, ShieldAlert } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/hooks/useAuth";
import { Spinner } from "@/components/ui/Spinner";

interface Correction {
  id: string;
  analysis_id: string | null;
  project_id: string | null;
  tool_type: string;
  motor_family: string | null;
  heat_tech_family: string | null;
  price_band: string | null;
  old_asin: string;
  old_title: string | null;
  new_asin: string;
  new_title: string | null;
  reason: string;
  note: string | null;
  user_id: string | null;
  expired_at: string | null;
  created_at: string;
}

const REASON_LABELS: Record<string, string> = {
  wrong_product: "Wrong product entirely",
  wrong_model: "Wrong model — right brand",
  wrong_motor: "Wrong motor/plate-heat type",
  better_competitor: "Better competitor",
  discontinued: "Discontinued / unavailable",
  other: "Other",
};

// Same counting rule as lib/analysisEngine.ts's buildCorrectionSignals —
// mirrored here purely for DISPLAY (what effect a correction currently
// has), never fed back into scoring itself. Security-audit fix: "2+
// INDEPENDENT corrections" means 2+ DISTINCT users, not 2+ raw rows (a
// single account submitting two corrections against the same ASIN no
// longer hard-blocks it) — this display must count the same way the real
// engine does, or it misleads an admin about what's actually happening.
function computeEffect(all: Correction[], c: Correction): string {
  if (c.expired_at) return "No current effect (expired)";
  if (c.reason === "wrong_product" || c.reason === "discontinued") {
    const distinctUsers = new Set(
      all
        .filter(x => !x.expired_at && (x.reason === "wrong_product" || x.reason === "discontinued") && x.old_asin === c.old_asin)
        .map(x => x.user_id || `anon:${x.id}`)
    );
    return distinctUsers.size >= 2 ? "Blocked" : "Penalized";
  }
  if (c.reason === "better_competitor") return "Preferred";
  return "No current effect";
}

export default function CompetitorCorrectionsAdminPage() {
  const { user, loading: authLoading } = useAuth();
  const [corrections, setCorrections] = useState<Correction[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/competitor-corrections");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to load competitor corrections");
      setCorrections(data.corrections || []);
    } catch (err: any) {
      setError(err.message || "Failed to load competitor corrections");
    } finally {
      setLoading(false);
    }
  }

  // Security audit fix (Low, consistency) — gate on the resolved role like
  // every other admin page does, instead of firing unconditionally on
  // mount. The server route already independently enforces requireAdmin
  // (a non-admin's fetch always 403'd, so this was never a real data leak)
  // — this just aligns the client with the rest of the admin dashboard for
  // defense-in-depth consistency.
  useEffect(() => {
    if (user && (user.role === "OWNER" || user.role === "ADMIN")) load();
  }, [user]);

  async function handleToggle(id: string, action: "expire" | "reactivate") {
    setBusyId(id);
    try {
      const res = await fetch(`/api/admin/competitor-corrections/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to update correction");
      toast.success(action === "expire" ? "Correction expired — no longer affects future analyses" : "Correction reactivated");
      await load();
    } catch (err: any) {
      toast.error(err.message || "Failed to update correction");
    } finally {
      setBusyId(null);
    }
  }

  if (authLoading) {
    return (
      <div className="flex items-center justify-center min-h-[300px]">
        <Spinner size="lg" className="text-accent" />
      </div>
    );
  }

  if (!user || (user.role !== "OWNER" && user.role !== "ADMIN")) {
    return (
      <div className="max-w-md mx-auto mt-16 text-center space-y-3">
        <ShieldAlert className="w-8 h-8 mx-auto text-text-muted" />
        <h1 className="text-sm font-bold text-text-primary">Not authorized</h1>
        <p className="text-xs text-text-muted">This page is restricted to workspace owners/admins.</p>
      </div>
    );
  }

  const grouped = corrections.reduce<Record<string, Correction[]>>((acc, c) => {
    (acc[c.tool_type] ||= []).push(c);
    return acc;
  }, {});

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <Undo2 className="w-5 h-5 text-accent" />
        <h1 className="text-display">Competitor Corrections</h1>
      </div>
      <p className="text-xs text-text-muted -mt-4">
        Every manual ASIN swap (from an analysis&apos;s competitor cards) and why. Two or more independent
        &quot;Wrong product&quot;/&quot;Discontinued&quot; reports against the same ASIN block it from future analyses for
        that tool type; a single report deprioritizes it instead. &quot;Better competitor&quot; picks get seeded early into
        future discovery. Expiring a correction turns its effect off without deleting the record.
      </p>

      {loading ? (
        <div className="p-8 text-center text-text-muted text-xs">Loading…</div>
      ) : error ? (
        <div className="p-8 text-center text-danger text-xs">{error}</div>
      ) : corrections.length === 0 ? (
        <div className="p-8 text-center text-text-muted text-xs border border-border rounded-xl">
          No competitor corrections recorded yet.
        </div>
      ) : (
        Object.entries(grouped).map(([toolType, group]) => (
          <div key={toolType} className="border border-border rounded-xl overflow-hidden">
            <div className="px-4 py-2.5 bg-surface-3/40 border-b border-border">
              <span className="text-xs font-bold text-text-primary">{toolType}</span>
              <span className="text-[10px] text-text-muted ml-2">{group.length} correction{group.length === 1 ? "" : "s"}</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-[11px]">
                <thead>
                  <tr className="border-b border-border/60 bg-surface-3/20 text-text-muted uppercase text-[9px] font-bold">
                    <th className="p-2.5">Date</th>
                    <th className="p-2.5">Replaced</th>
                    <th className="p-2.5">Reason</th>
                    <th className="p-2.5">Note</th>
                    <th className="p-2.5">Effect</th>
                    <th className="p-2.5"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/40">
                  {group.map(c => {
                    const effect = computeEffect(corrections, c);
                    return (
                      <tr key={c.id} className={c.expired_at ? "opacity-50" : ""}>
                        <td className="p-2.5 text-text-muted whitespace-nowrap">{new Date(c.created_at).toLocaleDateString()}</td>
                        <td className="p-2.5">
                          <div className="line-through text-text-muted">{c.old_title || c.old_asin}</div>
                          <div className="text-text-primary font-semibold">{c.new_title || c.new_asin}</div>
                        </td>
                        <td className="p-2.5 text-text-secondary">{REASON_LABELS[c.reason] || c.reason}</td>
                        <td className="p-2.5 text-text-muted max-w-[200px] truncate" title={c.note || undefined}>{c.note || "—"}</td>
                        <td className="p-2.5">
                          <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider ${
                            effect === "Blocked" ? "bg-danger-bg border border-danger/20 text-danger"
                            : effect === "Penalized" ? "bg-warning/10 border border-warning/25 text-warning"
                            : effect === "Preferred" ? "bg-success/10 border border-success/25 text-success"
                            : "bg-surface-3/40 border border-border text-text-muted"
                          }`}>
                            {effect}
                          </span>
                        </td>
                        <td className="p-2.5 text-right">
                          <button
                            type="button"
                            onClick={() => handleToggle(c.id, c.expired_at ? "reactivate" : "expire")}
                            disabled={busyId === c.id}
                            className="text-[10px] font-semibold text-accent hover:underline disabled:opacity-50"
                          >
                            {busyId === c.id ? "…" : c.expired_at ? "Reactivate" : "Expire"}
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        ))
      )}
    </div>
  );
}
