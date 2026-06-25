"use client";

import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { useState, useEffect } from "react";
import { 
  Bold, 
  Italic, 
  Heading1, 
  Heading2, 
  Heading3, 
  List, 
  ListOrdered, 
  Quote, 
  Minus, 
  Save,
  Sparkles,
  Loader2
} from "lucide-react";
import { toast } from "sonner";

interface ReportEditorProps {
  initialContent: any;
  reportId: string;
  title: string;
  onSave: (content: any) => Promise<void>;
}

export default function ReportEditor({ initialContent, reportId, title, onSave }: ReportEditorProps) {
  const [saving, setSaving] = useState(false);
  const [lastSaved, setLastSaved] = useState<Date | null>(null);
  
  // AI selection states
  const [selectedText, setSelectedText] = useState("");
  const [rewriting, setRewriting] = useState(false);

  const editor = useEditor({
    extensions: [StarterKit],
    content: initialContent,
    onUpdate: ({ editor }) => {
      // Auto-save logic can trigger on edit, but we'll implement auto-save interval
    },
    onSelectionUpdate: ({ editor }) => {
      const { from, to } = editor.state.selection;
      const text = editor.state.doc.textBetween(from, to, " ");
      setSelectedText(text.trim());
    }
  });

  // Manual save trigger
  const handleSave = async () => {
    if (!editor) return;
    setSaving(true);
    try {
      const currentJSON = editor.getJSON();
      await onSave(currentJSON);
      setLastSaved(new Date());
      toast.success("Report saved");
    } catch (e) {
      toast.error("Failed to save report");
    } finally {
      setSaving(false);
    }
  };

  // Auto-save every 30 seconds
  useEffect(() => {
    if (!editor) return;
    
    const interval = setInterval(() => {
      const currentJSON = editor.getJSON();
      onSave(currentJSON)
        .then(() => setLastSaved(new Date()))
        .catch(() => console.warn("Auto-save failed"));
    }, 30000);

    return () => clearInterval(interval);
  }, [editor, onSave]);

  const handleAiRewrite = async (mode: "improve" | "shorten" | "formalize") => {
    if (!editor || !selectedText) return;
    
    setRewriting(true);
    const toastId = toast.loading(`AI rewriting selection...`);
    
    try {
      const res = await fetch("/api/reports/rewrite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: selectedText, mode })
      });
      
      const data = await res.json();
      if (!res.ok) throw new Error(data.message);
      
      const { from, to } = editor.state.selection;
      editor.chain().focus().insertContentAt({ from, to }, data.rewrittenText).run();
      
      toast.dismiss(toastId);
      toast.success(`Rewritten selection applied`);
      setSelectedText("");
    } catch (e: any) {
      toast.dismiss(toastId);
      toast.error(e.message || "AI rewrite failed");
    } finally {
      setRewriting(false);
    }
  };

  if (!editor) return null;

  return (
    <div className="flex flex-col border border-border rounded-xl bg-surface-2 overflow-hidden min-h-[500px]">
      
      {/* Editor Toolbar */}
      <div className="flex flex-wrap items-center justify-between p-3 border-b border-border bg-surface-3/30 gap-3">
        {/* Formatting Buttons */}
        <div className="flex items-center gap-1.5 flex-wrap">
          <button
            type="button"
            onClick={() => editor.chain().focus().toggleBold().run()}
            className={`p-1.5 rounded hover:bg-surface-3 transition-colors ${editor.isActive("bold") ? "bg-accent-bg text-accent-text" : "text-text-secondary"}`}
            title="Bold"
          >
            <Bold className="w-4 h-4" />
          </button>
          
          <button
            type="button"
            onClick={() => editor.chain().focus().toggleItalic().run()}
            className={`p-1.5 rounded hover:bg-surface-3 transition-colors ${editor.isActive("italic") ? "bg-accent-bg text-accent-text" : "text-text-secondary"}`}
            title="Italic"
          >
            <Italic className="w-4 h-4" />
          </button>

          <div className="h-4 w-[1px] bg-border mx-1" />

          <button
            type="button"
            onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
            className={`p-1.5 rounded hover:bg-surface-3 transition-colors ${editor.isActive("heading", { level: 1 }) ? "bg-accent-bg text-accent-text" : "text-text-secondary"}`}
            title="Heading 1"
          >
            <Heading1 className="w-4 h-4" />
          </button>

          <button
            type="button"
            onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
            className={`p-1.5 rounded hover:bg-surface-3 transition-colors ${editor.isActive("heading", { level: 2 }) ? "bg-accent-bg text-accent-text" : "text-text-secondary"}`}
            title="Heading 2"
          >
            <Heading2 className="w-4 h-4" />
          </button>

          <button
            type="button"
            onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
            className={`p-1.5 rounded hover:bg-surface-3 transition-colors ${editor.isActive("heading", { level: 3 }) ? "bg-accent-bg text-accent-text" : "text-text-secondary"}`}
            title="Heading 3"
          >
            <Heading3 className="w-4 h-4" />
          </button>

          <div className="h-4 w-[1px] bg-border mx-1" />

          <button
            type="button"
            onClick={() => editor.chain().focus().toggleBulletList().run()}
            className={`p-1.5 rounded hover:bg-surface-3 transition-colors ${editor.isActive("bulletList") ? "bg-accent-bg text-accent-text" : "text-text-secondary"}`}
            title="Bullet list"
          >
            <List className="w-4 h-4" />
          </button>

          <button
            type="button"
            onClick={() => editor.chain().focus().toggleOrderedList().run()}
            className={`p-1.5 rounded hover:bg-surface-3 transition-colors ${editor.isActive("orderedList") ? "bg-accent-bg text-accent-text" : "text-text-secondary"}`}
            title="Numbered list"
          >
            <ListOrdered className="w-4 h-4" />
          </button>

          <button
            type="button"
            onClick={() => editor.chain().focus().toggleBlockquote().run()}
            className={`p-1.5 rounded hover:bg-surface-3 transition-colors ${editor.isActive("blockquote") ? "bg-accent-bg text-accent-text" : "text-text-secondary"}`}
            title="Blockquote"
          >
            <Quote className="w-4 h-4" />
          </button>

          <button
            type="button"
            onClick={() => editor.chain().focus().setHorizontalRule().run()}
            className="p-1.5 rounded hover:bg-surface-3 text-text-secondary transition-colors"
            title="Divider Line"
          >
            <Minus className="w-4 h-4" />
          </button>
        </div>

        {/* Save indicators */}
        <div className="flex items-center gap-3">
          <span className="text-[10px] text-text-muted">
            {saving ? (
              <span className="flex items-center gap-1">
                <Loader2 className="w-3 h-3 animate-spin text-accent" />
                <span>Auto-saving...</span>
              </span>
            ) : lastSaved ? (
              <span>Saved at {lastSaved.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}</span>
            ) : (
              <span>Unsaved changes</span>
            )}
          </span>

          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-accent hover:bg-accent-hover text-white text-xs font-bold transition-all disabled:opacity-50"
          >
            <Save className="w-3.5 h-3.5" />
            <span>Save</span>
          </button>
        </div>
      </div>

      {/* Floating AI selection helper panel */}
      {selectedText && (
        <div className="flex items-center justify-between p-3.5 border-b border-accent-border bg-accent-bg/30 text-xs">
          <div className="flex items-center gap-2 text-accent-text min-w-0">
            <Sparkles className="w-4 h-4 shrink-0 text-accent animate-pulse" />
            <p className="font-semibold truncate">
              AI Rewrite selection: <span className="font-normal italic text-text-secondary">&quot;{selectedText.substring(0, 40)}{selectedText.length > 40 ? "..." : ""}&quot;</span>
            </p>
          </div>
          
          <div className="flex gap-1.5 shrink-0 pl-3">
            <button
              onClick={() => handleAiRewrite("improve")}
              disabled={rewriting}
              className="px-2.5 py-1 rounded bg-accent/80 hover:bg-accent text-white text-[10px] font-bold transition-colors disabled:opacity-50"
            >
              Improve
            </button>
            <button
              onClick={() => handleAiRewrite("shorten")}
              disabled={rewriting}
              className="px-2.5 py-1 rounded bg-zinc-800 border border-zinc-700 hover:bg-zinc-700 text-text-primary text-[10px] font-bold transition-colors disabled:opacity-50"
            >
              Shorten
            </button>
            <button
              onClick={() => handleAiRewrite("formalize")}
              disabled={rewriting}
              className="px-2.5 py-1 rounded bg-zinc-800 border border-zinc-700 hover:bg-zinc-700 text-text-primary text-[10px] font-bold transition-colors disabled:opacity-50"
            >
              Formalize
            </button>
          </div>
        </div>
      )}

      {/* Text Area Canvas */}
      <div className="flex-1 p-6 md:p-8 bg-surface-1 min-h-[400px]">
        <EditorContent editor={editor} />
      </div>

    </div>
  );
}
