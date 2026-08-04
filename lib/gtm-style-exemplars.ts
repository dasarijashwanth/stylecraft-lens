// lib/gtm-style-exemplars.ts
// GTM style corpus — literal (not paraphrased) excerpts from 4 real, approved
// GTM Product Knowledge documents: Homie Clipper (SC628B), Homie Shaver
// (SC817B), Homie Shaver Replacement Foil (SC559B), and the SC x 360 Jeezy
// Trimmer (SC423B). These describe OTHER, already-shipped products — they
// exist here purely as style/depth/format calibration for the AI generation
// prompt (lib/gtm-generate.ts's buildSystemInstruction), never as a data
// source for a NEW product's own facts. See STANDING_ANTI_COPY_WARNING below,
// which is embedded verbatim in every generation call that includes this
// corpus.
//
// Only the style-sensitive fields are included (narrative/claim-format
// fields) — grounded spec fields (dimensions, warranty text, etc.) don't
// need few-shot calibration and are deliberately excluded to keep prompt
// size down (see gtm-generate.ts's STYLE_EXEMPLAR_FIELD_IDS gate, which only
// attaches this corpus to chunks containing at least one of these ids).

export const STANDING_ANTI_COPY_WARNING =
  "The exemplar documents show REQUIRED style/depth/format only. They describe OTHER products. Never copy, paraphrase, or reuse their content, claims, specs, prices, or stories for a different product. Exception: collection-shared narratives, where you are explicitly instructed to adapt (not copy verbatim, not invent fresh) a stored collection kernel.";

export type ExemplarTier = "accessible" | "accessory" | "flagship";

export interface GtmExemplar {
  productName: string;
  sku: string;
  tier: ExemplarTier;
  excerpts: Partial<Record<string, string>>;
}

export const GTM_STYLE_EXEMPLARS: GtmExemplar[] = [
  {
    productName: "Homie Nano Clipper",
    sku: "SC628B",
    tier: "accessible",
    excerpts: {
      why_creating_item: "Completing the Homie Collection with the addition of this clipper",
      positioning_statement:
        "The StyleCraft Homie Nano Clipper is a USB-C rechargeable cordless clipper built for professionals and everyday users who want quiet, lightweight performance and smooth, clean results at a price that competes with the top DTC and Amazon brands. The compact nano body, Fixed Stainless Steel Taper Blade, and customizable click or freestyle lever deliver real cutting performance without the premium price tag. Compatible with most StyleCraft and Gamma+ clipper blades, the Homie Nano Clipper is the tool that anchors the Homie Collection and opens the door to a wider audience.",
      product_name_origin:
        "Homie is a term rooted in loyalty, familiarity, and community - it's the person who always has your back, reliable, real, and never pretentious. The Homie name was established with this clipper and carried through the full collection (Clipper, Trimmer, Shaver) to represent StyleCraft's connection to the grooming community at every level. The stylized H with a heart in the logo reinforces that emotional bond - this is a brand that cares about craft and the people who practice it.",
      name_story_tie:
        "The Homie name signals accessibility without sacrificing credibility. A homie doesn't show off - they just show up and deliver. That's exactly what the Nano Clipper does: ultra-quiet, lightweight, smooth cutting, at a price that makes sense. The name also anchors the Homie Collection ecosystem - when a consumer already owns the Homie Trimmer or Shaver, the Clipper feels like a natural completion of the set rather than a standalone purchase. Compatible with most StyleCraft and Gamma+ blades, it fits right into a kit they're already building. The name does the cross-sell for you.",
      features_full_list:
        "POWERFUL MOTOR runs at up to 7,000 RPM and cuts through any hair type.\nFIXED STAINLESS STEEL TAPER BLADE and silver Ceramic cutting blade are great for smoother bulk cutting.",
      reason_to_buy:
        "ULTRA-QUIET OPERATION - One of the quietest tools in its class. The kind of quiet people notice - less noise fatigue, more focus, every cut. COMPACT NANO BODY - Genuinely lightweight ergonomic design built to reduce hand fatigue during extended use. Light enough that you notice it most when you put it down.",
      up_sell:
        "The Clipper is the anchor of the Homie Collection - anytime someone buys the Trimmer or Shaver solo, this is the trade-up conversation. Lead with the lightweight/quiet comfort story, close with blade compatibility. At $69.95 salon, it's an easy yes for entry-level buyers who want real cordless performance without the pro price.",
      approved_pricing: "Salon: $69.95 Retail: $74.95",
    },
  },
  {
    productName: "Homie Nano Single Foil Shaver",
    sku: "SC817B",
    tier: "accessible",
    excerpts: {
      why_creating_item:
        "To add on to the Homie Collection. An accessible, pro-grade single foil shaver that brings finishing power to a wider audience - both at the chair and at home.",
      positioning_statement:
        "The StyleCraft Homie Nano Single Foil Shaver is the finishing move - at the chair or at home. The smallest, most accessible tool in the Homie Collection, it brings Gold Titanium Foil performance and Echo Cutter precision to anyone who wants a clean, close finish. Pro barbers reach for it as a lightweight add-on for sensitive skin cleanup. Everyday groomers reach for it because it fits in a pocket, charges with USB-C, and delivers results they'd normally pay more for. It's the tool that completes the collection and opens the door to a wider audience.",
      reason_to_buy:
        "GOLD TITANIUM FOIL + ECHO CUTTER - Premium foil material gentle on sensitive skin with an Echo Cutter that delivers audible feedback. Barbers and at-home users can feel and hear the difference. POCKET-SIZED MICRO DIMENSIONS - The most compact tool in the Homie Collection.",
      up_sell:
        "The Homie Shaver is a low-barrier, high-value add-on close for any barber or client already investing in the Homie Collection. At $29.95 salon / $34.95 retail, it practically sells itself. Lead with the Gold Titanium Foil and Echo Cutter story, then pivot immediately to the SC559B Replacement Foil Head as an automatic repeat purchase. That one conversation locks in a recurring revenue stream right at the point of sale.",
      expert_tip:
        "The Homie Nano performs best on short stubble and freshly trimmed areas. For longer growth, trim down first, then let the foil do the finishing work. The closer the starting point, the cleaner the result.",
      approved_pricing: "Salon: $24.95 Retail: $34.95",
    },
  },
  {
    productName: "StyleCraft Homie Shaver Single Foil Replacement Head",
    sku: "SC559B",
    tier: "accessory",
    excerpts: {
      why_creating_item: "Replacement foil and cutter for the Homie single foil shaver",
      positioning_statement:
        "The SC559B keeps the Homie Shaver performing like day one. A fresh Gold Titanium ultra-thin foil and Echo cutter restore the close, crisp finish the Homie is known for no drag, no tugging, no irritation. It's the easiest way to protect the tool and the results.",
      product_name_origin:
        "Carries the Homie name, rooted in loyalty, familiarity, and community. Established with the Homie Nano Clipper and carried through the full collection.",
      name_story_tie:
        "A homie always shows up. This is the SKU that keeps the Homie Shaver showing up, dependable maintenance that ties directly back to the collection ecosystem. Owning the shaver makes this purchase automatic.",
      features_full_list:
        "Gold Titanium ultra-thin foil head perfect for sensitive skin\nEasy snap-on installation, replaces in seconds with no tools.",
      reason_to_buy: "To maintain peak performance from your shaver",
      expert_tip: "Shaver is best used after trimmer or on short stubble",
      approved_pricing: "$9.95/$10.95",
    },
  },
  {
    productName: "S|C x 360 Jeezy Trimmer",
    sku: "SC423B",
    tier: "flagship",
    excerpts: {
      why_creating_item:
        "1. Consumer need - pros, stylists, and barber students needed a finishing tool that matched the clipper's performance standard\n2. Competitive gap - vector tools have historically been limited by build quality and run-time; the IN3 motor is the direct answer and a category first\n3. Identity & customization - pros want tools that reflect who they are behind the chair\n4. 360 Jeezy's credibility - peer-to-peer trust from one of the industry's most recognized barbers, not celebrity hype\n5. Complete system - positions the trimmer as the natural second half of the 360 Jeezy x StyleCraft lineup",
      positioning_statement:
        "Following the success of the original clipper collaboration, 360 Jeezy and StyleCraft set out to create the perfect companion tool. The goal was simple: build a trimmer that hits just as hard in performance, but dials in even tighter for detailing, lining, and finishing work. Every element was considered, from balance in hand to blade performance, to meet the real demands of daily barbering. This isn't just an add-on. It's the second half of a complete cutting system, designed by a barber who lives behind the chair.",
      product_name_origin:
        "The 360 Jeezy collaboration represents a full-circle approach to barbering, precision, consistency, and mastery from every angle. Just like a clean 360 wave pattern, every detail matters. This trimmer is built to reflect that same level of discipline and sharpness in every lineup.",
      name_story_tie:
        "The clipper laid the foundation. The trimmer finishes the job. Together, they represent the full system, bulk removal to final detail, executed with the same level of control and intention that defines 360 Jeezy's craft.",
      features_full_list:
        "Powered by the patented IN3 Vector Motor with intuitive torque control, engineered to deliver ultra-quiet performance, less vibration and longer-lasting battery efficiency.\nFixed Gold Titanium X-Pro Wide blade with \"The One\" black DLC Deep Tooth cutter delivers the crunchiest cuts and ultra-sharp lines.",
      reason_to_buy:
        "1. Our first-ever IN3 Vector Motor - up to 11,500 RPM, ultra-quiet performance, low vibration, and longer lasting battery efficiency with up to 3.5 hours of run-time\n2. Co-designed with one of the industry's most recognized barbers - 360 Jeezy's real input, not just a name on a box\n3. Precision that finishes the job - Gold X-Pro Wide + \"The One\" DLC cutter, completes the full cutting system with the clipper\n4. Full metal body - ultra-quiet performance, low vibration, premium build quality and durability that pros expect\n5. Customizable + built for the pro - interchangeable parts, up to 3.5 hours of run-time, USB-C charging",
      expert_tip:
        "The IN3 Vector Motor automatically adjusts torque based on the resistance it encounters - so the trimmer intuitively works harder through dense or coarse hair and eases up on finer areas without you doing a thing. Trust the motor and let it do the work. Keep the Gold X-Pro Wide blade oiled before and after every use to maintain sharpness and extend blade life. For the cleanest zero-gap lines, remove the drop top skeleton option to maximize blade visibility and precision around curves and edges.",
      up_sell:
        "360 Jeezy Clipper, any shaver with overstock or underperforming to complete the full set of clipper, trimmer and shaver. Clipper and trimmer grips and any accessories.",
      approved_pricing: "$259.95 / $269.95",
      // Marketing Direction section (GTM workbook export work, 4th filled
      // tab) — real excerpts from this SAME product's own filled Marketing
      // Direction sheet, colocated here rather than in a parallel exemplar
      // module (see lib/gtm-marketing-direction.ts's header comment for why).
      // Two fields from the real sheet (Content Ideas/Territories, Where
      // Should We Be Advertising) are deliberately OMITTED — the only source
      // text available for them was itself mid-sentence fragments, and
      // fabricating a completion would violate this corpus's own "never
      // invent, only real approved copy" rule.
      marketing_primary_goal:
        "Drive awareness, revenue, and retailer sell-in for the SC x 360 Jeezy Trimmer (SC423B); establish this as the go-to precision trimmer co-designed with one of the industry's most recognized barbers. Leveraging 360 Jeezy's presence and credibility to reinforce StyleCraft's position as the leading professional barbering brand.",
      marketing_success_kpis:
        "Revenue (sell-through at launch), ROAS on paid social/paid search, DTC traffic, engagement rate on barber community content, Amazon/Walmart sell-through, influencer earned media value from pro barber network. Initial sell-in and did we sell out?",
      marketing_launch_timing:
        "Marketing should kick off 2-4 weeks before in-market date; teaser content and influencer seeding with pro barbers should begin 4-6 weeks out. Embargo Strategy: Sample barbers early and instruct them NOT TO TALK ABOUT IT for the first X days. Build curiosity and buzz. 'What is that trimmer?' Then have all seeded barbers post and talk about it simultaneously on the reveal date.",
      marketing_core_audience:
        "Professional barbers and master barbers who follow respected figures in the barbering community. 360 Jeezy's audience. Barbers, barber students, and grooming enthusiasts who trust peer-to-peer recommendations from working pros. 25-45 male-skewing audience with deep investment in the craft.",
      marketing_secondary_audience:
        "Advanced home groomers and grooming enthusiasts who aspire to pro-level results; barber school students looking to invest in their first professional-grade trimmer; fans of barber culture content on social media; and stylists who want a precision trimmer that performs at a professional level and aligns with their personal brand behind the chair.",
      marketing_consumer_barrier:
        "Why is this trimmer worth the premium price? What does 360 Jeezy's co-sign actually mean for the product? Marketing must answer: this tool was designed with one of the industry's most recognized barbers, delivering ultra-quiet performance, low vibration, longer lasting battery efficiency with up to 3.5 hours of run-time, and the same great power.",
      marketing_messaging_direction:
        "Authentic, craft-first, community-rooted. Tone should feel like it comes from inside the barbershop. Respected, skilled, no-hype. Let 360 Jeezy speak to the tool from a barber's POV. Focus on the new IN3 motor and new customizable features. Reference: how barbers talk to each other about tools they trust. Avoid: celebrity hype tone, overly polished/corporate language, anything that feels inauthentic to the barber community.",
      marketing_product_name_origin:
        "Named in collaboration with 360 Jeezy, a professional barber known within the barbering community. The name and colorway (black, gold, red) reflect his personal aesthetic and professional identity. This is the trimmer companion to the SC x 360 Jeezy Clipper. A complete pro lineup built with his input.",
      marketing_visual_direction:
        "Primary: clean product-focused hero shots on dark backdrop highlighting gold blade, red grips, and full metal body. Secondary: in-barbershop action shots. 360 Jeezy using the trimmer on a real client, showing clean lines and precision. Lifestyle: behind-the-chair, craft-focused. Mood: professional, sharp, barbershop authentic. Avoid: overly staged/editorial looks disconnected from the shop.",
      marketing_languages: "English (primary). Spanish (secondary, for retail/DTC market reach). French Canadian",
      marketing_dos_donts:
        "DO: Let 360 Jeezy lead the story as a credible working barber; highlight IN3 motor tech and Gold X-Pro Wide blade performance; show real barbershop environments and real clients; use red/black/gold palette consistently; speak to pro barbers peer-to-peer. DON'T: Frame this as a celebrity/rapper collab; use language disconnected from barber culture; oversell as a consumer/retail product (pro-first); mix up clipper and trimmer messaging; use competitor brand names.",
      marketing_web_coverage:
        "Full PDP refresh on brand.com and Amazon for SC423B. Add to SC x 360 Jeezy product family page alongside the SC x 360 Jeezy Clipper. Cross-reference on clipper PDP as \"Also available: SC x 360 Jeezy Trimmer.\" Update category pages and buying guide where 360 Jeezy collab is featured.",
      marketing_print_material:
        "Spec sheet / sell sheet for sales team and external reps. Flyer for trade show and barber education events. Counter card or shelf talker for key retail/POS accounts. In-box co-branded 360 Jeezy barber collab insert card.",
      marketing_trade_show_launch:
        "Yes, if aligned with launch timing. Booth featuring SC423B alongside SC x 360 Jeezy Clipper as the complete pro collab lineup. 360 Jeezy appearance/demo opportunity if available.",
    },
  },
];

// Field ids the corpus actually has calibration text for — used by
// lib/gtm-generate.ts to decide whether a given chunk of fields should get
// the (token-costly) exemplar block attached at all.
export const STYLE_EXEMPLAR_FIELD_IDS = new Set(
  GTM_STYLE_EXEMPLARS.flatMap(ex => Object.keys(ex.excerpts))
);

// Renders the corpus block for the system prompt — only the fields present
// in `fieldIds` are shown per exemplar, so a chunk asking about
// `expert_tip` doesn't drag in unrelated positioning-statement text from
// all 4 products.
export function renderStyleExemplarBlock(fieldIds: string[]): string {
  const relevant = fieldIds.filter(id => STYLE_EXEMPLAR_FIELD_IDS.has(id));
  if (relevant.length === 0) return "";

  const sections = GTM_STYLE_EXEMPLARS.map(ex => {
    const lines = relevant
      .map(id => (ex.excerpts[id] ? `  ${id}: ${ex.excerpts[id]}` : null))
      .filter(Boolean)
      .join("\n");
    if (!lines) return null;
    return `[${ex.productName} (${ex.sku}) — ${ex.tier} tier]\n${lines}`;
  }).filter(Boolean);

  if (sections.length === 0) return "";

  return `\n\nSTYLE EXEMPLARS (real, approved GTM sheets for OTHER products — depth/format/voice reference ONLY):\n${sections.join("\n\n")}\n\n${STANDING_ANTI_COPY_WARNING}`;
}
