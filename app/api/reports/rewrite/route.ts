import { NextResponse } from "next/server";
import { getAuthSession } from "@/lib/auth";
import { anthropic, hasAnthropicKey } from "@/lib/anthropic";

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
    
    let rewrittenText = text;
    
    if (hasAnthropicKey) {
      try {
        const instructions = {
          improve: "Improve clarity, readability, and professional impact while preserving the core meaning.",
          shorten: "Shorten the text to approximately half its length, removing wordiness while keeping key facts.",
          formalize: "Rewrite the text in highly formal, executive-level business consulting report language.",
        };
        
        const response = await anthropic.messages.create({
          model: "claude-3-5-sonnet-20241022",
          max_tokens: 1000,
          messages: [
            {
              role: "user",
              content: `${instructions[mode as "improve" | "shorten" | "formalize"]} Return ONLY the rewritten text with no introduction, no conversational text, and no quotes. Just the result.\n\nText: ${text}`,
            },
          ],
        });
        
        const textBlock = response.content.find(b => b.type === "text");
        if (textBlock && textBlock.type === "text") {
          rewrittenText = textBlock.text.trim();
        }
      } catch (err: any) {
        console.warn("Claude AI Rewrite failed, falling back to mock rewrite:", err);
        rewrittenText = getMockRewrite(text, mode);
      }
    } else {
      // Latency simulation for realistic feel in dev mode
      await new Promise(resolve => setTimeout(resolve, 800));
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
