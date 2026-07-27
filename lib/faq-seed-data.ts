// lib/faq-seed-data.ts
// Single source of truth for the FAQ/Help content — imported by
// lib/memoryDb.ts (local dev seeding) and scripts/seed-faqs.ts (the
// one-time production content loader). Deliberately NOT duplicated as raw
// SQL in supabase_schema.sql: this is long free-text prose with
// apostrophes/quotes/markdown, a qualitatively different (much higher
// escaping-risk) content type than the short brand/motor-family string
// arrays that DO live directly in SQL elsewhere in this app. Editing FAQ
// content going forward should happen either through the admin editor
// (/dashboard/admin/faqs) or by editing this array and re-running
// scripts/seed-faqs.ts (idempotent — upserts by question text).
//
// Category order here IS the left-sidebar/category order on /help — do not
// reorder categories without intending to change that.
export interface FaqSeedEntry {
  category: string;
  question: string;
  answer: string; // light markdown: **bold**, `code`, "- " bullet lists
}

export const FAQ_CATEGORIES: string[] = [
  "Getting Started",
  "Dashboard",
  "Creating Projects",
  "Competitive Analysis Tab",
  "Pricing Tab",
  "Go To Market Tab",
  "TDS",
  "Content Form & Artwork Tabs",
  "Project Deck Tab",
  "Notifications & Timestamps",
  "Settings (Admin)",
  "Troubleshooting",
];

export const FAQ_SEED_DATA: FaqSeedEntry[] = [
  // Category 1 — Getting Started
  {
    category: "Getting Started",
    question: "What is StyleCraft Lens?",
    answer:
      "StyleCraft Lens is our internal product-intelligence platform. You create a project for a product (new, custom, or existing), and Lens automatically runs a competitive market analysis, generates the product's core documents (TDS, Go-To-Market, Project Deck), and keeps everything editable, cited, and exportable (PDF, CSV, PPTX, Google Drive).",
  },
  {
    category: "Getting Started",
    question: "How do I log in and change my password?",
    answer:
      "Log in with your company email at the live site. On first login you'll be required to set a new password. You can change it any time under Settings → Account → Change Password.",
  },
  {
    category: "Getting Started",
    question: "What's the typical workflow from start to finish?",
    answer:
      "1. Create a project with the product's name and URL/ASIN and your target price.\n" +
      "2. Lens captures a live product snapshot and runs the 4-phase analysis automatically.\n" +
      "3. TDS, GTM, and the Project Deck generate automatically once the analysis completes.\n" +
      "4. Review each tab, edit any field inline.\n" +
      "5. Download PDFs/CSV/PPTX or save to Google Drive.",
  },

  // Category 2 — Dashboard
  {
    category: "Dashboard",
    question: "What do the four stat cards at the top show?",
    answer:
      "Active Projects, Analyses Running (live), Documents Generated this week, and Fields Needing Attention (fields awaiting internal input or flagged). Each card is clickable and opens the filtered list behind the number.",
  },
  {
    category: "Dashboard",
    question: "What is the \"In progress\" strip?",
    answer:
      "Live jobs currently running — each shows the phase (e.g., \"Phase 3 of 4 — Researching indie & emerging competitors\") with a real progress bar. If a section fails you'll see an amber \"partial\" chip; open the project to retry just that section.",
  },
  {
    category: "Dashboard",
    question: "Why do project cards show the product name larger than the project name?",
    answer:
      "The product is the anchor of everything Lens does; the project name is just your reference label. All analysis and generation key off the product's identity (URL/ASIN), never the project title.",
  },
  {
    category: "Dashboard",
    question: "What do the status pills mean?",
    answer:
      "- Grey = Draft\n- Blue = Running/Generating\n- Green = Complete\n- Amber = Partial (some sections need retry)\n- Red = Failed (open for the specific reason and a Retry button)",
  },

  // Category 3 — Creating Projects
  {
    category: "Creating Projects",
    question: "What do I need to create a project?",
    answer:
      "Minimum: a product name. Strongly recommended: the official product page URL and/or Amazon ASIN (enables the live snapshot and exact data), and your target/approved price (drives price-band competitor matching). Lens auto-fills the rest of the project details from the product page.",
  },
  {
    category: "Creating Projects",
    question: "What happens right after I click Create?",
    answer:
      "Lens scrapes the product page (and Amazon listing if you gave an ASIN), stores a timestamped snapshot, auto-fills project metadata, and starts the analysis pipeline in the background. You can leave the page — everything continues and you'll get a notification when each piece is ready.",
  },
  {
    category: "Creating Projects",
    question: "What if my product is custom or unreleased (no web presence)?",
    answer:
      "Lens will detect that and derive the category from your description. If it can't tell what type of product it is, it will ask you one question (e.g., \"trimmer, shaver, dryer?\") before running the analysis — it never guesses the category.",
  },
  {
    category: "Creating Projects",
    question: "Why does Lens ask for a target price?",
    answer:
      "Price is the #2 competitor-matching priority (after motor type). Legacy competitors are selected within ±30% of your price so a $260 tool is never compared to $25 products. Without a price, Lens uses the product's live listed price; with neither, it will ask before discovering competitors.",
  },

  // Category 4 — Competitive Analysis Tab
  {
    category: "Competitive Analysis Tab",
    question: "How does Lens pick the 10 competitors?",
    answer:
      "5 legacy + 5 emerging, prioritized by: (1) **motor type** — same or adjacent motor tech to your product; (2) **price** — nearest to your target price for legacy brands; relative brand-tier for indie brands (your flagship is matched to their flagship); (3) comparable features/specs. Legacy brands come from our curated brand lists (see Settings).",
  },
  {
    category: "Competitive Analysis Tab",
    question: "What are the brand chips I see while the analysis runs?",
    answer:
      "That's the curated legacy-brand list being searched live (e.g., \"Wahl ✅ rotary match ($249) · Oster ⏳ searching\"). You can disable a brand for this run or add a one-off brand without changing the saved defaults.",
  },
  {
    category: "Competitive Analysis Tab",
    question: "Where does the data in each section come from?",
    answer:
      "Every section has a source line under its heading (e.g., \"Source: Amazon listing (ASIN …) · retrieved {time}\") and a Details expander showing the full trail — which sources were tried, the exact queries run, and what was used vs rejected. Individual claims carry numbered citations you can click.",
  },
  {
    category: "Competitive Analysis Tab",
    question: "What do Strengths / Weaknesses & Buyer Sentiment analyze?",
    answer:
      "Real reviews only: Amazon reviews (or the listing's top reviews + rating breakdown), retailer reviews, and expert/forum reviews found on the web. Every theme is backed by verified quotes with dates. \"Recent sentiment\" covers roughly the last 90 days.",
  },
  {
    category: "Competitive Analysis Tab",
    question: "What does the ⚠ \"No verifiable source found\" label mean?",
    answer:
      "That claim couldn't be traced to a fetched source, so it's explicitly flagged as unverified. Lens never presents an uncited number (like a market size) as fact.",
  },
  {
    category: "Competitive Analysis Tab",
    question: "A section says a source timed out. What do I do?",
    answer:
      "Click that section's Retry — it re-runs only the failed fetches, not the whole analysis. Completed data is never lost.",
  },
  {
    category: "Competitive Analysis Tab",
    question: "Why is a competitor labeled \"Different motor type\" or \"Not on curated legacy list\"?",
    answer:
      "Lens couldn't fill that slot with a same-motor or curated-brand product inside the price band, so it widened the criteria and labeled the substitution honestly instead of hiding it.",
  },

  // Category 5 — Pricing Tab
  {
    category: "Pricing Tab",
    question: "What does the Pricing Benchmarks table show?",
    answer:
      "One row per competitor with brand, tier (Good/Better/Best computed from price quartiles), and live Amazon price with a citation and retrieved date. The positioning line is computed from this data (e.g., \"your $259.95 sits 4% above the median of $249\").",
  },
  {
    category: "Pricing Tab",
    question: "Why don't I see a Pricing section on some reports?",
    answer:
      "Sections with no real data are removed entirely rather than showing empty tables or \"—\" placeholders. If there was no target price and no benchmark rows, the section is hidden (this is logged for admins).",
  },

  // Category 6 — Go To Market Tab
  {
    category: "Go To Market Tab",
    question: "What is the GTM document?",
    answer:
      "The full Product Knowledge form (74 fields: General, Packaging & Logistics, Tool Description, Motor, Blades, Lids, Lever, Guards, Charging, Included in Box) plus marketing fields — auto-generated when the analysis completes, shown as Item | Owner | Answer | Notes.",
  },
  {
    category: "Go To Market Tab",
    question: "Where do GTM answers come from?",
    answer:
      "In order: your product record and inputs → the product-page snapshot → the full Amazon data → project documents (Competitive Analysis, Sales Kit, TDS — facts cross-fill between documents) → targeted web searches per field (brand site, retailers, product manuals, reviews) → derived values (e.g., Good/Better/Best from the price benchmarks). Every answer shows a source badge.",
  },
  {
    category: "Go To Market Tab",
    question: "What do \"Awaiting internal input\" and \"Not found — checked K sources\" mean?",
    answer:
      "\"Awaiting internal input\" marks fields only our team can decide (Dieline, Approved Pricing, Pallet Tier, Measurement By) — click the field to fill it in. \"Not found\" means Lens verifiably scraped multiple sources and none stated the value; open Details to see exactly which pages were checked.",
  },
  {
    category: "Go To Market Tab",
    question: "How do I edit a field?",
    answer:
      "Click any Answer, Owner, or Notes cell, type, and click away (or Ctrl+Enter). It autosaves — you'll see \"Saved ✓\". Every field keeps history: hover → Revert to restore a previous value.",
  },
  {
    category: "Go To Market Tab",
    question: "Do my edits show up in the PDF/CSV?",
    answer:
      "Always. Exports render from the current saved data at the moment you download — never from the original generation.",
  },
  {
    category: "Go To Market Tab",
    question: "How do I export the GTM?",
    answer:
      "Buttons at the top: Download PDF, Download CSV (Section | Question | Answer | Source — one row per field, opens cleanly in Excel/Sheets), and Save to Drive (lands in /StyleCraft Lens/{Project}/{DocType}/).",
  },
  {
    category: "Go To Market Tab",
    question: "What's the fill report (\"58 from product data, 9 web, 4 derived…\")?",
    answer:
      "A per-document summary of how many fields were answered from each source tier — proof the full pipeline ran, and a quick way to spot documents needing attention.",
  },

  // Category 7 — TDS
  {
    category: "TDS",
    question: "How is the TDS different from the GTM?",
    answer:
      "The TDS is a **snapshot document**: it's filled from the live product page/listing data captured at project creation, values copied exactly as published. That's why it shows \"Live snapshot captured {time} from {domain}\" and has **no regenerate button** — you can edit fields manually, and admins can \"Re-capture snapshot,\" which creates a new version rather than overwriting.",
  },
  {
    category: "TDS",
    question: "A TDS field says \"Not listed on product page.\" Why?",
    answer:
      "The captured page genuinely didn't state that value. Check the Details trail to confirm which sources were read; you can fill the field manually and it will flow into exports.",
  },

  // Category 8 — Content Form & Artwork Tabs
  {
    category: "Content Form & Artwork Tabs",
    question: "What goes in the Content Form tab?",
    answer:
      "The Final Copy set: positioning, tone, core message, taglines (Sexy/Techie), romance copy, consumer-facing feature bullets (Long / Condensed / Top 3), how-to-use and care copy, social hook and caption, keywords, messaging risks, e-commerce titles and character-limited descriptions (229/115/200 — live counters enforce the limits), and in-store box copy.",
  },
  {
    category: "Content Form & Artwork Tabs",
    question: "What is the Artwork tab for?",
    answer:
      "Packaging and creative assets for the project — dieline references, box copy, the 6 feature icons used on the final box, and uploaded artwork files, kept alongside the product data they must match.",
  },

  // Category 9 — Project Deck Tab
  {
    category: "Project Deck Tab",
    question: "What is the Project Deck?",
    answer:
      "An auto-generated PowerPoint built from our uploaded company template, populated with the project's GTM, analysis, and pricing data. It generates automatically after the GTM completes.",
  },
  {
    category: "Project Deck Tab",
    question: "How do I download or share it?",
    answer:
      "Download PPTX (opens in PowerPoint, Google Slides, Keynote) or Save to Drive. Slide thumbnails preview in the tab.",
  },
  {
    category: "Project Deck Tab",
    question: "I edited the GTM after the deck was made — is the deck stale?",
    answer:
      "Yes, and Lens tells you: an \"out of date — GTM edited {time}\" banner appears with a Regenerate button. Regenerating creates a new version; previous versions stay downloadable.",
  },

  // Category 10 — Notifications & Timestamps
  {
    category: "Notifications & Timestamps",
    question: "What appears in the notifications bell?",
    answer:
      "Real events only: analysis completed/partial/failed, documents generated, PDFs exported, Drive saves, snapshot captures, grouped edit activity, fields awaiting input, and system alerts (e.g., Drive re-authorization). Click an item to jump straight to it; mark items read individually or all at once.",
  },
  {
    category: "Notifications & Timestamps",
    question: "How do timestamps work?",
    answer:
      "Everything shows real relative times (\"5 hours ago\") with the exact date-time on hover, in your timezone. \"Edited\" times change only when someone actually edits — opening or exporting a document never touches them.",
  },

  // Category 11 — Settings (Admin)
  {
    category: "Settings (Admin)",
    question: "What are the Legacy Brands lists?",
    answer:
      "The curated brands per category (Professional/Retail Clippers-Trimmers-Shavers, Professional/Retail Beauty) that define who counts as a \"legacy\" competitor. Admins can add, remove, disable, or reorder brands (order = search priority). Each analysis snapshots the list it used.",
  },
  {
    category: "Settings (Admin)",
    question: "What is Competitor Matching in Settings?",
    answer:
      "The selection weights (default 45% motor / 35% price / 20% features) and the motor-type taxonomy. Adjusting weights changes future analyses only.",
  },
  {
    category: "Settings (Admin)",
    question: "How do I connect Google Drive?",
    answer:
      "The first time you click Save to Drive you'll go through Google sign-in (Lens only gets access to files it creates). If saves start failing with an auth error, reconnect under Settings → Integrations.",
  },

  // Category 12 — Troubleshooting
  {
    category: "Troubleshooting",
    question: "The analysis says \"partial complete.\" Is my data lost?",
    answer:
      "No — everything that finished is saved and shown. Only the failed sections need attention; each shows the specific reason (e.g., \"Amazon review fetch timed out after 3 attempts\") and a Retry that re-runs just that piece.",
  },
  {
    category: "Troubleshooting",
    question: "I closed the tab mid-analysis. Did it stop?",
    answer:
      "No. All work runs on the server. Reopen the project and it rehydrates: finished sections render, running ones show progress, failed ones show Retry.",
  },
  {
    category: "Troubleshooting",
    question: "A PDF has a strange character or a missing value. What now?",
    answer:
      "This should be blocked automatically (every export is verified before download). If one slips through, report it with the thumbs-down on the FAQ or to an admin — the failing string is logged and added to our regression tests.",
  },
  {
    category: "Troubleshooting",
    question: "The TDS or GTM never generated for my project.",
    answer:
      "Open the project card — it shows the job status and any error, with Retry. Admins can check Settings → Generation Health for the job trail. Older projects created before auto-generation were backfilled; if one was missed, Retry generates it.",
  },
  {
    category: "Troubleshooting",
    question: "Competitors look wrong for my product (wrong category or price tier).",
    answer:
      "Check the Product Identity Card at the top of the analysis — if Lens misidentified the product, correct it there and re-run. Also confirm the target price on the project; the price band drives legacy selection.",
  },
];
