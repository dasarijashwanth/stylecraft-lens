// Shared accessor for the latest generated Sales Kit / TDS content for a
// project (project_outputs table) — used anywhere that needs to read that
// content as a GTM/document generation source.
import { isSupabaseConfigured, supabaseAdmin } from "@/lib/supabase";
import { memoryDb } from "@/lib/memoryDb";

export async function getLatestOutput(projectId: string, outputType: "sales_kit" | "tds"): Promise<any | null> {
  if (isSupabaseConfigured) {
    const { data } = await supabaseAdmin
      .from("project_outputs")
      .select("content")
      .eq("project_id", projectId)
      .eq("output_type", outputType)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    return data?.content ?? null;
  }
  const latest = memoryDb.outputs
    .filter(o => o.projectId === projectId && o.outputType === outputType)
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
  return latest?.content ?? null;
}
