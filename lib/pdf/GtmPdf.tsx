import { Document, Page, Text, View } from "@react-pdf/renderer";
import { styles, CoverHeader, PageFooter, SectionHeader, TwoColRow } from "./shared";
import { GTM_FIELD_SCHEMA, GTM_SECTIONS } from "../gtm-field-schema";

const SOURCE_LABELS: Record<string, string> = {
  sales_kit: "Source: Sales Kit",
  tds: "Source: TDS",
  active_report: "Source: Active Report",
  multiple: "Source: Multiple",
  none: "N/A",
};

export function GtmPdf({
  productName,
  projectName,
  productKnowledge,
}: {
  productName: string;
  projectName?: string;
  productKnowledge: any;
}) {
  const fields = productKnowledge?.fields || {};

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <CoverHeader productName={productName} docType="Go-To-Market — Product Knowledge" projectName={projectName} />
        <Text style={{ fontSize: 8, color: "#666666", marginBottom: 4 }}>
          {Object.values(fields).filter((f: any) => f.answer && f.answer.toUpperCase() !== "N/A").length}/
          {GTM_FIELD_SCHEMA.length} fields completed
        </Text>

        {GTM_SECTIONS.map(section => (
          <View key={section}>
            <SectionHeader title={section} />
            {GTM_FIELD_SCHEMA.filter(f => f.section === section).map(f => {
              const entry = fields[f.id];
              return (
                <TwoColRow
                  key={f.id}
                  question={f.question}
                  answer={entry?.answer || "N/A"}
                  badge={SOURCE_LABELS[entry?.source || "none"]}
                />
              );
            })}
          </View>
        ))}

        <PageFooter />
      </Page>
    </Document>
  );
}
