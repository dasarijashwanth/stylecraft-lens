import { Document, Page, View, Text, StyleSheet } from "@react-pdf/renderer";
import { styles, CoverHeader, PageFooter, SectionHeader, BulletList } from "./shared";

const local = StyleSheet.create({
  elevator: {
    fontSize: 10,
    lineHeight: 1.6,
    backgroundColor: "#f9f9f9",
    borderLeft: "2pt solid #111111",
    padding: 10,
  },
  featureCard: {
    border: "0.5pt solid #dddddd",
    borderRadius: 4,
    padding: 8,
    marginBottom: 6,
  },
  featureHeadline: {
    fontSize: 9,
    fontWeight: 700,
    marginBottom: 2,
  },
  featureBenefit: {
    fontSize: 8.5,
    color: "#555555",
  },
  objectionCard: {
    border: "0.5pt solid #dddddd",
    borderRadius: 4,
    marginBottom: 6,
    overflow: "hidden",
  },
  objectionQ: {
    backgroundColor: "#fee2e2",
    color: "#991b1b",
    fontSize: 8.5,
    padding: 6,
  },
  objectionA: {
    backgroundColor: "#f0fdf4",
    color: "#166534",
    fontSize: 8.5,
    padding: 6,
  },
  ctaBox: {
    backgroundColor: "#111111",
    color: "#ffffff",
    borderRadius: 6,
    padding: 14,
    marginTop: 12,
  },
  ctaLabel: {
    fontSize: 7,
    textTransform: "uppercase",
    letterSpacing: 0.5,
    color: "#aaaaaa",
    marginBottom: 4,
  },
  ctaText: {
    fontSize: 11,
    fontWeight: 700,
  },
});

export function SalesKitPdf({ productName, projectName, kit }: { productName: string; projectName?: string; kit: any }) {
  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <CoverHeader productName={productName} docType="Sales Kit" projectName={projectName} />

        <Text style={{ fontSize: 12, fontStyle: "italic", marginBottom: 10 }}>{kit.tagline}</Text>

        <SectionHeader title="Elevator Pitch" />
        <Text style={local.elevator}>{kit.elevator_pitch}</Text>

        <SectionHeader title="Key Features & Benefits" />
        {(kit.key_features || []).map((f: any, i: number) => (
          <View key={i} style={local.featureCard} wrap={false}>
            <Text style={local.featureHeadline}>{f.headline}</Text>
            <Text style={local.featureBenefit}>{f.benefit}</Text>
          </View>
        ))}

        <SectionHeader title="Competitive Advantages" />
        {(kit.competitive_advantages || []).map((c: any, i: number) => (
          <View key={i} style={styles.row} wrap={false}>
            <Text style={styles.questionCell}>{c.vs}</Text>
            <Text style={styles.answerCell}>{c.advantage}</Text>
          </View>
        ))}

        <SectionHeader title="Objection Handlers" />
        {(kit.objection_handlers || []).map((o: any, i: number) => (
          <View key={i} style={local.objectionCard} wrap={false}>
            <Text style={local.objectionQ}>? {o.objection}</Text>
            <Text style={local.objectionA}>{"✓"} {o.response}</Text>
          </View>
        ))}

        <SectionHeader title="Key Messages" />
        <BulletList items={kit.key_messages || []} />

        <View style={local.ctaBox}>
          <Text style={local.ctaLabel}>Call to Action</Text>
          <Text style={local.ctaText}>{kit.call_to_action}</Text>
        </View>

        <PageFooter />
      </Page>
    </Document>
  );
}
