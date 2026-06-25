"use client";

import { useState } from "react";
import { HelpCircle, ChevronDown, ChevronUp, Sparkles, BookOpen, MessageSquare } from "lucide-react";

export default function HelpPage() {
  const [faqs, setFaqs] = useState([
    {
      id: 1,
      q: "How does the 3-phase AI competitive analysis work?",
      a: "Stylecraft Lens triggers a background search using Claude. Phase 1 performs search engine crawling to identify 10 competing products (5 established market leaders, 5 emerging challenge brands). Phase 2 researches their specific prices, specifications, strengths, and weaknesses. Phase 3 synthesises this intelligence into executive reports and recommendations.",
      open: true
    },
    {
      id: 2,
      q: "Can I run analyses without configure Clerk or Anthropic keys?",
      a: "Yes! Stylecraft Lens features a Developer Bypass mode. If credentials are not present in `.env.local`, the application seeds a local database workspace and mock-runs the 3-phase analysis with realistic, high-fidelity results. This allows immediate testing of all dashboard panels.",
      open: false
    },
    {
      id: 3,
      q: "How do I export reports as PDFs?",
      a: "When viewing a saved report in the editor, click 'Export as PDF' in the right sidebar. The system compile your TipTap rich-text canvas into a print-friendly document, updating its status to EXPORTED.",
      open: false
    }
  ]);

  const toggleFaq = (id: number) => {
    setFaqs(faqs.map(f => f.id === id ? { ...f, open: !f.open } : f));
  };

  return (
    <div className="space-y-6 max-w-3xl">
      {/* Title */}
      <div className="flex items-center gap-2">
        <HelpCircle className="w-5 h-5 text-accent" />
        <h1 className="text-display">Help & Support</h1>
      </div>

      {/* Docs callouts */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
        <div className="p-5 border border-border bg-surface-2 rounded-xl space-y-2.5">
          <BookOpen className="w-6 h-6 text-accent" />
          <h3 className="font-bold text-text-primary">Grooming & Styling Glossary</h3>
          <p className="text-text-secondary leading-relaxed">
            Learn about motor RPM comparisons, stay-cool blades, magnetic linear motors, and custom modular kit configurations.
          </p>
        </div>

        <div className="p-5 border border-border bg-surface-2 rounded-xl space-y-2.5">
          <MessageSquare className="w-6 h-6 text-accent" />
          <h3 className="font-bold text-text-primary">Contact Support Team</h3>
          <p className="text-text-secondary leading-relaxed">
            Reach out to our creative brand analyst team for custom SaaS white-label features or custom integrations.
          </p>
        </div>
      </div>

      {/* FAQs */}
      <div className="bg-surface-2 border border-border rounded-xl p-5 md:p-6 space-y-4">
        <h2 className="text-sm font-bold text-text-primary font-display mb-4">Frequently Asked Questions</h2>
        
        <div className="divide-y divide-border/60 text-xs">
          {faqs.map(faq => (
            <div key={faq.id} className="py-3.5">
              <button
                type="button"
                onClick={() => toggleFaq(faq.id)}
                className="w-full flex items-center justify-between font-bold text-text-primary text-left"
              >
                <span>{faq.q}</span>
                {faq.open ? <ChevronUp className="w-4 h-4 text-text-muted" /> : <ChevronDown className="w-4 h-4 text-text-muted" />}
              </button>
              {faq.open && (
                <p className="text-text-secondary leading-relaxed mt-2.5 pr-6">
                  {faq.a}
                </p>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
