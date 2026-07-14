// Per-competitor phase4 task workers (Key Features / Strengths+Weaknesses /
// News / live product data) — the durable replacement for
// components/analyze/CompetitorCard.tsx's old on-mount client fetches
// (useAmazonProduct + the three enqueue()'d calls through
// lib/fetch-queue.ts's page-scoped, per-user concurrency cap). Each of
// these is its own Inngest function so `concurrency` is enforced by
// Inngest's own scheduler BEFORE any of this code runs, globally across
// every user's analysis — not just within one open browser tab.
//
// Each worker checks the circuit breaker before attempting its provider
// call, records the outcome after, and writes its own analysis_tasks
// checkpoint row — the analyze-product orchestrator calls these via
// step.invoke() (a durable function-to-function call) and doesn't need to
// know any of this bookkeeping itself.
import { inngest } from "../client";
import { markTaskRunning, markTaskDone, markTaskFailed } from "@/lib/db/analysis-tasks";
import { isProviderOpen, recordProviderResult, ProviderName } from "@/lib/circuit-breaker";
import { resolveProduct } from "@/lib/task-runners/resolve-product";
import { resolveReviewsCached } from "@/lib/task-runners/resolve-reviews";
import { resolveNewsCached } from "@/lib/task-runners/resolve-news";
import { resolveKeyFeaturesCached } from "@/lib/task-runners/resolve-key-features";

interface CompetitorTaskInput {
  jobId: string;
  taskKey: string;
  cacheKey: string;
  asin: string | null;
  productName: string;
  brand?: string | null;
}

// Shared checkpoint + circuit-breaker wrapper — every worker below follows
// the exact same shape: check breaker -> mark running -> do the provider
// call -> record success/failure -> checkpoint the task.
async function runGuarded<T>(
  jobId: string,
  taskKey: string,
  taskType: string,
  provider: ProviderName,
  fn: () => Promise<T>
): Promise<T | null> {
  if (await isProviderOpen(provider)) {
    await markTaskFailed(jobId, taskKey, `${provider} temporarily unavailable — will retry automatically`, {
      provider,
      errorClass: "provider_down",
    });
    return null;
  }

  await markTaskRunning(jobId, taskKey, taskType);
  const start = Date.now();
  try {
    const result = await fn();
    await recordProviderResult(provider, true);
    await markTaskDone(jobId, taskKey, result, { provider, latencyMs: Date.now() - start });
    return result;
  } catch (err: any) {
    await recordProviderResult(provider, false);
    const errorClass = /timeout|timed out/i.test(err?.message || "") ? "timeout"
      : /429|rate.?limit/i.test(err?.message || "") ? "rate_limited"
      : "unknown";
    await markTaskFailed(jobId, taskKey, err?.message || "Unknown error", { provider, errorClass, latencyMs: Date.now() - start });
    return null;
  }
}

export const fetchProductDataWorker = inngest.createFunction(
  { id: "fetch-product-data-worker", concurrency: { limit: 3 }, retries: 2, triggers: { event: "analysis/task.product.run" } },
  async ({ event }) => {
    const { jobId, taskKey, asin } = event.data as CompetitorTaskInput;
    if (!asin) {
      // No Amazon listing to verify — a real terminal state (not stuck
      // "pending" forever), so the UI can settle into its "ASIN
      // unavailable" display instead of showing a permanent skeleton.
      await markTaskDone(jobId, taskKey, null);
      return null;
    }
    return runGuarded(jobId, taskKey, "fetch_product_data", "rainforest", () => resolveProduct(asin));
  }
);

export const fetchReviewsWorker = inngest.createFunction(
  { id: "fetch-reviews-worker", concurrency: { limit: 3 }, retries: 2, triggers: { event: "analysis/task.reviews.run" } },
  async ({ event }) => {
    const { jobId, taskKey, cacheKey, asin, productName } = event.data as CompetitorTaskInput;
    return runGuarded(jobId, taskKey, "analyze_reviews", "rainforest", async () => {
      const { analysis } = await resolveReviewsCached(cacheKey, asin, productName);
      return analysis;
    });
  }
);

export const fetchNewsWorker = inngest.createFunction(
  { id: "fetch-news-worker", concurrency: { limit: 4 }, retries: 2, triggers: { event: "analysis/task.news.run" } },
  async ({ event }) => {
    const { jobId, taskKey, cacheKey, productName, brand } = event.data as CompetitorTaskInput;
    return runGuarded(jobId, taskKey, "fetch_news", "openai_web_search", async () => {
      const { result } = await resolveNewsCached(cacheKey, productName, brand ?? null);
      return result;
    });
  }
);

export const fetchFeaturesWorker = inngest.createFunction(
  { id: "fetch-features-worker", concurrency: { limit: 4 }, retries: 2, triggers: { event: "analysis/task.features.run" } },
  async ({ event }) => {
    const { jobId, taskKey, cacheKey, asin, productName } = event.data as CompetitorTaskInput;
    return runGuarded(jobId, taskKey, "fetch_key_features", "openai_web_search", async () => {
      const { result } = await resolveKeyFeaturesCached(cacheKey, productName, asin);
      return result;
    });
  }
);
