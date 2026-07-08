import { NextRequest, NextResponse } from "next/server";
import { buildFullProjectContext } from "@/lib/project-context";
import { isSupabaseConfigured, supabaseAdmin } from "@/lib/supabase";
import { memoryDb } from "@/lib/memoryDb";
import { callAiForJson } from "@/lib/ai-json-call";

export const maxDuration = 60;

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    if (isSupabaseConfigured) {
      const { data } = await supabaseAdmin
        .from("project_outputs")
        .select("content, html, drive_url, created_at")
        .eq("project_id", params.id)
        .eq("output_type", "sales_kit")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      return NextResponse.json({ kit: data?.content ?? null, html: data?.html ?? null, driveUrl: data?.drive_url ?? null });
    }

    const latest = memoryDb.outputs
      .filter(o => o.projectId === params.id && o.outputType === "sales_kit")
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];

    return NextResponse.json({ kit: latest?.content ?? null, html: latest?.html ?? null, driveUrl: latest?.driveUrl ?? null });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Failed to load Sales Kit" }, { status: 500 });
  }
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const ctx = await buildFullProjectContext(params.id);
    if (!ctx) return NextResponse.json({ error: "Project not found" }, { status: 404 });

    let kit = await callAiForJson<any>(
      `You are a professional sales copywriter creating a Sales Kit for a product.
Write EVERY field specifically about this exact product, its actual category, and its actual named competitors — never generic boilerplate that could apply to any product. Do not mention "battery" or "motor" unless the product description actually says so.
Return ONLY valid JSON — no markdown, no explanation.
{
  "tagline": "Short punchy product tagline",
  "elevator_pitch": "2-3 sentence elevator pitch",
  "key_features": [
    { "headline": "Feature name", "benefit": "What it means for the buyer" }
  ],
  "target_customers": ["Customer type 1", "Customer type 2", "Customer type 3"],
  "competitive_advantages": [
    { "vs": "Competitor name", "advantage": "Why our product wins, specific to that competitor's actual price/features" }
  ],
  "objection_handlers": [
    { "objection": "Common pushback specific to this product category", "response": "How to handle it" }
  ],
  "key_messages": ["Message 1", "Message 2", "Message 3"],
  "call_to_action": "Where to buy / next step"
}`,
      `Create a Sales Kit for:
Product: ${ctx.productName}
Description: ${ctx.description}
Price: ${ctx.pricePoint || "Contact for pricing"}
Target market: ${ctx.targetMarket}
Industry: ${ctx.industry}
Key differentiator: ${ctx.keyDiff}
Company: ${ctx.companyContext}

Top competitors (with prices):
${(ctx.competitorPrices || []).slice(0, 5).map((c: any) => `- ${c.name}: ${c.price ?? "—"}`).join("\n")}

Competitive advantages:
${(ctx.topOpportunities || []).slice(0, 3).map((o: any) => `- ${o.action}: ${o.description}`).join("\n")}

Positioning: ${ctx.positioning}

Key messages:
${(ctx.keyMessages || []).join(", ")}`,
      "Sales Kit"
    );

    if (!kit) {
      const motorLine = ctx.motorTech ? ` Powered by ${ctx.motorTech}.` : "";
      kit = {
        tagline: `${ctx.productName} — Built for ${ctx.targetMarket || "Professionals"}`,
        elevator_pitch: `${ctx.productName}${ctx.description ? `: ${ctx.description}` : ""} Engineered for ${ctx.targetMarket || "professional"} use in the ${ctx.industry || "grooming"} market.${motorLine}`,
        key_features: [
          { headline: ctx.keyDiff || "Key Differentiator", benefit: ctx.description || "Delivers reliable, professional-grade performance." },
          { headline: "Built for Daily Use", benefit: "Designed to hold up under repeated professional/commercial use." },
          { headline: "Competitive Value", benefit: `Priced at ${ctx.pricePoint || "a competitive point"} relative to the category.` }
        ],
        target_customers: ["Barbershop Owners", "Master Stylists", "Grooming Enthusiasts"],
        competitive_advantages: (ctx.topCompetitors || []).slice(0, 3).map((c: any) => ({
          vs: c.name || c.brand || "Competitor",
          advantage: `Competitive positioning at ${ctx.pricePoint || "a comparable"} price point${c.price ? ` vs their ${c.price}` : ""}.`
        })),
        objection_handlers: [
          { objection: "Why switch from established legacy brands?", response: "Modern engineering and design offer comparable or better reliability without legacy price inflation." },
          { objection: "How does this compare on price?", response: `At ${ctx.pricePoint || "this price point"}, it offers strong value against the named competitors above.` }
        ],
        key_messages: ctx.keyMessages.length > 0 ? ctx.keyMessages : [
          `Precision engineered for the ${ctx.industry || "professional"} market.`,
          "Reliable, professional-grade construction.",
          "Trusted choice for modern professionals."
        ],
        call_to_action: `Order ${ctx.productName} today or contact sales for volume commercial pricing.`
      };
    }

    const html = buildSalesKitHTML(ctx.productName, kit);

    // Save output record
    if (isSupabaseConfigured) {
      try {
        await supabaseAdmin.from("project_outputs").insert({
          project_id: params.id,
          output_type: "sales_kit",
          content: kit,
          html: html,
          created_at: new Date().toISOString(),
        });
      } catch (e) {}
    } else {
      memoryDb.outputs.push({
        id: `out_${Date.now()}`,
        projectId: params.id,
        outputType: "sales_kit",
        content: kit,
        html: html,
        createdAt: new Date(),
      });
    }

    return NextResponse.json({ kit, html });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Failed to generate Sales Kit" }, { status: 500 });
  }
}

function buildSalesKitHTML(productName: string, kit: any): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Sales Kit — ${productName}</title>
<style>
* { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; color: #111; background: #fff; }
.page { max-width: 800px; margin: 0 auto; padding: 48px 40px; }
.header { border-bottom: 3px solid #111; padding-bottom: 20px; margin-bottom: 32px; }
.brand { font-size: 11px; font-weight: 700; letter-spacing: 0.1em; text-transform: uppercase; color: #666; margin-bottom: 8px; }
h1 { font-size: 32px; font-weight: 700; margin-bottom: 8px; }
.tagline { font-size: 18px; color: #444; margin-bottom: 4px; }
h2 { font-size: 16px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; margin: 32px 0 14px; border-bottom: 1px solid #eee; padding-bottom: 6px; }
.elevator { font-size: 15px; line-height: 1.7; color: #333; background: #f9f9f9; border-left: 3px solid #111; padding: 14px 18px; border-radius: 0 6px 6px 0; }
.features-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
.feature-card { border: 1px solid #ddd; border-radius: 8px; padding: 14px; }
.feature-headline { font-weight: 600; font-size: 14px; margin-bottom: 4px; color: #111; }
.feature-benefit { font-size: 13px; color: #555; }
.comp-table { width: 100%; border-collapse: collapse; margin-top: 10px; }
.comp-table th, .comp-table td { border: 1px solid #ddd; padding: 10px 12px; text-align: left; font-size: 13px; }
.comp-table th { background: #f5f5f5; font-weight: 600; }
.comp-table td:first-child { font-weight: 500; }
.objections { display: flex; flex-direction: column; gap: 12px; }
.objection-card { border: 1px solid #ddd; border-radius: 6px; overflow: hidden; }
.objection-q { background: #fee2e2; color: #991b1b; padding: 8px 14px; font-size: 13px; font-weight: 500; }
.objection-a { background: #f0fdf4; color: #166534; padding: 8px 14px; font-size: 13px; }
.messages-list { display: flex; flex-direction: column; gap: 8px; }
.message-item { display: flex; gap: 10px; align-items: flex-start; font-size: 14px; }
.message-bullet { color: #6366F1; font-size: 18px; line-height: 1.4; flex-shrink: 0; }
.cta-box { background: #111; color: #fff; border-radius: 10px; padding: 24px 28px; margin-top: 32px; }
.cta-label { font-size: 11px; text-transform: uppercase; letter-spacing: 0.08em; opacity: 0.6; margin-bottom: 8px; }
.cta-text { font-size: 18px; font-weight: 600; }
.footer { margin-top: 48px; padding-top: 16px; border-top: 1px solid #eee; font-size: 11px; color: #aaa; display: flex; justify-content: space-between; }
@media print { body { padding: 0; } }
</style>
</head>
<body>
<div class="page">
  <div class="header">
    <div class="brand">STYLECRAFT LENS · Sales Kit</div>
    <h1>${productName}</h1>
    <div class="tagline">${kit.tagline}</div>
  </div>

  <h2>Elevator Pitch</h2>
  <div class="elevator">${kit.elevator_pitch}</div>

  <h2>Key Features & Benefits</h2>
  <div class="features-grid">
    ${(kit.key_features ?? []).map((f: any) => `
      <div class="feature-card">
        <div class="feature-headline">${f.headline}</div>
        <div class="feature-benefit">${f.benefit}</div>
      </div>`).join("")}
  </div>

  <h2>Competitive Advantages</h2>
  <table class="comp-table">
    <thead><tr><th>vs Competitor</th><th>Why We Win</th></tr></thead>
    <tbody>
      ${(kit.competitive_advantages ?? []).map((c: any) => `
        <tr><td>${c.vs}</td><td>${c.advantage}</td></tr>`).join("")}
    </tbody>
  </table>

  <h2>Objection Handlers</h2>
  <div class="objections">
    ${(kit.objection_handlers ?? []).map((o: any) => `
      <div class="objection-card">
        <div class="objection-q">❓ ${o.objection}</div>
        <div class="objection-a">✓ ${o.response}</div>
      </div>`).join("")}
  </div>

  <h2>Key Messages</h2>
  <div class="messages-list">
    ${(kit.key_messages ?? []).map((m: string) => `
      <div class="message-item">
        <span class="message-bullet">→</span>
        <span>${m}</span>
      </div>`).join("")}
  </div>

  <div class="cta-box">
    <div class="cta-label">Call to Action</div>
    <div class="cta-text">${kit.call_to_action}</div>
  </div>

  <div class="footer">
    <span>Generated by Stylecraft Lens</span>
    <span>${new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}</span>
  </div>
</div>
</body>
</html>`;
}
