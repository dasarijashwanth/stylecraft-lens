"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { ShieldAlert, ArrowLeft, Save, Loader2, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/hooks/useAuth";
import { Badge } from "@/components/ui/Badge";
import { Spinner } from "@/components/ui/Spinner";
import type { DeckTemplateRow } from "@/lib/db/deck-templates";
import type { DeckTokenMapping } from "@/lib/deck-types";
import { GTM_FIELD_SCHEMA } from "@/lib/gtm-field-schema";

// A template's placeholder_map is built once at upload/parse time
// (lib/deck-field-registry.ts's buildDefaultPlaceholderMap) against
// whatever GTM_FIELD_SCHEMA looked like then — a later schema change that
// renames a field's ID (not just its question text) or removes one
// outright leaves that token's `gtm_field` mapping silently resolving to ""
// at render time (lib/deck-data-mapper.ts's resolveTokenValue does a plain
// Map.get with zero validation). This is the only place that re-checks a
// stored mapping against the CURRENT schema.
const VALID_GTM_FIELD_IDS = new Set(GTM_FIELD_SCHEMA.map(f => f.id));

function isRemovedFieldMapping(source: DeckTokenMapping["source"]): boolean {
  return source.type === "gtm_field" && !VALID_GTM_FIELD_IDS.has(source.field_id);
}

function sourceSummary(source: DeckTokenMapping["source"]): string {
  switch (source.type) {
    case "gtm_field":
      return `GTM field: ${source.field_id}${source.split ? ` (part ${(source.split_index ?? 0) + 1})` : ""}`;
    case "report_field":
      return `Report field: ${source.path}`;
    case "project_field":
      return `Project field: ${source.field}`;
    case "snapshot_image":
      return `Product snapshot image (${source.slot})`;
    case "computed":
      return `Computed: ${source.name}`;
    case "static":
      return `Static text: "${source.value}"`;
    case "unmapped":
    default:
      return "Unmapped — needs a source";
  }
}

export default function DeckTemplateMappingPage() {
  const { user, loading: authLoading } = useAuth();
  const params = useParams();
  const router = useRouter();
  const id = params.id as string;

  const [template, setTemplate] = useState<DeckTemplateRow | null>(null);
  const [tokens, setTokens] = useState<DeckTokenMapping[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/deck-templates/${id}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to load template");
      setTemplate(data.template);
      setTokens(data.template?.placeholder_map?.tokens || []);
    } catch (err: any) {
      setError(err.message || "Failed to load template");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (user && (user.role === "OWNER" || user.role === "ADMIN") && id) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, id]);

  function updateToken(index: number, patch: Partial<DeckTokenMapping>) {
    setTokens(prev => prev.map((t, i) => (i === index ? { ...t, ...patch } : t)));
  }

  function markStatic(index: number, value: string) {
    updateToken(index, { source: { type: "static", value } });
  }

  async function handleSave() {
    if (!template) return;
    setSaving(true);
    try {
      const unmapped_tokens = tokens.filter(t => t.source.type === "unmapped").map(t => t.token);
      const placeholder_map = { ...template.placeholder_map, tokens, unmapped_tokens };
      const res = await fetch(`/api/admin/deck-templates/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ placeholder_map }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to save mapping");
      toast.success("Mapping saved");
      setTemplate(data.template);
    } catch (err: any) {
      toast.error(err.message || "Failed to save mapping");
    } finally {
      setSaving(false);
    }
  }

  if (authLoading || loading) {
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

  if (error || !template) {
    return (
      <div className="max-w-md mx-auto mt-16 text-center space-y-3">
        <AlertTriangle className="w-8 h-8 mx-auto text-danger" />
        <p className="text-xs text-danger">{error || "Template not found"}</p>
      </div>
    );
  }

  const unmappedCount = tokens.filter(t => t.source.type === "unmapped").length;
  const removedFieldCount = tokens.filter(t => isRemovedFieldMapping(t.source)).length;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => router.push("/dashboard/admin/deck-templates")} className="p-1.5 rounded-lg hover:bg-surface-3 text-text-secondary transition-colors">
            <ArrowLeft className="w-4 h-4" />
          </button>
          <h1 className="text-display">{template.name}</h1>
          {template.is_active && <Badge tone="success" uppercase>Active</Badge>}
        </div>
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-accent hover:bg-accent-hover text-white text-[11px] font-bold rounded-lg transition-colors disabled:opacity-50"
        >
          {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
          <span>Save mapping</span>
        </button>
      </div>

      <p className="text-xs text-text-muted -mt-4">
        {template.slide_count} slide{template.slide_count === 1 ? "" : "s"} · {tokens.length} token{tokens.length === 1 ? "" : "s"} found
        {unmappedCount > 0 ? <span className="text-warning font-semibold"> · {unmappedCount} unmapped — resolve below before activating</span> : " · all tokens mapped"}
        {removedFieldCount > 0 && (
          <span className="text-danger font-semibold"> · {removedFieldCount} mapped to a field removed from the current schema — resolve below</span>
        )}
      </p>

      <div className="border border-border rounded-xl overflow-hidden">
        <div className="grid grid-cols-[160px_70px_80px_1fr_90px] gap-3 px-4 py-2.5 bg-surface-3/30 border-b border-border text-[10px] font-bold text-text-muted uppercase tracking-wider">
          <span>Token</span>
          <span>Kind</span>
          <span>Slide(s)</span>
          <span>Source</span>
          <span>Max length</span>
        </div>
        <div className="divide-y divide-border/60">
          {tokens.map((t, i) => {
            const isUnmapped = t.source.type === "unmapped";
            const isRemoved = isRemovedFieldMapping(t.source);
            const slideList = Array.from(new Set(t.occurrences.map(o => o.slide_index))).sort((a, b) => a - b).join(", ");
            return (
              <div key={t.token} className={`grid grid-cols-[160px_70px_80px_1fr_90px] gap-3 px-4 py-3 items-center text-xs ${isUnmapped ? "bg-warning/5" : isRemoved ? "bg-danger/5" : ""}`}>
                <code className="font-mono text-[11px] text-text-primary truncate" title={t.token}>{`{{${t.token}}}`}</code>
                <span className="text-text-secondary">{t.kind}</span>
                <span className="text-text-muted font-mono text-[11px]">{slideList}</span>
                {isRemoved ? (
                  <div className="flex items-center gap-2">
                    <AlertTriangle className="w-3.5 h-3.5 text-danger shrink-0" />
                    <input
                      type="text"
                      placeholder={`"${(t.source as any).field_id}" no longer exists — set a static fallback…`}
                      className="flex-1 px-2 py-1 text-[11px] border border-danger/30 rounded bg-surface-1 text-text-primary outline-none focus:border-danger"
                      onBlur={e => { if (e.target.value.trim()) markStatic(i, e.target.value.trim()); }}
                    />
                  </div>
                ) : isUnmapped ? (
                  <div className="flex items-center gap-2">
                    <AlertTriangle className="w-3.5 h-3.5 text-warning shrink-0" />
                    <input
                      type="text"
                      placeholder="Set a static fallback value…"
                      className="flex-1 px-2 py-1 text-[11px] border border-warning/30 rounded bg-surface-1 text-text-primary outline-none focus:border-warning"
                      onBlur={e => { if (e.target.value.trim()) markStatic(i, e.target.value.trim()); }}
                    />
                  </div>
                ) : (
                  <span className="text-text-secondary truncate" title={sourceSummary(t.source)}>{sourceSummary(t.source)}</span>
                )}
                <input
                  type="number"
                  min={0}
                  value={t.max_length ?? ""}
                  placeholder="—"
                  disabled={t.kind !== "text"}
                  onChange={e => updateToken(i, { max_length: e.target.value ? Number(e.target.value) : undefined })}
                  className="w-full px-2 py-1 text-[11px] border border-border rounded bg-surface-1 text-text-primary outline-none focus:border-accent disabled:opacity-40"
                />
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
