// components/competitors/AddCompetitorModal.tsx
"use client";

import { useState, useEffect } from "react";
import { X, Loader2, Plus } from "lucide-react";
import { toast } from "sonner";
import { normalizeUrl } from "@/lib/validations";
import { useAuth } from "@/hooks/useAuth";

interface AddCompetitorModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

export default function AddCompetitorModal({ isOpen, onClose, onSuccess }: AddCompetitorModalProps) {
  const { user } = useAuth();
  const [name, setName] = useState("");
  const [website, setWebsite] = useState("");
  const [description, setDescription] = useState("");
  const [status, setStatus] = useState<"ACTIVE" | "MONITORING" | "ARCHIVED">("ACTIVE");
  const [tagInput, setTagInput] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  
  // Favicon preview state
  const [faviconUrl, setFaviconUrl] = useState<string | null>(null);
  
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState<{ [key: string]: string }>({});

  useEffect(() => {
    if (isOpen) {
      // Reset form fields
      setName("");
      setWebsite("");
      setDescription("");
      setStatus("ACTIVE");
      setTagInput("");
      setTags([]);
      setFaviconUrl(null);
      setErrors({});
    }
  }, [isOpen]);

  // Website blur listener for favicon fetch
  const handleWebsiteBlur = () => {
    if (!website) {
      setFaviconUrl(null);
      return;
    }
    
    const normalized = normalizeUrl(website);
    if (!normalized) {
      setFaviconUrl(null);
      setErrors(prev => ({
        ...prev,
        website: "Please enter a valid URL (e.g., wahlpro.com or https://wahlpro.com)"
      }));
    } else {
      setWebsite(normalized);
      try {
        const domain = new URL(normalized).hostname;
        setFaviconUrl(`https://www.google.com/s2/favicons?sz=64&domain=${domain}`);
      } catch (e) {
        setFaviconUrl(null);
      }
      setErrors(prev => {
        const next = { ...prev };
        delete next.website;
        return next;
      });
    }
  };

  // Add tag handler
  const addTag = () => {
    const cleanTag = tagInput.trim().toLowerCase();
    if (!cleanTag) return;
    
    if (tags.length >= 10) {
      toast.error("Maximum 10 tags reached — remove one to add another");
      return;
    }

    if (cleanTag.length > 30) {
      setErrors(prev => ({
        ...prev,
        tags: "Tag must be 30 characters or less"
      }));
      return;
    }
    
    if (!tags.includes(cleanTag)) {
      setTags([...tags, cleanTag]);
    }
    
    setTagInput("");
    setErrors(prev => {
      const next = { ...prev };
      delete next.tags;
      return next;
    });
  };

  // Listen for special keystrokes on tag input
  const handleTagKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" || e.key === "," || e.key === " ") {
      e.preventDefault();
      addTag();
    }
  };

  const removeTag = (tagToRemove: string) => {
    setTags(tags.filter(t => t !== tagToRemove));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrors({});

    if (!name.trim()) {
      setErrors(prev => ({ ...prev, name: "Company name is required" }));
      return;
    }

    const normalizedWebsite = website ? normalizeUrl(website) : null;
    if (website && !normalizedWebsite) {
      setErrors(prev => ({ ...prev, website: "Enter a valid URL (e.g. wahlpro.com)" }));
      return;
    }
    
    setLoading(true);
    try {
      const response = await fetch("/api/competitors", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          website: normalizedWebsite,
          description: description.trim(),
          status,
          tags
        })
      });
      
      const data = await response.json();
      
      if (!response.ok) {
        throw new Error(data.message || "Failed to add competitor");
      }
      
      toast.success("Competitor added");
      onSuccess();
      onClose();
    } catch (err: any) {
      toast.error(err.message || "Failed to add competitor. Try again.");
      setErrors(prev => ({ ...prev, api: err.message || "Failed to save competitor" }));
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  // Character counter helper color mapping
  const charCount = description.length;
  const charCounterColor = 
    charCount >= 500 ? "text-danger" : 
    charCount >= 450 ? "text-warning" : 
    "text-text-muted";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-end">
      {/* Black backdrop overlay */}
      <div 
        className="fixed inset-0 bg-black/60 backdrop-blur-sm transition-opacity duration-300"
        onClick={onClose}
      />

      {/* Slide-over Drawer (480px wide) */}
      <div className="relative w-full max-w-md h-screen bg-surface-2 border-l border-border flex flex-col z-10 shadow-2xl animate-slide-in">
        
        {/* Drawer Header */}
        <div className="flex items-center justify-between p-4 md:p-6 border-b border-border bg-surface-3/30">
          <div>
            <h2 className="text-base font-bold text-text-primary">Add competitor</h2>
            <p className="text-[11px] text-text-muted mt-1 leading-normal">
              Add a brand or product to track in your competitive landscape.
            </p>
          </div>
          <button 
            onClick={onClose}
            className="p-1 rounded-lg hover:bg-surface-3 text-text-secondary transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Drawer Form Body */}
        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-4 md:p-6 space-y-5">
          
          {errors.api && (
            <div className="p-3 text-xs border border-danger/20 rounded-lg bg-danger-bg text-danger">
              {errors.api}
            </div>
          )}

          {/* Company Name */}
          <div className="space-y-1.5">
            <label htmlFor="comp-name" className="text-xs font-semibold text-text-primary block">
              Company name <span className="text-danger">*</span>
            </label>
            <input
              id="comp-name"
              type="text"
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                if (errors.name) setErrors(prev => { const n = { ...prev }; delete n.name; return n; });
              }}
              placeholder="e.g. Wahl Professional, BaBylissPRO"
              className={`w-full px-3 py-2 text-xs border rounded-lg bg-surface-1 outline-none text-text-primary placeholder-text-muted transition-all focus:border-accent ${
                errors.name ? "border-danger focus:border-danger" : "border-border"
              }`}
            />
            {errors.name && <p className="text-[10px] text-danger mt-1">{errors.name}</p>}
          </div>

          {/* Website URL */}
          <div className="space-y-1.5">
            <label htmlFor="comp-url" className="text-xs font-semibold text-text-primary block">
              Website URL
            </label>
            <div className="relative flex items-center">
              <input
                id="comp-url"
                type="text"
                value={website}
                onChange={(e) => setWebsite(e.target.value)}
                onBlur={handleWebsiteBlur}
                placeholder="https://example.com"
                className={`w-full pl-3 pr-9 py-2 text-xs border rounded-lg bg-surface-1 outline-none text-text-primary placeholder-text-muted transition-all focus:border-accent ${
                  errors.website ? "border-danger focus:border-danger" : "border-border"
                }`}
              />
              {/* Favicon mini preview inline */}
              {faviconUrl && (
                <div className="absolute right-2.5 flex items-center justify-center w-5 h-5 bg-surface-2 rounded border border-border">
                  <img src={faviconUrl} alt="Favicon" className="w-3 h-3 object-contain" />
                </div>
              )}
            </div>
            {errors.website && <p className="text-[10px] text-danger mt-1">{errors.website}</p>}
            {website && normalizeUrl(website) && (
              <p className="text-[10px] text-text-muted mt-1 font-mono">Normalized URL: {normalizeUrl(website)}</p>
            )}
          </div>

          {/* Description */}
          <div className="space-y-1.5">
            <div className="flex justify-between items-center">
              <label htmlFor="comp-desc" className="text-xs font-semibold text-text-primary">
                Description <span className="text-[10px] font-normal text-text-muted ml-1">(optional)</span>
              </label>
              <span className={`text-[10px] ${charCounterColor}`}>{charCount} / 500</span>
            </div>
            <textarea
              id="comp-desc"
              rows={3}
              value={description}
              onChange={(e) => {
                setDescription(e.target.value);
                if (errors.description) setErrors(prev => { const n = { ...prev }; delete n.description; return n; });
              }}
              placeholder="What do they sell? Who's their audience? What makes them different?"
              className={`w-full px-3 py-2 text-xs border rounded-lg bg-surface-1 outline-none text-text-primary placeholder-text-muted transition-all focus:border-accent resize-y min-h-[80px] ${
                errors.description ? "border-danger focus:border-danger" : "border-border"
              }`}
            />
            {errors.description && <p className="text-[10px] text-danger mt-1">{errors.description}</p>}
          </div>

          {/* Status Segmented Buttons */}
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-text-primary block">Status</label>
            <div className="grid grid-cols-3 gap-1 p-1 rounded-lg bg-surface-1 border border-border">
              {[
                { key: "ACTIVE", label: "Active", dotColor: "bg-status-active", hoverLabel: "Actively tracking" },
                { key: "MONITORING", label: "Monitoring", dotColor: "bg-status-monitoring", hoverLabel: "Light-touch watch" },
                { key: "ARCHIVED", label: "Archived", dotColor: "bg-status-archived", hoverLabel: "No longer tracked" }
              ].map(s => (
                <button
                  key={s.key}
                  type="button"
                  onClick={() => setStatus(s.key as any)}
                  title={s.hoverLabel}
                  className={`flex items-center justify-center gap-1.5 py-2 rounded-md text-[10px] font-bold transition-all ${
                    status === s.key 
                      ? "bg-surface-3 text-text-primary border border-border-strong shadow-sm" 
                      : "text-text-secondary hover:text-text-primary"
                  }`}
                >
                  <span className={`w-1.5 h-1.5 rounded-full ${s.dotColor}`} />
                  <span>{s.label}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Tags / Keywords */}
          <div className="space-y-1.5">
            <label htmlFor="comp-tags" className="text-xs font-semibold text-text-primary block">
              Tags / Keywords
            </label>
            <div className="space-y-2">
              <div className="flex gap-2">
                <input
                  id="comp-tags"
                  type="text"
                  value={tagInput}
                  onChange={(e) => setTagInput(e.target.value)}
                  onKeyDown={handleTagKeyDown}
                  placeholder="Type a keyword and press Enter or comma"
                  className={`flex-1 px-3 py-2 text-xs border rounded-lg bg-surface-1 outline-none text-text-primary placeholder-text-muted transition-all focus:border-accent ${
                    errors.tags ? "border-danger focus:border-danger" : "border-border"
                  }`}
                />
                <button
                  type="button"
                  onClick={addTag}
                  className="px-3 py-2 bg-surface-3 hover:bg-surface-3-hover text-text-primary border border-border text-xs font-bold rounded-lg transition-colors shrink-0"
                >
                  Add
                </button>
              </div>
              
              {errors.tags && <p className="text-[10px] text-danger">{errors.tags}</p>}
              
              {/* Tag Badges list */}
              {tags.length > 0 && (
                <div className="flex flex-wrap gap-1.5 p-2.5 rounded-lg bg-surface-3/30 border border-border min-h-[42px]">
                  {tags.map((tag) => (
                    <span 
                      key={tag}
                      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-surface-3 border border-border-strong text-[10px] font-semibold text-text-secondary font-mono"
                    >
                      <span>{tag}</span>
                      <button
                        type="button"
                        onClick={() => removeTag(tag)}
                        className="text-text-muted hover:text-text-primary transition-colors ml-0.5"
                      >
                        <X className="w-2.5 h-2.5" />
                      </button>
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>

        </form>

        {/* Drawer Footer Actions */}
        <div className="p-4 md:p-6 border-t border-border bg-surface-3/30 flex items-center justify-between gap-4">
          <button
            type="button"
            onClick={onClose}
            disabled={loading}
            className="w-1/2 py-2.5 rounded-lg border border-border hover:bg-surface-3 text-xs font-semibold text-text-primary disabled:opacity-50 transition-colors"
          >
            Cancel
          </button>
          
          <button
            type="button"
            onClick={handleSubmit}
            disabled={loading || !name.trim() || Object.keys(errors).length > 0}
            className="w-1/2 py-2.5 rounded-lg bg-accent hover:bg-accent-hover disabled:opacity-50 disabled:cursor-not-allowed text-xs font-semibold text-white flex items-center justify-center gap-2 transition-colors shadow shadow-accent/25"
          >
            {loading ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                <span>Adding…</span>
              </>
            ) : (
              <span>Add competitor</span>
            )}
          </button>
        </div>
      </div>
      
      {/* Slide-in styles */}
      <style jsx global>{`
        @keyframes slideIn {
          from {
            transform: translateX(100%);
          }
          to {
            transform: translateX(0);
          }
        }
        .animate-slide-in {
          animation: slideIn 0.25s cubic-bezier(0.16, 1, 0.3, 1) forwards;
        }
      `}</style>
    </div>
  );
}
