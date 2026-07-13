import { StyleSheet, View, Text } from "@react-pdf/renderer";

export const APP_NAME = "Stylecraft Lens";

export const styles = StyleSheet.create({
  page: {
    padding: 40,
    fontSize: 10,
    fontFamily: "Helvetica",
    color: "#111111",
  },
  coverHeader: {
    borderBottom: "2pt solid #111111",
    paddingBottom: 14,
    marginBottom: 20,
  },
  brandRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 8,
  },
  brand: {
    fontSize: 9,
    fontWeight: 700,
    letterSpacing: 1,
    color: "#666666",
    textTransform: "uppercase",
  },
  metaRight: {
    fontSize: 8,
    color: "#666666",
    textAlign: "right",
  },
  docType: {
    fontSize: 9,
    fontWeight: 700,
    color: "#4F46E5",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: 4,
  },
  title: {
    fontSize: 20,
    fontWeight: 700,
    marginBottom: 2,
  },
  subtitle: {
    fontSize: 10,
    color: "#555555",
  },
  sectionHeader: {
    fontSize: 10,
    fontWeight: 700,
    textTransform: "uppercase",
    letterSpacing: 0.5,
    backgroundColor: "#111111",
    color: "#ffffff",
    paddingVertical: 5,
    paddingHorizontal: 8,
    marginTop: 14,
    marginBottom: 8,
  },
  row: {
    flexDirection: "row",
    borderBottom: "0.5pt solid #dddddd",
    paddingVertical: 5,
  },
  questionCell: {
    width: "35%",
    fontSize: 9,
    fontWeight: 700,
    paddingRight: 8,
    color: "#333333",
  },
  answerCell: {
    width: "65%",
    fontSize: 9,
    color: "#111111",
  },
  sourceBadge: {
    fontSize: 7,
    color: "#888888",
    marginTop: 2,
    textTransform: "uppercase",
  },
  footer: {
    position: "absolute",
    bottom: 24,
    left: 40,
    right: 40,
    flexDirection: "row",
    justifyContent: "space-between",
    fontSize: 8,
    color: "#aaaaaa",
    borderTop: "0.5pt solid #eeeeee",
    paddingTop: 6,
  },
  bulletRow: {
    flexDirection: "row",
    marginBottom: 4,
  },
  bullet: {
    width: 10,
    fontSize: 9,
  },
  bulletText: {
    flex: 1,
    fontSize: 9,
    lineHeight: 1.4,
  },
  fourColRow: {
    flexDirection: "row",
    borderBottom: "0.5pt solid #dddddd",
    paddingVertical: 5,
  },
  fourColItem: {
    width: "28%",
    fontSize: 9,
    fontWeight: 700,
    paddingRight: 6,
    color: "#333333",
  },
  fourColOwner: {
    width: "14%",
    fontSize: 8,
    color: "#666666",
    paddingRight: 6,
  },
  fourColAnswer: {
    width: "36%",
    fontSize: 9,
    color: "#111111",
    paddingRight: 6,
  },
  fourColNotes: {
    width: "22%",
    fontSize: 8,
    color: "#666666",
    fontStyle: "italic",
  },
});

export function formatDate(d: Date = new Date()) {
  return d.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
}

export function fileDate(d: Date = new Date()) {
  return d.toISOString().slice(0, 10);
}

export function CoverHeader({
  productName,
  docType,
  projectName,
}: {
  productName: string;
  docType: string;
  projectName?: string;
}) {
  return (
    <View style={styles.coverHeader}>
      <View style={styles.brandRow}>
        <Text style={styles.brand}>{APP_NAME}</Text>
        <Text style={styles.metaRight}>
          {projectName ? `${projectName} · ` : ""}Generated {formatDate()}
        </Text>
      </View>
      <Text style={styles.docType}>{docType}</Text>
      <Text style={styles.title}>{productName}</Text>
    </View>
  );
}

export function PageFooter() {
  return (
    <Text
      style={styles.footer}
      render={({ pageNumber, totalPages }) => (
        `Generated ${formatDate()} — ${APP_NAME}                                                            Page ${pageNumber} of ${totalPages}`
      )}
      fixed
    />
  );
}

export function TwoColRow({ question, answer, badge }: { question: string; answer: string; badge?: string }) {
  return (
    <View style={styles.row} wrap={false}>
      <Text style={styles.questionCell}>{question}</Text>
      <View style={styles.answerCell}>
        <Text>{answer || "—"}</Text>
        {badge && <Text style={styles.sourceBadge}>{badge}</Text>}
      </View>
    </View>
  );
}

// The internal-sheet-style 4-column row (Item | Owner | Answer | Notes)
// used by both GTM and TDS PDFs. `badge` renders under the Answer cell —
// a source footnote (e.g. "Web-sourced — verify") for web-sourced answers.
export function FourColRow({
  item,
  owner,
  answer,
  notes,
  badge,
}: {
  item: string;
  owner?: string | null;
  answer: string;
  notes?: string | null;
  badge?: string;
}) {
  return (
    <View style={styles.fourColRow} wrap={false}>
      <Text style={styles.fourColItem}>{item}</Text>
      <Text style={styles.fourColOwner}>{owner || "—"}</Text>
      <View style={styles.fourColAnswer}>
        <Text>{answer || "—"}</Text>
        {badge && <Text style={styles.sourceBadge}>{badge}</Text>}
      </View>
      <Text style={styles.fourColNotes}>{notes || ""}</Text>
    </View>
  );
}

export function FourColHeader() {
  return (
    <View style={[styles.fourColRow, { borderBottom: "1pt solid #111111", paddingVertical: 3 }]} wrap={false}>
      <Text style={[styles.fourColItem, { fontSize: 7, textTransform: "uppercase", letterSpacing: 0.5, color: "#888888" }]}>Item</Text>
      <Text style={[styles.fourColOwner, { fontSize: 7, textTransform: "uppercase", letterSpacing: 0.5, color: "#888888" }]}>Owner</Text>
      <Text style={[styles.fourColAnswer, { fontSize: 7, textTransform: "uppercase", letterSpacing: 0.5, color: "#888888" }]}>Answer</Text>
      <Text style={[styles.fourColNotes, { fontSize: 7, textTransform: "uppercase", letterSpacing: 0.5, color: "#888888", fontStyle: "normal" }]}>Notes</Text>
    </View>
  );
}

export function SectionHeader({ title }: { title: string }) {
  return <Text style={styles.sectionHeader}>{title}</Text>;
}

export function BulletList({ items }: { items: string[] }) {
  return (
    <View>
      {items.map((item, i) => (
        <View key={i} style={styles.bulletRow} wrap={false}>
          <Text style={styles.bullet}>→</Text>
          <Text style={styles.bulletText}>{item}</Text>
        </View>
      ))}
    </View>
  );
}

export interface PdfClaim {
  claimId: string;
  text: string;
  type: string;
  verification: "verified" | "unverified" | "model_estimate";
  sources: { url: string; title: string; publisher: string; quote: string; retrievedAt: string }[];
}

// Full References section for a document's PDF export (lib/citations.ts's
// Claim shape) — numbered, real URLs for verified claims; a distinctly
// styled warning row for anything that couldn't be verified, so the label
// survives into the exported document and isn't just a web-only UI touch.
export function CitationList({ claims }: { claims: PdfClaim[] }) {
  if (!claims || claims.length === 0) return null;
  const verified = claims.filter(c => c.verification === "verified");
  const unverified = claims.filter(c => c.verification !== "verified");

  return (
    <View>
      <SectionHeader title="References" />
      {verified.map((c, i) => (
        <View key={c.claimId} style={{ marginBottom: 6 }} wrap={false}>
          <Text style={{ fontSize: 9 }}>
            <Text style={{ fontWeight: 700 }}>[{i + 1}] </Text>
            {c.text}
          </Text>
          {c.sources.map((s, si) => (
            <Text key={si} style={{ fontSize: 7, color: "#4F46E5", marginTop: 1 }}>
              {s.publisher || s.title || s.url} — {s.url} (retrieved {s.retrievedAt.slice(0, 10)})
            </Text>
          ))}
        </View>
      ))}
      {unverified.map(c => (
        <View key={c.claimId} style={{ marginBottom: 6, backgroundColor: "#fffbeb", border: "0.5pt solid #fde68a", borderRadius: 4, padding: 6 }} wrap={false}>
          <Text style={{ fontSize: 9 }}>{c.text}</Text>
          <Text style={{ fontSize: 8, fontWeight: 700, color: "#92400e", marginTop: 2 }}>
            ⚠ No verifiable source found — treat as unverified estimate
          </Text>
        </View>
      ))}
    </View>
  );
}
