import { NextRequest, NextResponse } from "next/server";
import { uploadToDrive } from "@/lib/google-drive";
import { isSupabaseConfigured, supabaseAdmin } from "@/lib/supabase";
import { memoryDb } from "@/lib/memoryDb";

export async function POST(req: NextRequest) {
  try {
    const { projectId, projectName, outputType, content, fileName } = await req.json();

    const mimeType = fileName.endsWith(".pdf") ? "application/pdf"
                   : fileName.endsWith(".html") ? "text/html"
                   : "text/plain";

    const { fileId, webViewLink } = await uploadToDrive({
      content,
      fileName,
      mimeType,
      projectName: projectName || "Stylecraft Project",
      outputType: outputType || "Exports",
    });

    if (isSupabaseConfigured && projectId) {
      try {
        await supabaseAdmin
          .from("project_outputs")
          .update({ drive_url: webViewLink })
          .eq("project_id", projectId)
          .order("created_at", { ascending: false })
          .limit(1);
      } catch (e) {}
    } else if (projectId) {
      const output = memoryDb.outputs
        .filter(o => o.projectId === projectId)
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
      if (output) {
        output.driveUrl = webViewLink;
      }
    }

    return NextResponse.json({ fileId, webViewLink });
  } catch (err: any) {
    console.error("Drive upload route error:", err);
    return NextResponse.json({ error: err.message || "Drive upload failed" }, { status: 500 });
  }
}
