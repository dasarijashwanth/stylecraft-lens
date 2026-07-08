import { Document, Page, Text, View } from "@react-pdf/renderer";
import { styles, CoverHeader, PageFooter, SectionHeader, FourColHeader, FourColRow, formatDate } from "./shared";
import { TDS_FIELD_SCHEMA, TDS_SECTIONS } from "../tds-field-schema";

// Field-schema-driven, same shape as GtmPdf — TDS moved off its old
// hardcoded nested-spec layout onto the same documents/document_fields
// model GTM uses, so this reads live field rows the same way.
export function TdsPdf({
  productName,
  projectName,
  capturedAt,
  sourceDomain,
  fields,
}: {
  productName: string;
  projectName?: string;
  capturedAt?: string | null;
  sourceDomain?: string | null;
  fields: Record<string, { answer: string; source: string; owner?: string | null; notes?: string | null }>;
}) {
  const completed = Object.values(fields).filter((f: any) => f.answer && f.answer.toUpperCase() !== "N/A" && f.answer !== "Not listed on product page").length;

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <CoverHeader productName={productName} docType="Technical Data Sheet" projectName={projectName} />
        <Text style={{ fontSize: 8, color: "#666666", marginBottom: 4 }}>
          {completed}/{TDS_FIELD_SCHEMA.length} fields completed
        </Text>
        <Text style={{ fontSize: 8, color: "#666666", marginBottom: 10 }}>
          {capturedAt ? `Data captured ${formatDate(new Date(capturedAt))}${sourceDomain ? ` from ${sourceDomain}` : ""}` : "No live snapshot captured yet"}
        </Text>

        {TDS_SECTIONS.map(section => (
          <View key={section}>
            <SectionHeader title={section} />
            <FourColHeader />
            {TDS_FIELD_SCHEMA.filter(f => f.section === section).map(f => {
              const entry = fields[f.id];
              return (
                <FourColRow
                  key={f.id}
                  item={f.question}
                  owner={entry?.owner}
                  answer={entry?.answer || "Not listed on product page"}
                  notes={entry?.notes}
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
