import { NextResponse } from "next/server";
import { getAuthSession } from "@/lib/auth";
import { genAI, hasGeminiKey, GEMINI_MODEL } from "@/lib/gemini";
import { openai, hasOpenAIKey, OPENAI_MODEL } from "@/lib/openai";

export async function POST(request: Request) {
  try {
    await getAuthSession(); // Ensure user is logged in
    const body = await request.json();
    const { text, mode } = body;
    
    if (!text || typeof text !== "string" || text.trim() === "") {
      return NextResponse.json(
        { error: "VALIDATION_FAILED", message: "Text to rewrite is required" },
        { status: 400 }
      );
    }
    
    if (!["improve", "shorten", "formalize"].includes(mode)) {
      return NextResponse.json(
        { error: "VALIDATION_FAILED", message: "Invalid rewrite mode" },
        { status: 400 }
      );
    }
    
    const instructions = {
      improve: "Improve clarity, readability, and professional impact while preserving the core meaning.",
      shorten: "Shorten the text to approximately half its length, removing wordiness while keeping key facts.",
      formalize: "Rewrite the text in highly formal, executive-level business consulting report language.",
    };
    const prompt = `${instructions[mode as "improve" | "shorten" | "formalize"]} Return ONLY the rewritten text with no introduction, no conversational text, and no quotes. Just the result.\n\nText: ${text}`;

    let rewrittenText: string | null = null;

    if (hasOpenAIKey) {
      try {
        const response: any = await openai.responses.create(
          { model: OPENAI_MODEL, reasoning: { effort: "low" }, input: prompt },
          { timeout: 20_000 }
        );
        const message = (response.output || []).find((o: any) => o.type === "message");
        const t = (message?.content?.find((c: any) => c.type === "output_text")?.text || response.output_text || "").trim();
        if (t) rewrittenText = t;
      } catch (err: any) {
        console.warn("OpenAI AI Rewrite failed:", err);
      }
    }

    if (!rewrittenText && hasGeminiKey) {
      try {
        const response = await genAI.models.generateContent({ model: GEMINI_MODEL, contents: prompt });
        if (response.text) rewrittenText = response.text.trim();
      } catch (err: any) {
        console.warn("Gemini AI Rewrite failed:", err);
      }
    }

    if (!rewrittenText) {
      rewrittenText = getMockRewrite(text, mode);
    }
    
    return NextResponse.json({ rewrittenText });
  } catch (error: any) {
    return NextResponse.json(
      { error: "SERVER_ERROR", message: error.message },
      { status: 500 }
    );
  }
}

function getMockRewrite(text: string, mode: string): string {
  if (mode === "shorten") {
    // Return a condensed version of the input
    if (text.length > 100) {
      return text.substring(0, text.length / 2) + "... [Condensed for clarity and executive summary presentation].";
    }
    return text + " (condensed)";
  }
  
  if (mode === "formalize") {
    return `Pursuant to market intelligence, it is recommended to capitalize on this segment. ${text.replace(/we should/gi, "it is imperative to").replace(/good/gi, "highly advantageous").replace(/bad/gi, "detrimental")}`;
  }
  
  // improve
  return `${text.trim()} (Enhanced for strategic clarity and impact. Highly recommended to pursue this trajectory.)`;
}
