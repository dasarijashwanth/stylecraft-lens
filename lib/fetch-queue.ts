// Client-side concurrency-limited task queue — a single shared instance
// used by every CompetitorCard on the analysis page. With auto-load on
// mount, ~10 competitor cards × 3 sections (features/reviews/news) means
// up to 30 heavy external (scrape + AI) requests could fire at once
// without this; queuing keeps only a bounded number in flight while the
// rest wait their turn, same "worker pool" shape already used server-side
// (lib/analysisEngine.ts's mapWithConcurrency) for the same reason.
// Raised from 5 -> 8: Rainforest calls now fail fast on auth/credit errors
// instead of burning ~6s of retries each (lib/rainforest.ts's
// fetchWithRetry), so throughput is mostly gated by OpenAI web-search
// latency now — a higher slot count gets all 10 competitors through the
// queue in fewer rounds without meaningfully increasing rate-limit risk.
const MAX_CONCURRENT = 8;

let active = 0;
const waiting: (() => void)[] = [];

function acquire(): Promise<void> {
  if (active < MAX_CONCURRENT) {
    active++;
    return Promise.resolve();
  }
  return new Promise(resolve => waiting.push(resolve));
}

function release() {
  active--;
  const next = waiting.shift();
  if (next) {
    active++;
    next();
  }
}

export async function enqueue<T>(task: () => Promise<T>): Promise<T> {
  await acquire();
  try {
    return await task();
  } finally {
    release();
  }
}
