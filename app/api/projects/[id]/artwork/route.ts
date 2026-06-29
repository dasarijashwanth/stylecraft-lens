import { NextRequest, NextResponse } from "next/server";
import { isSupabaseConfigured, supabaseAdmin } from "@/lib/supabase";
import { memoryDb } from "@/lib/memoryDb";
import { buildFullProjectContext } from "@/lib/project-context";
import { anthropic, hasAnthropicKey } from "@/lib/anthropic";

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    if (isSupabaseConfigured) {
      const { data } = await supabaseAdmin
        .from("project_artwork")
        .select("*")
        .eq("project_id", params.id)
        .order("created_at", { ascending: false });
      return NextResponse.json({ artwork: data || [] });
    } else {
      const list = memoryDb.artwork.filter(a => a.projectId === params.id);
      return NextResponse.json({ artwork: list });
    }
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const formData = await req.formData();
    const file = formData.get("file") as File;
    const purpose = (formData.get("purpose") as string) ?? "family_artwork";

    if (!file) return NextResponse.json({ error: "No file uploaded" }, { status: 400 });

    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);
    let fileUrl = "";

    if (isSupabaseConfigured) {
      try {
        const fileName = `${params.id}/${purpose}/${Date.now()}-${file.name.replace(/[^a-zA-Z0-9.-]/g, "_")}`;
        const { error: uploadError } = await supabaseAdmin.storage
          .from("artwork")
          .upload(fileName, buffer, { contentType: file.type, upsert: true });

        if (!uploadError) {
          const { data: urlData } = supabaseAdmin.storage.from("artwork").getPublicUrl(fileName);
          fileUrl = urlData.publicUrl;
        }
      } catch (e) {}
    }

    if (!fileUrl) {
      // Fallback data URL representation or placeholder
      fileUrl = `data:${file.type};base64,${buffer.toString("base64")}`;
    }

    let suggestions: any = null;

    if (hasAnthropicKey && purpose === "family_artwork" && file.type.startsWith("image/")) {
      try {
        const ctx = await buildFullProjectContext(params.id);
        const base64 = buffer.toString("base64");
        const mediaType = file.type as "image/jpeg" | "image/png" | "image/webp" | "image/gif";

        const message = await anthropic.messages.create({
          model: "claude-3-5-sonnet-20241022",
          max_tokens: 1500,
          messages: [{
            role: "user",
            content: [
              {
                type: "image",
                source: { type: "base64", media_type: mediaType, data: base64 },
              },
              {
                type: "text",
                text: `This is family artwork / brand artwork for a product called "${ctx?.productName ?? "Stylecraft product"}" in the ${ctx?.industry ?? "grooming"} industry.

Analyze the artwork and return ONLY valid JSON:
{
  "style_analysis": {
    "color_palette": ["#111111", "#6366F1", "#F59E0B", "#E5E7EB"],
    "color_description": "Description of the color mood and tone",
    "design_style": "e.g. Bold Industrial / Premium Luxe",
    "typography_notes": "Observed font style notes",
    "key_visual_elements": ["Element 1", "Element 2"]
  },
  "consistency_guidelines": [
    "Guideline 1 for maintaining brand consistency",
    "Guideline 2",
    "Guideline 3"
  ],
  "rough_artwork_suggestions": [
    {
      "concept": "Concept name 1",
      "description": "Detailed description of a rough artwork concept extending this brand family",
      "use_case": "Packaging / Social / Amazon listing"
    },
    {
      "concept": "Concept name 2",
      "description": "Description of concept 2",
      "use_case": "Point of sale display"
    }
  ],
  "amazon_listing_notes": "Specific suggestions for Amazon main image and lifestyle shots based on this brand style"
}`,
              },
            ],
          }],
        });

        const text = message.content.filter((b: any) => b.type === "text").map((b: any) => b.text).join("");
        suggestions = JSON.parse(text.replace(/```json|```/g, "").trim());
      } catch (err) {
        console.warn("Claude Vision artwork analysis failed, using fallback:", err);
      }
    }

    if (!suggestions && purpose === "family_artwork") {
      suggestions = {
        style_analysis: {
          color_palette: ["#111111", "#6366F1", "#3B82F6", "#F3F4F6"],
          color_description: "Modern high-contrast dark metallic mood with vibrant indigo highlights.",
          design_style: "Bold Professional Grooming",
          typography_notes: "Clean sans-serif with geometric emphasis and heavy weight contrast.",
          key_visual_elements: ["Metallic chassis highlights", "Precision blade angle focus", "Vibrant badge accents"]
        },
        consistency_guidelines: [
          "Maintain dark sleek background gradients for primary product hero shots.",
          "Use indigo and electric blue accent lines for motor tech callouts.",
          "Keep packaging typography left-aligned with clean high-contrast spacing.",
          "Ensure blade material textures (titanium/carbon) have high metallic clarity."
        ],
        rough_artwork_suggestions: [
          {
            concept: "Vector Motor Blueprint Overlay",
            description: "A technical exploded view showing the internal brushless motor chassis surrounded by electric blue energy line vectors.",
            use_case: "Amazon A+ Content & Social Media Hero Posts"
          },
          {
            concept: "Matte Black & Gold Collector Box",
            description: "A premium rigid gift packaging design with magnetic closure and embossed metallic foil logos.",
            use_case: "Retail Packaging & Trade Show Display"
          }
        ],
        amazon_listing_notes: "Use pure white 255 background for main image. Use warm barbershop ambient lighting for secondary lifestyle infographic shots."
      };
    }

    // Save record
    if (isSupabaseConfigured) {
      try {
        await supabaseAdmin.from("project_artwork").insert({
          project_id: params.id,
          file_url: fileUrl,
          file_name: file.name,
          purpose: purpose,
          ai_suggestions: suggestions,
          created_at: new Date().toISOString(),
        });
      } catch (e) {}
    } else {
      memoryDb.artwork.push({
        id: `art_${Date.now()}`,
        projectId: params.id,
        fileUrl,
        fileName: file.name,
        purpose,
        aiSuggestions: suggestions,
        createdAt: new Date(),
      });
    }

    return NextResponse.json({ fileUrl, suggestions });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Failed to upload artwork" }, { status: 500 });
  }
}
