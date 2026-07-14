import { serve } from "inngest/next";
import { inngest } from "@/lib/inngest/client";
import { analyzeProduct } from "@/lib/inngest/functions/analyze-product";
import { fetchProductDataWorker, fetchReviewsWorker, fetchNewsWorker, fetchFeaturesWorker } from "@/lib/inngest/functions/phase4-workers";

// Inngest's cloud calls this endpoint once per step of a durable function
// run — each invocation is a normal, short Vercel function call, never the
// whole multi-phase pipeline in one request. GET is used for their
// dev-server/dashboard introspection, POST executes a step, PUT registers
// the function list with Inngest on deploy.
export const maxDuration = 60;

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [analyzeProduct, fetchProductDataWorker, fetchReviewsWorker, fetchNewsWorker, fetchFeaturesWorker],
});
