import { Document, Page, View, Text } from "@react-pdf/renderer";
import { styles, CoverHeader, PageFooter, SectionHeader, TwoColRow, BulletList, CitationList, SourceLine, ProvenanceAppendix } from "./shared";
import { isPricingAnalysisEmpty } from "@/lib/pricing-analysis";
import { summarizeSource } from "@/lib/provenance-format";
import type { ProvenanceRow } from "@/lib/db/section-provenance";

// Never render a bare "—" for a competitor with partial data — omit the
// missing part instead, and only fall back to an explicit sentence when
// literally nothing was resolved for this competitor.
function competitorSummary(c: any): string {
  const parts: string[] = [];
  if (c.price) parts.push(c.price);
  if (c.rating) parts.push(`★${c.rating}${c.review_count ? ` (${c.review_count} reviews)` : ""}`);
  else if (c.review_count) parts.push(`${c.review_count} reviews`);
  if (c.manufacturer) parts.push(`Mfr: ${c.manufacturer}`);
  if (c.model_number) parts.push(`Model: ${c.model_number}`);
  if (c.verified_by_rainforest === false) parts.push("unverified");
  return parts.length > 0 ? parts.join(" · ") : "No verified pricing/rating data found for this competitor";
}

export function ActiveReportPdf({
  productName,
  projectName,
  report,
}: {
  productName: string;
  projectName?: string;
  report: any;
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

      {provenanceRows.length > 0 && (
        <Page size="A4" style={styles.page}>
          <ProvenanceAppendix rows={provenanceRows} />
          <PageFooter />
        </Page>
      )}
    </Document>
  );
}
