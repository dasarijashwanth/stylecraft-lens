import { Document, Page, Text, View } from "@react-pdf/renderer";
import { styles, CoverHeader, PageFooter, SectionHeader, FourColHeader, FourColRow } from "./shared";
import { GTM_FIELD_SCHEMA, GTM_SECTIONS } from "../gtm-field-schema";
import { isRealAnswer } from "../field-answer-state";

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
          {Object.values(fields).filter((f: any) => isRealAnswer(f.answer)).length}/
          {GTM_FIELD_SCHEMA.length} fields completed
        </Text>

        {GTM_SECTIONS.map(section => (
          <View key={section}>
            <SectionHeader title={section} />
            <FourColHeader />
            {GTM_FIELD_SCHEMA.filter(f => f.section === section).map(f => {
              const entry = fields[f.id];
              return (
                <FourColRow
                  key={f.id}
                  item={f.question}
                  owner={entry?.owner}
                  answer={entry?.answer || "N/A"}
                  notes={entry?.notes}
                  badge={entry?.source === "web" ? "Web-sourced — verify" : undefined}
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
