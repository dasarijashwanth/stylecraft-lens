// Anti-copy guardrail reference text — deliberately generic, cliché
// marketing filler for each narrative field. If a generated answer is too
// similar to THIS text (same trigram-similarity check already used for
// cross-product boilerplate detection), it's almost certainly lazy,
// could-apply-to-any-product copy rather than something grounded in the
// actual sources, and gets one retry.
//
// This is NOT a real product's copy to avoid plagiarizing (there's
// nothing product-specific here to copy) — it's a placeholder built from
// common generic-AI-marketing-speak patterns. If your marketing team has
// a real example of copy they consider too generic/canned, swap it in
// here per field for a sharper check.
export const GENERIC_EXEMPLARS: Record<string, string> = {
  why_creating_item:
    "We created this item because customers wanted a high quality, reliable, and affordable option that stands out from the competition and meets the needs of both professionals and everyday users alike.",
  positioning_statement:
    "This product was designed to combine style, performance, and durability into one premium tool. Our team focused on delivering the best possible experience for our customers by using high quality materials and modern technology. It fits perfectly into our growing lineup of professional-grade tools built for everyday use.",
  product_name_origin:
    "The name was chosen because it sounds strong, modern, and memorable, and reflects our brand's commitment to quality and innovation.",
  name_story_tie:
    "The name ties directly into our brand story of craftsmanship, quality, and innovation, representing everything we stand for as a company.",
  reason_to_buy:
    "1. High quality construction. 2. Great performance. 3. Trusted brand. 4. Affordable price. 5. Backed by warranty and customer support.",
  expert_tip:
    "For best results, use this product as directed and maintain it regularly to keep it performing at its best.",
};
