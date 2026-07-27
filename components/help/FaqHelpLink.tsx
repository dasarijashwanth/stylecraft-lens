// components/help/FaqHelpLink.tsx
// Contextual "?" icon — deep-links to a FAQ category on /dashboard/help.
// Opens in a new tab deliberately: these sit next to in-progress editors
// (GTM/TDS field edits, project forms) where losing the current page's
// state to navigate away would be disruptive.
import { HelpCircle } from "lucide-react";
import { faqCategoryHref } from "@/lib/faq-slugs";

export default function FaqHelpLink({ category, className, title }: { category: string; className?: string; title?: string }) {
  return (
    <a
      href={faqCategoryHref(category)}
      target="_blank"
      rel="noopener noreferrer"
      title={title || `Help: ${category}`}
      className={className || "inline-flex items-center justify-center text-text-muted hover:text-accent transition-colors"}
    >
      <HelpCircle className="w-3.5 h-3.5" />
    </a>
  );
}
