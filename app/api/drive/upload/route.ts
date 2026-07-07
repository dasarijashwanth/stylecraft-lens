import { NextRequest, NextResponse } from "next/server";
import { uploadToDrive } from "@/lib/google-drive";
import { isSupabaseConfigured, supabaseAdmin } from "@/lib/supabase";
import { prisma } from "@/lib/db";
import { memoryDb } from "@/lib/memoryDb";
import { getAuthSession } from "@/lib/auth";
import { renderDocumentPdf, DocType, DocumentNotFoundError } from "@/lib/pdf/render";
import { getProjectReports } from "@/lib/db/reports";

export const maxDuration = 30;

const DOC_TYPE_FOLDER: Record<DocType, string> = {
  "sales-kit": "Sales Kit",
  tds: "Technical Data Sheet",
  gtm: "Go-To-Market",
  "active-report": "Active Report",
};
const OUTPUT_TYPE_MAP: Record<string, "sales_kit" | "tds"> = { "sales-kit": "sales_kit", tds: "tds" };

type DriveTarget =
  | { kind: "output"; rowId: string; existingFileId: string | null; memory?: boolean }
  | { kind: "report"; rowId: string; existingFileId: string | null; memory?: boolean }
  // GTM shares its `reports` row with Active Report, so its Drive info can't
  // live in that row's own drive_url/drive_file_id columns (saving one would
  // clobber the other's link) — it's nested inside product_knowledge instead.
  | { kind: "gtm"; rowId: string; existingFileId: string | null; productKnowledge: any; memory?: boolean };

async function resolveDriveTarget(docType: DocType, id: string, userId: string): Promise<DriveTarget | null> {
  if (docType === "sales-kit" || docType === "tds") {
    const outputType = OUTPUT_TYPE_MAP[docType];
    if (isSupabaseConfigured) {
      const { data } = await supabaseAdmin
        .from("project_outputs")
        .select("id, drive_file_id")
        .eq("project_id", id)
        .eq("output_type", outputType)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      return data ? { kind: "output", rowId: data.id, existingFileId: data.drive_file_id } : null;
    }
    const output = memoryDb.outputs
      .filter(o => o.projectId === id && o.outputType === outputType)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
    return output ? { kind: "output", rowId: output.id, existingFileId: output.driveFileId ?? null, memory: true } : null;
  }

  if (docType === "gtm") {
    const reportId = (await getProjectReports(id, userId))?.[0]?.id;
    if (!reportId) return null;
    if (isSupabaseConfigured) {
      const { data } = await supabaseAdmin.from("reports").select("id, product_knowledge").eq("id", reportId).maybeSingle();
      if (!data) return null;
      return { kind: "gtm", rowId: data.id, existingFileId: data.product_knowledge?.driveFileId ?? null, productKnowledge: data.product_knowledge };
    }
    const report = memoryDb.reports.find(r => r.id === reportId);
    if (!report) return null;
    return { kind: "gtm", rowId: report.id, existingFileId: report.product_knowledge?.driveFileId ?? null, productKnowledge: report.product_knowledge, memory: true };
  }

  // active-report
  if (isSupabaseConfigured) {
    const { data } = await supabaseAdmin.from("reports").select("id, drive_file_id").eq("id", id).maybeSingle();
    return data ? { kind: "report", rowId: data.id, existingFileId: data.drive_file_id } : null;
  }
  const report = memoryDb.reports.find(r => r.id === id);
  return report ? { kind: "report", rowId: report.id, existingFileId: report.driveFileId ?? null, memory: true } : null;
}

async function persistDriveInfo(target: DriveTarget, driveUrl: string, driveFileId: string) {
  if (target.kind === "output") {
    if (target.memory) {
      const output = memoryDb.outputs.find(o => o.id === target.rowId);
      if (output) { output.driveUrl = driveUrl; output.driveFileId = driveFileId; }
    } else {
      const { error } = await supabaseAdmin.from("project_outputs").update({ drive_url: driveUrl, drive_file_id: driveFileId }).eq("id", target.rowId);
      if (error) throw error;
    }
  } else if (target.kind === "report") {
    if (target.memory) {
      const report = memoryDb.reports.find(r => r.id === target.rowId);
      if (report) { report.driveUrl = driveUrl; report.driveFileId = driveFileId; }
    } else {
      const { error } = await supabaseAdmin.from("reports").update({ drive_url: driveUrl, drive_file_id: driveFileId }).eq("id", target.rowId);
      if (error) throw error;
    }
  } else if (target.kind === "gtm") {
    const updatedPK = { ...target.productKnowledge, driveUrl, driveFileId };
    if (target.memory) {
      const report = memoryDb.reports.find(r => r.id === target.rowId);
      if (report) report.product_knowledge = updatedPK;
    } else {
      const { error } = await supabaseAdmin.from("reports").update({ product_knowledge: updatedPK }).eq("id", target.rowId);
      if (error) throw error;
    }
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await getAuthSession();
    const { docType, id, replace } = await req.json() as { docType: DocType; id: string; replace?: boolean };

    const { buffer, productName, projectName, fileName } = await renderDocumentPdf(docType, id, session);
    const target = await resolveDriveTarget(docType, id, session.userId);

    const { fileId, webViewLink } = await uploadToDrive({
      content: buffer,
      fileName,
      mimeType: "application/pdf",
      projectName: projectName || productName || "Stylecraft Project",
      outputType: DOC_TYPE_FOLDER[docType],
      existingFileId: replace ? target?.existingFileId ?? null : null,
    });

    if (target) {
      await persistDriveInfo(target, webViewLink, fileId);
    }

    return NextResponse.json({ fileId, webViewLink, replaced: !!(replace && target?.existingFileId) });
  } catch (err: any) {
    const status = err instanceof DocumentNotFoundError ? err.status : 500;
    return NextResponse.json({ error: err.message || "Drive upload failed" }, { status });
  }
}
