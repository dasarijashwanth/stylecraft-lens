import { Document, Page, View, Text } from "@react-pdf/renderer";
import { styles, CoverHeader, PageFooter, SectionHeader, TwoColRow, BulletList, CitationList, SourceLine, ProvenanceAppendix } from "./shared";
import { isPricingAnalysisEmpty } from "@/lib/pricing-analysis";
import { summarizeSource } from "@/lib/provenance-format";
import type { ProvenanceRow } from "@/lib/db/section-provenance";
import { getToolTypeLabel } from "@/lib/tool-type-taxonomy";
import type { ToolTypeRow } from "@/lib/db/tool-types";

const TARGET_MARKET_LABELS: Record<string, string> = { pro: "Pro / Salon", consumer: "Retail", both: "Both (merged)" };

// Same "print every form input right above the weights sentence" reasoning
// as lib/export-pdf.ts's renderFormInputsLine — kept as its own small
// function here since this file renders via @react-pdf/renderer elements,
// not HTML strings.
function formInputsSummary(formInputs: any, toolTypes: ToolTypeRow[]): string | null {
  if (!formInputs) return null;
  const industryLabel = formInputs.industry === "haircare-styling" ? "Hair Care & Styling" : formInputs.industry === "grooming-barbering" ? "Grooming & Barbering" : (formInputs.industry || "—");
  const toolTypeLabel = formInputs.toolType ? getToolTypeLabel(formInputs.toolType, toolTypes) : "—";
  const marketLabel = formInputs.targetMarket && TARGET_MARKET_LABELS[formInputs.targetMarket] ? TARGET_MARKET_LABELS[formInputs.targetMarket] : "—";
  // Only whichever criterion actually applied to this tool type gets a
  // line — never a "Motor Technology: unspecified" line for a motorless
  // flat iron/curling iron/hot brush analysis, and never both lines at
  // once.
  const criterionLine = formInputs.motorTech
    ? `Motor Technology: ${formInputs.motorTech}`
    : formInputs.heatTechRaw
    ? `Plate/Heat Technology: ${formInputs.heatTechRaw}`
    : null;
  return [
    `Industry: ${industryLabel}`,
    `Tool Type: ${toolTypeLabel}`,
    `Target Market: ${marketLabel}`,
    criterionLine,
    `Target Price: ${formInputs.pricePoint || "unspecified"}`,
    `Differentiator: ${formInputs.keyDiff || "none given"}`,
  ].filter(Boolean).join("  ·  ");
}

// Never render a bare "—" for a competitor with partial data — omit the
// missing part instead, and only fall back to an explicit sentence when
// literally nothing was resolved for this competitor.
function competitorSummary(c: any): string {
  const parts: string[] = [];
  // The primary-criterion match leads — it's the #1 selection criterion,
  // not incidental spec data (lib/analysisEngine.ts's
  // selectByCompositeScore). motor_*/heat_tech_* fields are mutually
  // exclusive per competitor — never both, never a Motor line for a
  // motorless flat iron/curling iron/hot brush competitor.
  if (c.motor_match_tier === "unverified") parts.push("Motor: Unverified");
  else if (c.motor_type) parts.push(`Motor: ${c.motor_type}`);
  else if (c.heat_tech_match_tier === "unverified") parts.push("Plate/Heat: Unverified");
  else if (c.heat_tech_type) parts.push(`Plate/Heat: ${c.heat_tech_type}`);
  if (c.price) parts.push(c.price);
  if (c.rating) parts.push(`★${c.rating}${c.review_count ? ` (${c.review_count} reviews)` : ""}`);
  else if (c.review_count) parts.push(`${c.review_count} reviews`);
  if (c.manufacturer) parts.push(`Mfr: ${c.manufacturer}`);
  if (c.model_number) parts.push(`Model: ${c.model_number}`);
  if (c.verified_by_rainforest === false) parts.push("unverified");
  // A real, verified competitor that simply isn't sold on Amazon at all
  // (lib/legacy-brand-discovery.ts's brand-site pass) — distinct from the
  // "unverified" tag above, which means a lookup was attempted and failed.
  if (c.sources?.brand_site && !c.sources?.amazon) parts.push("Sold via brand/pro channels — not on Amazon");
  if (c.motor_unverified_fallback) parts.push(c.heat_tech_type || c.heat_tech_match_tier ? "last-resort pick, plate/heat technology unconfirmed" : "last-resort pick, motor type unconfirmed");
  // Only the exception is flagged — a curated-list pick is the expected
  // default and needs no extra tag; a competitor the curated registry
  // couldn't fill (lib/analysisEngine.ts's AI top-up fallback) does.
  if (c.brand_list_status === "not_curated") parts.push("Not on curated legacy list");
  return parts.length > 0 ? parts.join(" · ") : "No verified pricing/rating data found for this competitor";
}

// Same per-competitor evidence block as lib/export-pdf.ts's
// renderCompetitorEvidenceHTML — primary-criterion evidence quote+source and
// which source(s) contributed, at a finer grain than the section-level
// ProvenanceAppendix below.
function competitorEvidenceLine(c: any): string {
  const isHeatTech = !c.motor_match_tier && !!c.heat_tech_match_tier;
  const criterionLabel = isHeatTech ? "Plate/Heat" : "Motor";
  const criterionLine = isHeatTech
    ? (c.heat_tech_match_tier === "unverified"
        ? "not confirmed from any source"
        : `${c.heat_tech_type || "unknown"} (${c.heat_tech_match_tier})${c.heat_tech_source_quote ? ` — "${c.heat_tech_source_quote}"` : ""}`)
    : (c.motor_match_tier === "unverified"
        ? "not confirmed from any source"
        : `${c.motor_type || "unknown"} (${c.motor_match_tier})${c.motor_source_quote ? ` — "${c.motor_source_quote}"` : ""}`);
  const sourceLabel = c.sources?.brand_site && c.sources?.amazon ? "brand site + Amazon"
    : c.sources?.brand_site ? `brand site (${c.sources.brand_site.url})`
    : c.sources?.amazon ? "Amazon" : "unspecified";
  return `${criterionLabel}: ${criterionLine} · Source: ${sourceLabel}`;
}

export function ActiveReportPdf({
  productName,
  projectName,
  report,
  toolTypes,
}: {
  productName: string;
  projectName?: string;
  report: any;
  toolTypes: ToolTypeRow[];
}) {
  const ca = report.competitive_analysis || {};
  const pricing = report.pricing_analysis || {};
  const gtm = report.go_to_market || {};
  const cf = report.content_form || {};

  const snapshot = ca.market_snapshot || {};
  const trends = ca.key_trends || [];
  const gaps = ca.market_gaps || [];
  const threats = ca.top_threats || [];
  const opps = ca.top_opportunities || [];
  const largeComps = ca.large_brand_competitors || [];
  const emergingComps = ca.indie_emerging_competitors || [];
  const prices = pricing.competitor_prices || [];
  const recs = gtm.recommendations || [];
  const wins = gtm.quick_wins || [];
  const citations = ca.citations || [];
  const provenanceRows: ProvenanceRow[] = ca.section_provenance || [];
  const matchingWeights = ca.matching_weights;
  const formInputsLine = formInputsSummary(ca.form_inputs, toolTypes);
  const registrySnapshot = ca.legacy_registry_snapshot || null;
  const curatedCount = largeComps.filter((c: any) => c.curated_brand === true).length;

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <CoverHeader productName={productName} docType="Competitive Intelligence Report" projectName={projectName} />

        <SectionHeader title="Market Snapshot" />
        <Text style={{ fontSize: 9, marginBottom: 8, lineHeight: 1.5 }}>
          {snapshot.overview_paragraph || "—"}
        </Text>

        <SectionHeader title="Key Industry Trends" />
        <BulletList items={trends.map((t: any) => `${t.trend_name}: ${t.description}`)} />

        <SectionHeader title="Market Gaps" />
        <BulletList items={gaps} />

        <SectionHeader title="Top Threats" />
        <BulletList items={threats.map((t: any) => `${t.competitor_name}: ${t.threat_description}`)} />

        <SectionHeader title="Top Opportunities" />
        <BulletList items={opps.map((o: any) => `${o.action}: ${o.description}`)} />

        <SectionHeader title="Large Brand Competitors" />
        {registrySnapshot && (
          <Text style={{ fontSize: 8, color: "#666666", fontStyle: "italic", marginBottom: 4 }}>
            Selected from the {registrySnapshot.category_name} brand list ({curatedCount} of {largeComps.length} from curated brands).
          </Text>
        )}
        {largeComps.map((c: any, i: number) => (
          <TwoColRow key={i} question={c.name} answer={competitorSummary(c)} />
        ))}

        <SectionHeader title="Indie & Emerging Competitors" />
        {emergingComps.map((c: any, i: number) => (
          <TwoColRow key={i} question={c.name} answer={competitorSummary(c)} />
        ))}

        <View style={{ backgroundColor: "#f5f3ff", border: "0.5pt solid #ddd6fe", borderRadius: 6, padding: 10, marginTop: 8 }}>
          <Text style={{ fontSize: 8, fontWeight: 700, color: "#5b21b6", textTransform: "uppercase", marginBottom: 4 }}>
            Positioning Recommendation
          </Text>
          <Text style={{ fontSize: 9, fontStyle: "italic" }}>{ca.positioning_recommendation || "—"}</Text>
        </View>
      </Page>

      <Page size="A4" style={styles.page}>
        {!isPricingAnalysisEmpty(pricing) && (
          <View>
            <SectionHeader title="Pricing Analysis & Benchmarks" />
            {pricing.provenance && <SourceLine text={summarizeSource("pricing", pricing.provenance, pricing.provenance_resolved_at)} />}
            {pricing.target_price && <Text style={{ fontSize: 9, fontWeight: 700, marginBottom: 4 }}>Target Price: {pricing.target_price}</Text>}
            {pricing.price_positioning && <Text style={{ fontSize: 9, marginBottom: 6, lineHeight: 1.5 }}>{pricing.price_positioning}</Text>}
            {prices.map((p: any, i: number) => (
              <TwoColRow
                key={i}
                question={`${p.name}${p.brand ? ` (${p.brand})` : ""}`}
                answer={[p.price, p.tier].filter(Boolean).join(" · ") + (p.source_url ? " · [source]" : "")}
              />
            ))}
            {pricing.notes && <Text style={{ fontSize: 9, marginTop: 8, lineHeight: 1.5 }}>{pricing.notes}</Text>}
          </View>
        )}

        <SectionHeader title="Go-To-Market Recommendations" />
        {recs.map((r: any, i: number) => (
          <TwoColRow key={i} question={`[${r.priority || "—"}] ${r.title || r.headline || ""}`} answer={r.detail || r.explanation || "—"} />
        ))}

        <SectionHeader title="Tactical Quick Wins" />
        <BulletList items={wins} />

        <Text style={{ fontSize: 9, marginTop: 8, lineHeight: 1.5 }}>{gtm.notes || ""}</Text>

        <SectionHeader title="Content Brief" />
        <TwoColRow question="Target Audience" answer={cf.target_audience || "—"} />
        <Text style={{ fontSize: 9, fontWeight: 700, marginTop: 8, marginBottom: 4 }}>Core Creative Messages</Text>
        <BulletList items={cf.key_messages || []} />
        <Text style={{ fontSize: 9, marginTop: 8, lineHeight: 1.5 }}>{cf.notes || ""}</Text>

        <PageFooter />
      </Page>

      {citations.length > 0 && (
        <Page size="A4" style={styles.page}>
          <CitationList claims={citations} />
          <PageFooter />
        </Page>
      )}

      {(provenanceRows.length > 0 || matchingWeights || formInputsLine) && (
        <Page size="A4" style={styles.page}>
          {formInputsLine && (
            <Text style={{ fontSize: 8, color: "#666666", marginBottom: 4, lineHeight: 1.4 }}>
              Analysis inputs — {formInputsLine}
            </Text>
          )}
          {matchingWeights && (() => {
            // Weights are stored EXACTLY as entered (free-form relative-
            // importance numbers, no sum-to-1 constraint) — normalization
            // happens here at render time, same as
            // lib/competitor-scoring.ts's computeCompositeScore, so this
            // print-out reflects what actually happened during scoring.
            const sum = matchingWeights.motor + matchingWeights.price + matchingWeights.feature;
            const pct = (w: number) => (sum > 0 ? Math.round((w / sum) * 100) : 0);
            // The weights object's "motor" slot is generic across tool
            // types (see lib/db/scoring-profiles.ts) — labeled here per
            // whichever criterion this analysis's own competitors were
            // actually scored on, never a hardcoded "Motor" for a motorless
            // flat iron/curling iron/hot brush analysis.
            const allComps = [...largeComps, ...emergingComps];
            const criterionLabel = allComps.some((c: any) => c.heat_tech_match_tier) && !allComps.some((c: any) => c.motor_match_tier)
              ? "Heat/Plate Technology"
              : "Motor";
            return (
              <Text style={{ fontSize: 8, color: "#666666", marginBottom: 8, lineHeight: 1.4 }}>
                Weights (as entered): {criterionLabel} {matchingWeights.motor}, Price {matchingWeights.price}, Features {matchingWeights.feature} → effective {pct(matchingWeights.motor)}/{pct(matchingWeights.price)}/{pct(matchingWeights.feature)}%.
                Competitors are prioritized by {criterionLabel.toLowerCase()} match ({pct(matchingWeights.motor)}%), then price
                proximity ({pct(matchingWeights.price)}%) — absolute for legacy brands, relative to each
                indie brand&apos;s own lineup — then comparable feature/spec overlap ({pct(matchingWeights.feature)}%).
              </Text>
            );
          })()}
          {(largeComps.length > 0 || emergingComps.length > 0) && (
            <View style={{ marginBottom: 8 }}>
              <Text style={{ fontSize: 10, fontWeight: 700, marginBottom: 4 }}>Per-Competitor Evidence</Text>
              {[...largeComps, ...emergingComps].map((c: any, i: number) => (
                <TwoColRow key={i} question={c.name} answer={competitorEvidenceLine(c)} />
              ))}
            </View>
          )}
          <ProvenanceAppendix rows={provenanceRows} />
          <PageFooter />
        </Page>
      )}
    </Document>
  );
}
