"use client";

import { useState, useEffect, useRef } from "react";
import { Upload, Palette, Sparkles, Image as ImageIcon, CheckCircle2, Loader2, FileText } from "lucide-react";
import { toast } from "sonner";

export function ArtworkTab({ projectId }: { projectId: string }) {
  const [artworks, setArtworks] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [activeSuggestions, setActiveSuggestions] = useState<any>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const fetchArtwork = async () => {
    try {
      const res = await fetch(`/api/projects/${projectId}/artwork`);
      const data = await res.json();
      const list = data.artwork || [];
      setArtworks(list);
      if (list.length > 0 && list[0].ai_suggestions) {
        setActiveSuggestions(list[0].ai_suggestions || list[0].aiSuggestions);
      }
    } catch (e) {
      console.error("Failed to load artwork:", e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (projectId) fetchArtwork();
  }, [projectId]);

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("purpose", "family_artwork");

      const res = await fetch(`/api/projects/${projectId}/artwork`, {
        method: "POST",
        body: form,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Upload failed");

      toast.success("Artwork uploaded and analyzed by Gemini Vision!");
      if (data.suggestions) setActiveSuggestions(data.suggestions);
      fetchArtwork();
    } catch (err: any) {
      toast.error(err.message || "Failed to upload artwork");
    } finally {
      setUploading(false);
    }
  }

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-12">
        <Loader2 className="w-6 h-6 text-accent animate-spin mb-2" />
        <p className="text-xs text-text-muted">Loading brand artwork canvas...</p>
      </div>
    );
  }

  return (
    <div className="space-y-6 text-xs">
      <div className="flex flex-col gap-1">
        <h3 className="text-sm font-bold text-text-primary flex items-center gap-2">
          <Palette className="w-4 h-4 text-accent" />
          <span>Brand Family Artwork & AI Concept Suggestions</span>
        </h3>
        <p className="text-text-muted leading-relaxed">
          Upload product or packaging artwork. Gemini Vision extracts brand color palettes, verifies design guidelines, and generates rough artwork concepts for consistent brand family expansion.
        </p>
      </div>

      {/* Upload Zone */}
      <div
        onClick={() => fileInputRef.current?.click()}
        className="border-2 border-dashed border-border hover:border-accent/60 bg-surface-3/20 hover:bg-surface-3/40 rounded-xl p-8 text-center cursor-pointer transition-all flex flex-col items-center justify-center gap-3 relative overflow-hidden group"
      >
        <input
          ref={fileInputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp,image/svg+xml"
          onChange={handleUpload}
          className="hidden"
        />
        {uploading ? (
          <div className="flex flex-col items-center justify-center py-2 space-y-2">
            <Loader2 className="w-8 h-8 text-accent animate-spin" />
            <p className="font-semibold text-text-primary">Gemini Vision is analyzing color palettes and brand style…</p>
          </div>
        ) : (
          <>
            <div className="w-12 h-12 rounded-xl bg-accent/10 border border-accent/20 flex items-center justify-center text-accent group-hover:scale-110 transition-transform">
              <Upload className="w-6 h-6" />
            </div>
            <div>
              <p className="font-bold text-text-primary text-xs">Drop brand family artwork here or click to upload</p>
              <p className="text-[10px] text-text-muted mt-1">JPEG, PNG, WebP, SVG • Up to 10MB</p>
            </div>
          </>
        )}
      </div>

      {/* Uploaded Artwork Gallery */}
      {artworks.length > 0 && (
        <div className="space-y-3 pt-2">
          <h4 className="text-[10px] font-bold text-text-muted uppercase tracking-wider">Uploaded Brand Assets</h4>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {artworks.map((art: any, i: number) => (
              <div
                key={art.id || i}
                onClick={() => setActiveSuggestions(art.ai_suggestions || art.aiSuggestions)}
                className={`p-2 bg-surface-1 border rounded-lg cursor-pointer transition-all ${
                  (art.ai_suggestions || art.aiSuggestions) === activeSuggestions
                    ? "border-accent ring-1 ring-accent"
                    : "border-border hover:border-border-strong"
                }`}
              >
                <div className="aspect-video w-full rounded bg-surface-3 flex items-center justify-center overflow-hidden mb-2">
                  {art.file_url || art.fileUrl ? (
                    <img src={art.file_url || art.fileUrl} alt="Artwork" className="object-cover w-full h-full" />
                  ) : (
                    <ImageIcon className="w-6 h-6 text-text-muted" />
                  )}
                </div>
                <p className="text-[10px] font-semibold text-text-primary truncate">{art.file_name || art.fileName || "Artwork Asset"}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* AI Suggestions Panel */}
      {activeSuggestions && (
        <div className="space-y-5 pt-4 border-t border-border/60">
          {/* Color Palette */}
          {activeSuggestions.style_analysis?.color_palette && (
            <div className="p-4 bg-surface-3/30 border border-border rounded-xl space-y-3">
              <h4 className="text-[10px] font-bold text-text-muted uppercase tracking-wider flex items-center gap-1.5">
                <Sparkles className="w-3.5 h-3.5 text-accent" />
                <span>Extracted Brand Color Palette</span>
              </h4>
              <div className="flex flex-wrap items-center gap-3">
                {activeSuggestions.style_analysis.color_palette.map((hex: string, idx: number) => (
                  <div key={idx} className="flex items-center gap-2 px-2.5 py-1.5 bg-surface-1 border border-border rounded-lg shadow-sm">
                    <div className="w-5 h-5 rounded border border-black/20 shadow-inner" style={{ backgroundColor: hex }} />
                    <span className="font-mono text-[11px] font-bold text-text-primary">{hex}</span>
                  </div>
                ))}
              </div>
              <p className="text-[11px] text-text-secondary leading-relaxed">{activeSuggestions.style_analysis.color_description}</p>
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Design Style */}
            {activeSuggestions.style_analysis?.design_style && (
              <div className="p-4 bg-surface-3/20 border border-border rounded-xl space-y-1.5">
                <span className="text-[10px] font-bold text-text-muted uppercase tracking-wider">Identified Design Aesthetic</span>
                <p className="text-sm font-bold text-text-primary">{activeSuggestions.style_analysis.design_style}</p>
                {activeSuggestions.style_analysis.typography_notes && (
                  <p className="text-[10px] text-text-muted">{activeSuggestions.style_analysis.typography_notes}</p>
                )}
              </div>
            )}

            {/* Consistency Guidelines */}
            {activeSuggestions.consistency_guidelines && (
              <div className="p-4 bg-surface-3/20 border border-border rounded-xl space-y-2">
                <span className="text-[10px] font-bold text-text-muted uppercase tracking-wider">Brand Consistency Guidelines</span>
                <ul className="space-y-1.5">
                  {activeSuggestions.consistency_guidelines.map((g: string, i: number) => (
                    <li key={i} className="flex gap-2 text-[11px] text-text-secondary">
                      <CheckCircle2 className="w-3.5 h-3.5 text-accent flex-shrink-0 mt-0.5" />
                      <span>{g}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>

          {/* Rough Artwork Suggestions */}
          {activeSuggestions.rough_artwork_suggestions && (
            <div className="space-y-3">
              <h4 className="text-[10px] font-bold text-text-muted uppercase tracking-wider">Rough Artwork Concept Suggestions</h4>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {activeSuggestions.rough_artwork_suggestions.map((c: any, i: number) => (
                  <div key={i} className="p-4 bg-surface-1 border border-border/80 rounded-xl space-y-2 shadow-sm hover:border-accent/40 transition-colors">
                    <div className="flex items-center justify-between">
                      <h5 className="font-bold text-text-primary text-xs">{c.concept}</h5>
                      <span className="px-2 py-0.5 rounded text-[9px] font-bold bg-accent/10 border border-accent/20 text-accent uppercase tracking-wider">
                        {c.use_case}
                      </span>
                    </div>
                    <p className="text-[11px] text-text-secondary leading-relaxed">{c.description}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Amazon Listing Notes */}
          {activeSuggestions.amazon_listing_notes && (
            <div className="p-4 bg-amber-500/10 border border-amber-500/20 text-amber-950 dark:text-amber-200 rounded-xl space-y-1">
              <span className="text-[10px] font-bold uppercase tracking-wider block text-amber-600 dark:text-amber-400">Amazon Marketplace Artwork Notes</span>
              <p className="text-[11px] leading-relaxed">{activeSuggestions.amazon_listing_notes}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
