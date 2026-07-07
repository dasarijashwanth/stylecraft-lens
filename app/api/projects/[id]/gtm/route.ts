import { NextRequest, NextResponse } from "next/server";
import { getAuthSession } from "@/lib/auth";
import { genAI, hasGeminiKey, GEMINI_MODEL, cleanJsonString } from "@/lib/gemini";
import { anthropic, hasAnthropicKey, ANTHROPIC_MODEL } from "@/lib/anthropic";
import { isSupabaseConfigured, supabaseAdmin } from "@/lib/supabase";
import { prisma } from "@/lib/db";
import { memoryDb } from "@/lib/memoryDb";
import { getProject } from "@/lib/db/projects";
import { getProjectReports, updateReport } from "@/lib/db/reports";
import { GTM_FIELD_SCHEMA, GtmFieldSource, ProductKnowledge } from "@/lib/gtm-field-schema";
import { deriveFieldsFromSources } from "@/lib/gtm-derive";

export const maxDuration = 60;

async function getOutputContent(projectId: string, outputType: "sales_kit" | "tds"): Promise<any | null> {
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

// Ensures product_knowledge always has somewhere to persist, even for a
// project that hasn't saved a competitive-analysis report yet — Sales
// Kit/TDS content alone can still answer a meaningful chunk of the 74 fields.
async function getOrCreateReport(projectId: string, userId: string, orgId: string, productName: string) {
  const existing = await getProjectReports(projectId, userId);
  if (existing && existing.length > 0) return existing[0];

  if (isSupabaseConfigured) {
    const { data, error } = await supabaseAdmin
      .from("reports")
      .insert({
        user_id: userId,
        project_id: projectId,
        title: `${productName} — Go-To-Market Knowledge`,
        status: "draft",
      })
      .select()
      .single();
    if (error) throw error;
    return data;
  }

  try {
    const report = await prisma.report.create({
      data: {
        orgId,
        projectId,
        title: `${productName} — Go-To-Market Knowledge`,
        content: {},
      },
    });
    return { id: report.id };
  } catch (e) {
    const id = `report_${Date.now()}`;
    memoryDb.reports.push({
      id,
      orgId,
      userId,
      projectId,
      title: `${productName} — Go-To-Market Knowledge`,
      content: {},
      status: "draft",
      fileUrl: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    return { id };
  }
}

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await getAuthSession();
    const reports = await getProjectReports(params.id, session.userId);
    const latest = reports?.[0];
    return NextResponse.json({ productKnowledge: latest?.product_knowledge ?? null, reportId: latest?.id ?? null });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Failed to load Go-To-Market data" }, { status: 500 });
  }
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await getAuthSession();
    const project = await getProject(params.id, session.orgId);
    if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });

    const [salesKit, tds] = await Promise.all([
      getOutputContent(params.id, "sales_kit"),
      getOutputContent(params.id, "tds"),
    ]);
    const report = await getOrCreateReport(params.id, session.userId, session.orgId, project.productName);

    const activeReport = {
      competitive_analysis: (report as any).competitive_analysis ?? {},
      pricing_analysis: (report as any).pricing_analysis ?? {},
      go_to_market: (report as any).go_to_market ?? {},
      content_form: (report as any).content_form ?? {},
    };
    const hasActiveReportContent = Object.values(activeReport).some(v => v && Object.keys(v).length > 0);

    const fieldList = GTM_FIELD_SCHEMA.map(f => `- ${f.id} [${f.section}]: ${f.question}`).join("\n");

    const systemInstruction = `You are a product-knowledge analyst filling out a retail Go-To-Market spec sheet for a hair/grooming tool.
Answer every field in the schema below using ONLY the information in the provided source documents (Sales Kit, Technical Data Sheet, Active Report). Never invent specs, dimensions, pricing, or claims not present in the sources.

FIELD SCHEMA (id [section]: question):
${fieldList}

Return ONLY valid JSON — no markdown, no explanation — keyed by field id:
{ "<field_id>": { "answer": "...", "source": "sales_kit" | "tds" | "active_report" | "multiple" | "none" } }

If the documents do not contain the answer for a field, return { "answer": "N/A", "source": "none" } for that field. Every field id listed above must appear in your response.`;

    const userContent = `<SALES_KIT>
${salesKit ? JSON.stringify(salesKit) : "(not generated for this project)"}
</SALES_KIT>

<TDS>
${tds ? JSON.stringify(tds) : "(not generated for this project)"}
</TDS>

<ACTIVE_REPORT>
${hasActiveReportContent ? JSON.stringify(activeReport) : "(no completed competitive analysis for this project)"}
</ACTIVE_REPORT>

Product: ${project.productName}
Industry: ${project.industry}
Description: ${project.description}`;

    let raw: Record<string, { answer: string; source: string }> | null = null;

    if (hasGeminiKey) {
      try {
        const message = await genAI.models.generateContent({
          model: GEMINI_MODEL,
          config: { systemInstruction, maxOutputTokens: 8192 },
          contents: userContent,
        });
        raw = JSON.parse(cleanJsonString(message.text || "{}"));
      } catch (err) {
        console.warn("Gemini GTM generation failed:", err);
      }
    }

    if (!raw && hasAnthropicKey) {
      try {
        const message = await anthropic.messages.create({
          model: ANTHROPIC_MODEL,
          max_tokens: 8192,
          system: systemInstruction,
          messages: [{ role: "user", content: userContent }],
        });
        const text = message.content.filter(b => b.type === "text").map((b: any) => b.text).join("\n");
        raw = JSON.parse(cleanJsonString(text || "{}"));
      } catch (err) {
        console.warn("Anthropic GTM generation failed:", err);
      }
    }

    // Deterministic, non-AI extraction from the source docs — this is what
    // backs the sheet whenever the AI is down/quota-exhausted, and the floor
    // every field falls back to before ever showing N/A.
    const derived = deriveFieldsFromSources(project.productName, salesKit, tds, activeReport);

    // Validate against the schema — every field must be present. Priority:
    // AI's answer (if real) > deterministic extraction > N/A. Never drop a
    // field, never invent one that isn't backed by an actual source.
    const fields: ProductKnowledge["fields"] = {};
    for (const f of GTM_FIELD_SCHEMA) {
      const got = raw?.[f.id];
      const aiAnswer = got?.answer?.trim();
      const aiUsable = !!aiAnswer && aiAnswer.toUpperCase() !== "N/A" && aiAnswer.toUpperCase() !== "TBD";

      if (aiUsable) {
        fields[f.id] = { answer: aiAnswer!, source: (got?.source as GtmFieldSource) || "multiple" };
      } else if (derived[f.id]) {
        fields[f.id] = derived[f.id];
      } else {
        fields[f.id] = { answer: "N/A", source: "none" };
      }
    }
    const completedCount = Object.values(fields).filter(f => f.source !== "none" && f.answer.toUpperCase() !== "N/A").length;

    const productKnowledge: ProductKnowledge = {
      fields,
      completedCount,
      generatedAt: new Date().toISOString(),
    };

    await updateReport((report as any).id, session.userId, { product_knowledge: productKnowledge });

    return NextResponse.json({ productKnowledge, reportId: (report as any).id });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Failed to generate Go-To-Market data" }, { status: 500 });
  }
}
