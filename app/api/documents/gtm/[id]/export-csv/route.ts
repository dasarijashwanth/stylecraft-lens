import { NextRequest, NextResponse } from "next/server";
import { stringify } from "csv-stringify/sync";
import { getAuthSession } from "@/lib/auth";
import { getProject } from "@/lib/db/projects";
import { getDocumentById, getDocumentFields } from "@/lib/db/documents";
import { GTM_FIELD_SCHEMA, GTM_SOURCE_LABELS, type GtmFieldSource } from "@/lib/gtm-field-schema";
import { isRealAnswer } from "@/lib/field-answer-state";

// A flagged field's `answer` almost always still holds the real (if
// imperfect/conflicting) value — never destroy it with a generic message.
// This only decorates a genuinely real answer with why it was flagged.
function buildFlagAnnotation(sourceDetail: any): string {
  if (sourceDetail?.conflict) return "Conflicting values from different sources — verify manually";
  if (sourceDetail?.reason === "ungrounded") return "Could not verify against source documents";
  if (typeof sourceDetail?.reason === "string") return `Flagged: ${sourceDetail.reason.replace(/-/g, " ")}`;
  return "Flagged for review";
}

export const maxDuration = 30;

// Cells starting with these characters are interpreted as formulas by
// Excel/Sheets — prefixing with a single quote defuses CSV injection
// without changing what a human sees when they open the file.
function sanitizeCsvCell(value: string): string {
  if (/^[=+\-@]/.test(value)) return `'${value}`;
  return value;
}

function slugify(value: string): string {
  return value.trim().replace(/[^a-zA-Z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "Product";
}

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const document = await getDocumentById(params.id);
    if (!document || document.doc_type !== "gtm") {
      return NextResponse.json({ error: "GTM document not found" }, { status: 404 });
    }

    const session = await getAuthSession();
    const project = await getProject(document.project_id, session.orgId);
    if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });

    const fields = await getDocumentFields(document.id);
    const byId = new Map(fields.map(f => [f.field_id, f]));

    // Iterate the SCHEMA, not the saved rows — guarantees exactly one row
    // per schema field (including ones never generated/saved), so the
    // exported row count always equals GTM_FIELD_SCHEMA.length.
    const rows = GTM_FIELD_SCHEMA.map(schemaField => {
      const entry = byId.get(schemaField.id);
      const trimmed = (entry?.answer ?? "").trim();

      // A flagged field's real answer must never be blanket-overwritten —
      // only a genuinely non-real answer (blank/N/A/a finalize terminal
      // string) shows a placeholder; a flagged-but-real answer keeps its
      // value with an accurate reason annotated alongside it.
      let answer: string;
      if (isRealAnswer(trimmed)) {
        answer = entry?.flagged ? `${trimmed} [${buildFlagAnnotation(entry?.source_detail)}]` : trimmed;
      } else if (!trimmed) {
        answer = "N/A";
      } else {
        answer = trimmed;
      }

      const source = GTM_SOURCE_LABELS[(entry?.source as GtmFieldSource) || "none"] ?? GTM_SOURCE_LABELS.none;

      // Only filled in when a hand edit has moved `answer` away from what
      // the AI/derivation pipeline last produced — blank for every
      // never-edited field, so the column reads as "what changed", not a
      // full duplicate of every row.
      const aiOriginal = (entry?.ai_answer ?? "").trim();
      const editedByUser = aiOriginal !== "" && aiOriginal !== trimmed;

      return [
        sanitizeCsvCell(`PRODUCT KNOWLEDGE — ${schemaField.section}`),
        sanitizeCsvCell(schemaField.question),
        sanitizeCsvCell(answer),
        sanitizeCsvCell(editedByUser ? aiOriginal : ""),
        sanitizeCsvCell(source),
      ];
    });

    const csvBody = stringify(rows, {
      header: true,
      columns: ["Section", "Question", "Answer", "AI Original", "Source"],
      quoted: true,
      record_delimiter: "\r\n",
    });

    // UTF-8 BOM so Excel opens special characters (em dashes, accents, the
    // "—" in "Web — verify") correctly instead of guessing a legacy codepage.
    const csvWithBom = "﻿" + csvBody;
    const dateStr = new Date().toISOString().slice(0, 10);
    const filename = `GTM_${slugify(project.productName || project.name)}_${dateStr}.csv`;

    return new NextResponse(csvWithBom, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Failed to export CSV" }, { status: 500 });
  }
}
