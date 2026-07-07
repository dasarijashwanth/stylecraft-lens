import { Document, Page, View, Text, StyleSheet } from "@react-pdf/renderer";
import { styles, CoverHeader, PageFooter, SectionHeader, TwoColRow, formatDate } from "./shared";

const local = StyleSheet.create({
  chips: {
    flexDirection: "row",
    flexWrap: "wrap",
    marginBottom: 8,
  },
  chip: {
    border: "0.5pt solid #dddddd",
    borderRadius: 3,
    paddingVertical: 3,
    paddingHorizontal: 6,
    marginRight: 4,
    marginBottom: 4,
    fontSize: 8,
    backgroundColor: "#fafafa",
  },
  safetyRow: {
    flexDirection: "row",
    marginBottom: 4,
  },
  safetyIcon: {
    width: 12,
    fontSize: 8,
    color: "#d97706",
  },
  safetyText: {
    flex: 1,
    fontSize: 9,
  },
});

export function TdsPdf({ productName, projectName, tds }: { productName: string; projectName?: string; tds: any }) {
  const specs = tds.specifications || {};
  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <CoverHeader productName={productName} docType="Technical Data Sheet" projectName={projectName} />
        <Text style={{ fontSize: 8, color: "#666666", marginBottom: 10 }}>
          {tds.model_number ? `Model: ${tds.model_number} · ` : ""}Version {tds.version || "1.0"} · {formatDate()}
        </Text>

        <SectionHeader title="Motor Specifications" />
        <TwoColRow question="Motor Type" answer={specs.motor?.type || "—"} />
        <TwoColRow question="Speed" answer={specs.motor?.speed_rpm || "—"} />
        <TwoColRow question="Torque" answer={specs.motor?.torque || "—"} />
        <TwoColRow question="Noise Level" answer={specs.noise_level_db || "—"} />

        <SectionHeader title="Battery & Power" />
        <TwoColRow question="Battery Type" answer={specs.battery?.type || "—"} />
        <TwoColRow question="Capacity" answer={specs.battery?.capacity_mah || "—"} />
        <TwoColRow question="Runtime" answer={specs.battery?.runtime_minutes || "—"} />
        <TwoColRow question="Charge Time" answer={specs.battery?.charge_time_minutes || "—"} />
        <TwoColRow question="Charge Type" answer={specs.battery?.charge_type || "—"} />
        <TwoColRow question="Cord Type" answer={specs.cord_type || "—"} />

        <SectionHeader title="Blade & Cutting" />
        <TwoColRow question="Blade Material" answer={specs.blade?.material || "—"} />
        <TwoColRow question="Blade Type" answer={specs.blade?.type || "—"} />
        <TwoColRow question="Adjustment Range" answer={specs.blade?.adjustment || "—"} />

        <SectionHeader title="Physical & Pricing" />
        <TwoColRow
          question="Length / Width / Weight"
          answer={`${specs.dimensions?.length_mm || "—"} / ${specs.dimensions?.width_mm || "—"} / ${specs.dimensions?.weight_g || "—"}`}
        />
        <TwoColRow question="Housing Material" answer={specs.housing_material || "—"} />
        <TwoColRow question="Country of Origin" answer={tds.country_of_origin || "—"} />
        <TwoColRow question="MSRP" answer={tds.msrp || "—"} />

        <SectionHeader title="Included Accessories" />
        <View style={local.chips}>
          {(tds.included_accessories || []).map((a: string, i: number) => (
            <Text key={i} style={local.chip}>{a}</Text>
          ))}
        </View>

        <SectionHeader title="Certifications" />
        <View style={local.chips}>
          {(tds.certifications || []).map((c: string, i: number) => (
            <Text key={i} style={local.chip}>{c}</Text>
          ))}
        </View>

        <SectionHeader title="Warranty & Support" />
        <TwoColRow question="Duration" answer={tds.warranty?.duration || "—"} />
        <TwoColRow question="Coverage" answer={tds.warranty?.coverage || "—"} />
        <TwoColRow question="Support Portal" answer={tds.warranty?.support || "—"} />

        <SectionHeader title="Safety Information" />
        {(tds.safety_notes || []).map((n: string, i: number) => (
          <View key={i} style={local.safetyRow} wrap={false}>
            <Text style={local.safetyIcon}>!</Text>
            <Text style={local.safetyText}>{n}</Text>
          </View>
        ))}

        <PageFooter />
      </Page>
    </Document>
  );
}
