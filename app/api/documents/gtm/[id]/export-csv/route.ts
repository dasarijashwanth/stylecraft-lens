import { NextRequest, NextResponse } from "next/server";
import { stringify } from "csv-stringify/sync";
import { getAuthSession } from "@/lib/auth";
import { getProject } from "@/lib/db/projects";
import { getDocumentById, getDocumentFields } from "@/lib/db/documents";
import { GTM_FIELD_SCHEMA, GTM_SOURCE_LABELS, type GtmFieldSource } from "@/lib/gtm-field-schema";

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

      let answer: string;
      if (entry?.flagged) {
        answer = "TBD — no source found";
      } else if (!trimmed || trimmed.toUpperCase() === "N/A") {
        answer = "N/A";
      } else {
        answer = trimmed;
      }

      const source = GTM_SOURCE_LABELS[(entry?.source as GtmFieldSource) || "none"] ?? GTM_SOURCE_LABELS.none;

      return [
        sanitizeCsvCell(`PRODUCT KNOWLEDGE — ${schemaField.section}`),
        sanitizeCsvCell(schemaField.question),
        sanitizeCsvCell(answer),
        sanitizeCsvCell(source),
      ];
    });

    const csvBody = stringify(rows, {
      header: true,
      columns: ["Section", "Question", "Answer", "Source"],
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
