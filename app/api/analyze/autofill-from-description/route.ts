import { NextResponse } from "next/server";
import { getAuthSession } from "@/lib/auth";
import { autofillFromDescription } from "@/lib/analyze-form-autofill";
import { DescriptionAutofillSchema } from "@/lib/validations";

// Analyze form's "Positioning context" / "Key differentiating feature"
// autofill from the Product Description textarea — runs BEFORE an analysis
// exists (same "auth-only, no ownership check" precedent as the sibling
// app/api/products/preview/route.ts), so it takes productName/description
// straight from the form rather than reading an existing record.
export const maxDuration = 30;

export async function POST(request: Request) {
  try {
    await getAuthSession();
    const body = await request.json();
    const validation = DescriptionAutofillSchema.safeParse(body);
    if (!validation.success) {
      return NextResponse.json({ error: "VALIDATION_FAILED", message: "Validation failed", details: validation.error.flatten() }, { status: 400 });
    }

    const result = await autofillFromDescription(validation.data.productName, validation.data.description);
    return NextResponse.json(result);
  } catch (error: any) {
    return NextResponse.json({ error: "SERVER_ERROR", message: error.message }, { status: 500 });
  }
}
