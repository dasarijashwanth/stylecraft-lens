import { NextRequest, NextResponse } from "next/server";
import { getAuthSession } from "@/lib/auth";
import { createDeckTemplate, listDeckTemplates } from "@/lib/db/deck-templates";
import { parseDeckTemplate } from "@/lib/deck-template-parser";
import { buildDefaultPlaceholderMap } from "@/lib/deck-field-registry";

// Cheap first line of defense against a zip-bomb .pptx (a tiny file that
// decompresses to gigabytes and exhausts the function's memory when
// PizZip parses it) — real branded templates run 10-20MB; this leaves
// generous headroom while still bounding worst-case blowup. Admin-only
// upload narrows the real risk further (a trusted role, not the public).
const MAX_TEMPLATE_SIZE_BYTES = 50 * 1024 * 1024;

export const maxDuration = 30;

function requireAdmin(role: string) {
  if (role !== "OWNER" && role !== "ADMIN") {
    throw Object.assign(new Error("Not authorized"), { status: 403 });
  }
}

export async function GET() {
  try {
    const session = await getAuthSession();
    requireAdmin(session.role);
    const templates = await listDeckTemplates();
    return NextResponse.json({ templates });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Failed to load deck templates" }, { status: err.status || 500 });
  }
}

// Parses the uploaded .pptx (pure XML/zip work, no AI call — safe to do
// synchronously in the request) and stores it with a default placeholder
// map built from the registry; unmapped tokens are surfaced in the
// response for the mapping screen, per the "flagged at upload, not
// discovered as blanks later" requirement.
export async function POST(req: NextRequest) {
  try {
    const session = await getAuthSession();
    requireAdmin(session.role);

    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    const name = (formData.get("name") as string) || file?.name || "Untitled template";
    if (!file) return NextResponse.json({ error: "No file uploaded" }, { status: 400 });
    if (file.size > MAX_TEMPLATE_SIZE_BYTES) {
      return NextResponse.json({ error: `Template file too large (max ${MAX_TEMPLATE_SIZE_BYTES / 1024 / 1024}MB)` }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const parsed = await parseDeckTemplate(buffer);
    const placeholderMap = buildDefaultPlaceholderMap(parsed);

    const template = await createDeckTemplate({
      name,
      fileBuffer: buffer,
      fileName: file.name,
      slideCount: parsed.slideCount,
      placeholderMap,
      uploadedBy: session.email,
    });

    return NextResponse.json({ template });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Failed to upload deck template" }, { status: err.status || 500 });
  }
}
