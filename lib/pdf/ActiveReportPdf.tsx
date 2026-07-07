import { Document, Page, View, Text } from "@react-pdf/renderer";
import { styles, CoverHeader, PageFooter, SectionHeader, TwoColRow, BulletList } from "./shared";

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
          <TwoColRow
            key={i}
            question={c.name}
            answer={`${c.price || "—"} · ★${c.rating || "—"} (${c.review_count || "—"} reviews)${c.verified_by_rainforest === false ? " · unverified" : ""}`}
          />
        ))}

        <SectionHeader title="Indie & Emerging Competitors" />
        {emergingComps.map((c: any, i: number) => (
          <TwoColRow
            key={i}
            question={c.name}
            answer={`${c.price || "—"} · ★${c.rating || "—"} (${c.review_count || "—"} reviews)${c.verified_by_rainforest === false ? " · unverified" : ""}`}
          />
        ))}

        <View style={{ backgroundColor: "#f5f3ff", border: "0.5pt solid #ddd6fe", borderRadius: 6, padding: 10, marginTop: 8 }}>
          <Text style={{ fontSize: 8, fontWeight: 700, color: "#5b21b6", textTransform: "uppercase", marginBottom: 4 }}>
            Positioning Recommendation
          </Text>
          <Text style={{ fontSize: 9, fontStyle: "italic" }}>{ca.positioning_recommendation || "—"}</Text>
        </View>
      </Page>

      <Page size="A4" style={styles.page}>
        <SectionHeader title="Pricing Analysis" />
        <Text style={{ fontSize: 9, fontWeight: 700, marginBottom: 6 }}>{pricing.price_positioning || "—"}</Text>
        {prices.map((p: any, i: number) => (
          <TwoColRow key={i} question={p.name} answer={`${p.price || "—"} · ${p.tier || "—"} tier`} />
        ))}
        <Text style={{ fontSize: 9, marginTop: 8, lineHeight: 1.5 }}>{pricing.notes || ""}</Text>

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
    </Document>
  );
}
