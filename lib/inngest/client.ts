// Durable background-job client — replaces the old "client polls /continue,
// server does one phase per HTTP request" architecture. Inngest's cloud
// calls back into app/api/inngest/route.ts once per step, so a single
// analysis run is never bound by any one Vercel function's execution
// timeout; each step invocation is its own short-lived request.
import { Inngest } from "inngest";

export const inngest = new Inngest({ id: "stylecraft-lens" });

export const hasInngestKeys = !!process.env.INNGEST_EVENT_KEY && !!process.env.INNGEST_SIGNING_KEY;
