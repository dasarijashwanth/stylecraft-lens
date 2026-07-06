import { NextRequest, NextResponse } from "next/server";
import { buildFullProjectContext } from "@/lib/project-context";
import { genAI, hasGeminiKey, GEMINI_MODEL, cleanJsonString } from "@/lib/gemini";
import { isSupabaseConfigured, supabaseAdmin } from "@/lib/supabase";
import { memoryDb } from "@/lib/memoryDb";

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    let body: any = {};
    try { body = await req.json(); } catch (e) {}

    const ctx = await buildFullProjectContext(params.id);
    if (!ctx) return NextResponse.json({ error: "Project not found" }, { status: 404 });

    const userSpecs = body.specs ?? {};
    let tds: any = null;

    if (hasGeminiKey) {
      try {
        const message = await genAI.models.generateContent({
          model: GEMINI_MODEL,
          config: {
            systemInstruction: `You are a technical writer creating a Technical Data Sheet (TDS) for a grooming/hair tool product.
Return ONLY valid JSON:
{
  "product_name": "...",
  "model_number": "...",
  "version": "1.0",
  "specifications": {
    "motor": {
      "type": "e.g. EON Digital Brushless Motor",
      "speed_rpm": "e.g. 7,200 RPM",
      "torque": "e.g. High torque constant speed"
    },
    "battery": {
      "type": "e.g. Lithium-Ion",
      "capacity_mah": "e.g. 2,000 mAh",
      "runtime_minutes": "e.g. 120 minutes",
      "charge_time_minutes": "e.g. 90 minutes",
      "charge_type": "e.g. USB-C / Proprietary Dock"
    },
    "blade": {
      "material": "e.g. Black Diamond Carbon DLC / Titanium",
      "adjustment": "e.g. 0.8mm – 2.0mm zero-gap",
      "type": "e.g. Japanese Steel Taper Blade"
    },
    "dimensions": {
      "length_mm": "178 mm",
      "width_mm":  "45 mm",
      "weight_g":  "290 g"
    },
    "noise_level_db": "< 65 dB",
    "housing_material": "Ergonomic Metal / Heavy-duty ABS",
    "cord_type": "Cordless / Corded dual use"
  },
  "included_accessories": ["Magnetic guards (1.5mm - 13mm)", "Charging stand", "Cleaning brush", "Blade oil", "Custom lids"],
  "compatible_blades": ["Stylecraft Apex Taper Blade", "Deep Tooth Cutter"],
  "certifications": ["CE", "FCC", "RoHS", "UL Listed"],
  "warranty": {
    "duration": "2 Years Limited",
    "coverage": "Manufacturing and motor defects",
    "support": "stylecraftus.com/support"
  },
  "safety_notes": [
    "Always turn off power before changing blades or cleaning.",
    "Do not submerge motor housing in water.",
    "Use only certified manufacturer charging dock."
  ],
  "country_of_origin": "Designed in USA / Assembled in PRC",
  "msrp": "$180.00"
}`,
          },
          contents: `Create a TDS for:
Product: ${ctx.productName}
Motor: ${ctx.motorTech || "Brushless DC"}
Price: ${ctx.pricePoint || "$180"}
Description: ${ctx.description}
Company: ${ctx.companyContext}

User-provided specs:
${JSON.stringify(userSpecs)}`,
        });

        const text = message.text || "";
        tds = JSON.parse(cleanJsonString(text));
      } catch (err) {
        console.warn("Gemini TDS generation failed, using fallback:", err);
      }
    }

    if (!tds) {
      tds = {
        product_name: ctx.productName,
        model_number: `SC-${ctx.productName.substring(0, 3).toUpperCase()}-01`,
        version: "1.0",
        specifications: {
          motor: {
            type: ctx.motorTech || "High-Torque Brushless Motor",
            speed_rpm: "7,500 RPM",
            torque: "Constant speed digital torque control"
          },
          battery: {
            type: "Lithium-Ion Heavy Duty",
            capacity_mah: "2,500 mAh",
            runtime_minutes: "180 minutes",
            charge_time_minutes: "120 minutes",
            charge_type: "Universal USB-C & Charging Stand"
          },
          blade: {
            material: "Black Diamond Carbon DLC Titanium",
            adjustment: "0.0mm - 1.8mm zero-gap adjustable",
            type: "Precision Taper Blade"
          },
          dimensions: {
            length_mm: "175 mm",
            width_mm: "44 mm",
            weight_g: "285 g"
          },
          noise_level_db: "< 62 dB (Quiet Operation)",
          housing_material: "Heavy-duty full metal body with custom body lids",
          cord_type: "Corded / Cordless dual operation"
        },
        included_accessories: ["8 Magnetic Dub Guards", "Charging Stand", "USB-C Cord", "Cleaning Brush", "Mini Screwdriver"],
        compatible_blades: ["Standard Faper Blade", "Deep Tooth Cutter Blade", "Zero-Gap Fade Blade"],
        certifications: ["CE", "FCC", "RoHS", "Intertek ETL Listed"],
        warranty: {
          duration: "2 Years Limited Warranty",
          coverage: "Motor, circuit board, and battery defect protection",
          support: "stylecraftus.com/support"
        },
        safety_notes: [
          "Always disconnect from power charger before cleaning or blade alignment.",
          "Apply blade oil every 3-5 cuts to maintain low operating temperature.",
          "Store in dry environment away from liquid immersion."
        ],
        country_of_origin: "Designed in USA",
        msrp: ctx.pricePoint || "$180.00"
      };
    }

    const html = buildTDSHTML(tds);

    // Save output record
    if (isSupabaseConfigured) {
      try {
        await supabaseAdmin.from("project_outputs").insert({
          project_id: params.id,
          output_type: "tds",
          content: tds,
          html: html,
          created_at: new Date().toISOString(),
        });
      } catch (e) {}
    } else {
      memoryDb.outputs.push({
        id: `out_${Date.now()}`,
        projectId: params.id,
        outputType: "tds",
        content: tds,
        html: html,
        createdAt: new Date(),
      });
    }

    return NextResponse.json({ tds, html });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Failed to generate TDS" }, { status: 500 });
  }
}

function buildTDSHTML(tds: any): string {
  const specs = tds.specifications ?? {};
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>TDS — ${tds.product_name}</title>
<style>
* { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: Arial, Helvetica, sans-serif; font-size: 12px; color: #111; background: #fff; }
.page { max-width: 760px; margin: 0 auto; padding: 40px; }
.tds-header { display: flex; justify-content: space-between; align-items: flex-start;
              border-bottom: 2px solid #111; padding-bottom: 16px; margin-bottom: 24px; }
.tds-title { font-size: 22px; font-weight: 700; }
.tds-sub   { font-size: 12px; color: #666; margin-top: 4px; }
.tds-meta  { text-align: right; font-size: 11px; color: #666; }
h2 { font-size: 13px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em;
     background: #111; color: #fff; padding: 6px 12px; margin: 20px 0 10px; }
table { width: 100%; border-collapse: collapse; margin-bottom: 16px; }
th, td { border: 1px solid #ddd; padding: 7px 10px; text-align: left; font-size: 12px; }
th { background: #f5f5f5; font-weight: 600; width: 35%; }
.accessories { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 16px; }
.chip { border: 1px solid #ddd; border-radius: 4px; padding: 4px 10px; font-size: 11px; background: #fafafa; }
.safety-list { list-style: none; margin-bottom: 16px; }
.safety-list li { padding: 4px 0; padding-left: 16px; position: relative; }
.safety-list li::before { content: "⚠"; position: absolute; left: 0; font-size: 10px; color: #d97706; }
.footer { margin-top: 32px; padding-top: 12px; border-top: 1px solid #eee;
          font-size: 10px; color: #aaa; display: flex; justify-content: space-between; }
.doc-no { font-family: monospace; }
@media print { body { padding: 0; } }
</style>
</head>
<body>
<div class="page">
  <div class="tds-header">
    <div>
      <div class="tds-title">Technical Data Sheet</div>
      <div class="tds-sub">${tds.product_name} ${tds.model_number ? `· Model: ${tds.model_number}` : ""}</div>
    </div>
    <div class="tds-meta">
      <div>Version: ${tds.version ?? "1.0"}</div>
      <div>Date: ${new Date().toLocaleDateString("en-US", { year: "numeric", month: "long" })}</div>
      <div>STYLECRAFT LENS</div>
    </div>
  </div>

  <h2>Motor Specifications</h2>
  <table>
    <tr><th>Motor Type</th><td>${specs.motor?.type ?? "—"}</td></tr>
    <tr><th>Speed</th><td>${specs.motor?.speed_rpm ?? "—"}</td></tr>
    <tr><th>Torque</th><td>${specs.motor?.torque ?? "—"}</td></tr>
    <tr><th>Noise Level</th><td>${specs.noise_level_db ?? "—"}</td></tr>
  </table>

  <h2>Battery & Power</h2>
  <table>
    <tr><th>Battery Type</th><td>${specs.battery?.type ?? "—"}</td></tr>
    <tr><th>Capacity</th><td>${specs.battery?.capacity_mah ?? "—"}</td></tr>
    <tr><th>Runtime</th><td>${specs.battery?.runtime_minutes ?? "—"}</td></tr>
    <tr><th>Charge Time</th><td>${specs.battery?.charge_time_minutes ?? "—"}</td></tr>
    <tr><th>Charge Type</th><td>${specs.battery?.charge_type ?? "—"}</td></tr>
    <tr><th>Cord Type</th><td>${specs.cord_type ?? "—"}</td></tr>
  </table>

  <h2>Blade & Cutting</h2>
  <table>
    <tr><th>Blade Material</th><td>${specs.blade?.material ?? "—"}</td></tr>
    <tr><th>Blade Type</th><td>${specs.blade?.type ?? "—"}</td></tr>
    <tr><th>Adjustment Range</th><td>${specs.blade?.adjustment ?? "—"}</td></tr>
  </table>

  <h2>Physical & Pricing</h2>
  <table>
    <tr><th>Length / Width / Weight</th><td>${specs.dimensions?.length_mm || "—"} / ${specs.dimensions?.width_mm || "—"} / ${specs.dimensions?.weight_g || "—"}</td></tr>
    <tr><th>Housing Material</th><td>${specs.housing_material ?? "—"}</td></tr>
    <tr><th>Country of Origin</th><td>${tds.country_of_origin ?? "—"}</td></tr>
    <tr><th>MSRP</th><td>${tds.msrp ?? "—"}</td></tr>
  </table>

  <h2>Included Accessories</h2>
  <div class="accessories">
    ${(tds.included_accessories ?? []).map((a: string) => `<span class="chip">${a}</span>`).join("")}
  </div>

  <h2>Compatible Blades</h2>
  <div class="accessories">
    ${(tds.compatible_blades ?? []).map((b: string) => `<span class="chip">${b}</span>`).join("")}
  </div>

  <h2>Certifications</h2>
  <div class="accessories">
    ${(tds.certifications ?? []).map((c: string) => `<span class="chip">${c}</span>`).join("")}
  </div>

  <h2>Warranty & Support</h2>
  <table>
    <tr><th>Duration</th><td>${tds.warranty?.duration ?? "—"}</td></tr>
    <tr><th>Coverage</th><td>${tds.warranty?.coverage ?? "—"}</td></tr>
    <tr><th>Support Portal</th><td>${tds.warranty?.support ?? "—"}</td></tr>
  </table>

  <h2>Safety Information</h2>
  <ul class="safety-list">
    ${(tds.safety_notes ?? []).map((n: string) => `<li>${n}</li>`).join("")}
  </ul>

  <div class="footer">
    <span>STYLECRAFT LENS · Technical Data Sheet</span>
    <span class="doc-no">TDS-${(tds.product_name || "PROD").replace(/\s+/g, "-").toUpperCase()}-v${tds.version ?? "1.0"}</span>
  </div>
</div>
</body>
</html>`;
}
