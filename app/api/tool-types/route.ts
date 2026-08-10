import { NextRequest, NextResponse } from "next/server";
import { getAuthSession } from "@/lib/auth";
import { listToolTypes, addToolType } from "@/lib/db/tool-types";
import { textSimilarity } from "@/lib/text-similarity";
import { checkRateLimit } from "@/lib/rate-limit";

// Read-only GET, no admin gate — mirrors app/api/motor-families/route.ts's
// exact shape: the analyze/new-project forms need this to populate the Tool
// Type <select>. Authenticated (not public) only because middleware.ts
// already 401s every unauthenticated /api/** request.
export async function GET() {
  try {
    await getAuthSession();
    const toolTypes = (await listToolTypes()).filter(t => t.enabled);
    return NextResponse.json({ toolTypes });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Failed to load tool types" }, { status: err.status || 500 });
  }
}

function slugify(label: string): string {
  return label
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 50) || "custom_type";
}

// Similarity threshold tuned for short 1-3 word tool-type names (not
// lib/text-similarity.ts's BOILERPLATE_SIMILARITY_THRESHOLD=0.85, which is
// calibrated for long paragraph copy) — high enough that "Foil Shaper" vs
// "Foil Shaver" reliably flags, low enough that unrelated short names
// (e.g. "Trimmer" vs "Dryer") don't false-positive.
const DUPLICATE_SIMILARITY_THRESHOLD = 0.5;

// Deliberately NOT admin-gated — per the spec, any user hitting an
// unlisted tool category on the analyze/new-project forms can add it
// inline, same as picking from the existing list. Tool Type is a hard
// contamination gate (unlike Motor, which only scores), so a fuzzy-
// duplicate hit is a BLOCKING confirmation step here, not passive logging
// — the client must explicitly resubmit with confirmDuplicate:true to
// proceed once shown the close match.
export async function POST(req: NextRequest) {
  try {
    const session = await getAuthSession();

    // Security audit fix — deliberately NOT an admin gate (unchanged from
    // the existing by-design behavior above), but this writes a permanent
    // row into a global, cross-tenant taxonomy table with no rate limit at
    // all before this fix — any single account could spam it. A generous
    // per-hour cap preserves the intended "any user can add an unlisted
    // type inline" UX while bounding abuse.
    const rateLimit = await checkRateLimit({ eventType: "tool_type_create", userId: session.userId, maxAttempts: 20, windowMinutes: 60 });
    if (rateLimit.limited) {
      return NextResponse.json({ error: "RATE_LIMITED", message: `Too many new tool types added — please wait ${rateLimit.retryAfterMinutes} minutes and try again.` }, { status: 429 });
    }

    const { label, aliases, family, confirmDuplicate } = await req.json();
    const trimmedLabel = String(label || "").trim();
    if (trimmedLabel.length < 3 || trimmedLabel.length > 100) {
      return NextResponse.json({ error: "Name must be between 3 and 100 characters" }, { status: 400 });
    }
    if (family !== "clipper_trimmer_shaver" && family !== "beauty") {
      return NextResponse.json({ error: "family must be 'clipper_trimmer_shaver' or 'beauty'" }, { status: 400 });
    }
    const cleanAliases: string[] = Array.isArray(aliases)
      ? aliases.map((a: any) => String(a).trim()).filter(Boolean).slice(0, 20).map(a => a.slice(0, 100))
      : [];

    const existing = await listToolTypes();
    if (!confirmDuplicate) {
      let bestMatch: { label: string; type_key: string; score: number } | null = null;
      for (const t of existing) {
        const candidates = [t.label, ...t.aliases];
        for (const c of candidates) {
          const score = textSimilarity(trimmedLabel, c);
          if (score >= DUPLICATE_SIMILARITY_THRESHOLD && (!bestMatch || score > bestMatch.score)) {
            bestMatch = { label: t.label, type_key: t.type_key, score };
          }
        }
      }
      if (bestMatch) {
        return NextResponse.json(
          { error: "possible_duplicate", message: `Did you mean "${bestMatch.label}"?`, suggestion: bestMatch },
          { status: 409 }
        );
      }
    }

    let typeKey = slugify(trimmedLabel);
    if (existing.some(t => t.type_key === typeKey)) {
      typeKey = `${typeKey}_${Date.now().toString(36)}`;
    }

    const toolType = await addToolType({ typeKey, label: trimmedLabel, aliases: cleanAliases, family, custom: true });
    return NextResponse.json({ toolType });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Failed to add tool type" }, { status: err.status || 500 });
  }
}
