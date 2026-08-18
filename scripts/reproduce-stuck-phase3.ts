// scripts/reproduce-stuck-phase3.ts
// One-off — directly invokes the real runAnalysisStep against a specific,
// currently-stuck live analysis to see the actual error/behavior, rather
// than theorize. Makes REAL OpenAI/Gemini/web-search calls (deliberate,
// not a checked-in verify-*.ts test) — this analysis is already stuck in
// production, so this is a live reproduction, not a fresh cost.
import { readFileSync } from "fs";
import { resolve } from "path";

const envPath = resolve(process.cwd(), ".env.local");
const envContent = readFileSync(envPath, "utf-8");
envContent.split("\n").forEach(line => {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) return;
  const index = trimmed.indexOf("=");
  if (index === -1) return;
  const key = trimmed.substring(0, index).trim();
  let val = trimmed.substring(index + 1).trim();
  if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
    val = val.substring(1, val.length - 1);
  }
  process.env[key] = val;
});

const ANALYSIS_ID = "762b5bd5-367f-447d-8156-af96a108b4ff";

async function main() {
  const { runAnalysisStep } = await import("../lib/analysisEngine");
  console.log(`Invoking runAnalysisStep("${ANALYSIS_ID}") directly...`);
  const t0 = Date.now();
  try {
    const result = await runAnalysisStep(ANALYSIS_ID);
    console.log(`\nCompleted in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
    console.log(JSON.stringify(result, null, 2).slice(0, 3000));
  } catch (err: any) {
    console.log(`\nTHREW after ${((Date.now() - t0) / 1000).toFixed(1)}s:`);
    console.log(err?.message || err);
    console.log(err?.stack || "");
  }
}

main();
