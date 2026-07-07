import { NextRequest, NextResponse } from "next/server";
import { getAuthSession } from "@/lib/auth";
import { renderDocumentPdf, DocType, DocumentNotFoundError } from "@/lib/pdf/render";

export const maxDuration = 30;
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, { params }: { params: { type: string; id: string } }) {
  try {
    const session = await getAuthSession();
    const { buffer, fileName } = await renderDocumentPdf(params.type as DocType, params.id, session);

    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${fileName}"`,
      },
    });
  } catch (err: any) {
    const status = err instanceof DocumentNotFoundError ? err.status : 500;
    return NextResponse.json({ error: err.message || "Failed to export PDF" }, { status });
  }
}
