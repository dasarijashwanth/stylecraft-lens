// scripts/convert-product-videos.ts
// One-off script (run by hand — same category as scripts/convert-hero-
// videos.ts, which this mirrors exactly for a second wave of source
// videos). Converts the 3 uploaded product marketing videos sitting at the
// repo root into looped, muted, web-optimized MP4 (H.264) + WebM (VP9)
// pairs under public/video/, each capped at ~4MB per the background-video
// budget, plus a poster frame — per the "additive backgrounds" pass's
// asset pipeline (see lib/background-stage-config.ts).
//
// These are real 11-28s product feature clips (not the short seamless
// loops the first wave's 2 GIFs became) — target bitrate is computed per
// clip from its own duration so every output lands under the 4MB cap
// regardless of source length, rather than using one fixed CRF/bitrate for
// all three.
//
// Uses ffmpeg-static's bundled binary directly via child_process — no
// system ffmpeg install required.
//
// Run once: npx tsx scripts/convert-product-videos.ts
import { execFileSync } from "child_process";
import { existsSync, mkdirSync, statSync } from "fs";
import path from "path";
import ffmpegPath from "ffmpeg-static";

const ROOT = path.resolve(__dirname, "..");
const OUT_DIR = path.join(ROOT, "public", "video");
const POSTER_DIR = path.join(ROOT, "public", "images");

interface Job {
  src: string;
  outBase: string;
  durationSec: number; // pre-measured via ffprobe/ffmpeg -i (see repo research) — avoids a second ffprobe pass per job
}

const TARGET_TOTAL_BYTES = 3.8 * 1024 * 1024; // leave headroom under the 4MB cap for container/audio-free overhead
const AUDIO_KBPS = 0; // stripped entirely — backgrounds are always muted

const JOBS: Job[] = [
  { src: path.join(ROOT, "Homie Clipper-SC628B-Desktop-Horizontal-3features.mp4"), outBase: "product-homie-clipper", durationSec: 27.67 },
  { src: path.join(ROOT, "Homie Shaver - SC817B - Desktop - Horizontal.mp4"), outBase: "product-homie-shaver", durationSec: 10.92 },
  { src: path.join(ROOT, "X-Hybrid Titanium 2000 Hair Dryer - GP118RG - Horizontal - Desktop.mp4"), outBase: "product-xhybrid-dryer", durationSec: 19.93 },
];

// Even dimensions + downscale to 1280 wide (full-viewport background never
// needs source 1920x1080 fidelity — same reasoning as convert-hero-videos.ts's
// scale filter, extended with a width cap to help hit the size budget).
const SCALE_FILTER = "scale='min(1280,iw)':-2";

function run(args: string[]): void {
  execFileSync(ffmpegPath as string, args, { stdio: "inherit" });
}

function kbpsForBudget(durationSec: number): number {
  // TARGET_TOTAL_BYTES worth of bits, spread over the clip's duration.
  const totalBits = TARGET_TOTAL_BYTES * 8;
  const kbps = Math.floor(totalBits / durationSec / 1000);
  // Never request an ffmpeg-unreasonable/near-zero bitrate for a longer
  // clip — floor it, accepting a larger-than-ideal file for very long
  // sources rather than a garbled one (none of these 3 clips are long
  // enough to actually hit this floor, but keep it honest).
  return Math.max(300, kbps);
}

function convertMp4(src: string, out: string, kbps: number): void {
  run([
    "-y",
    "-i", src,
    "-vf", SCALE_FILTER,
    "-c:v", "libx264",
    "-b:v", `${kbps}k`,
    "-maxrate", `${Math.round(kbps * 1.2)}k`,
    "-bufsize", `${kbps * 2}k`,
    "-pix_fmt", "yuv420p",
    "-movflags", "+faststart",
    "-an",
    out,
  ]);
}

function convertWebm(src: string, out: string, kbps: number): void {
  run([
    "-y",
    "-i", src,
    "-vf", SCALE_FILTER,
    "-c:v", "libvpx-vp9",
    "-b:v", `${kbps}k`,
    "-an",
    out,
  ]);
}

function extractPoster(src: string, out: string): void {
  run([
    "-y",
    "-i", src,
    "-vf", SCALE_FILTER,
    "-frames:v", "1",
    "-q:v", "3",
    out,
  ]);
}

function main(): void {
  if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });
  if (!existsSync(POSTER_DIR)) mkdirSync(POSTER_DIR, { recursive: true });

  for (const job of JOBS) {
    if (!existsSync(job.src)) {
      throw new Error(`Source file not found: ${job.src}`);
    }
    const kbps = kbpsForBudget(job.durationSec);
    const mp4Out = path.join(OUT_DIR, `${job.outBase}.mp4`);
    const webmOut = path.join(OUT_DIR, `${job.outBase}.webm`);
    const posterOut = path.join(POSTER_DIR, `${job.outBase}-poster.jpg`);

    console.log(`[convert-product-videos] ${path.basename(job.src)} (${job.durationSec}s) -> target ${kbps}kbps`);
    convertMp4(job.src, mp4Out, kbps);
    convertWebm(job.src, webmOut, kbps);
    extractPoster(job.src, posterOut);

    const mp4Size = statSync(mp4Out).size;
    const webmSize = statSync(webmOut).size;
    const posterSize = statSync(posterOut).size;
    const mp4Mb = (mp4Size / 1024 / 1024).toFixed(2);
    const webmMb = (webmSize / 1024 / 1024).toFixed(2);
    console.log(`[convert-product-videos] done: ${job.outBase}.mp4 (${mp4Mb}MB), ${job.outBase}.webm (${webmMb}MB), ${job.outBase}-poster.jpg (${posterSize} bytes)`);
    if (mp4Size > 4 * 1024 * 1024 || webmSize > 4 * 1024 * 1024) {
      console.warn(`[convert-product-videos] WARNING: ${job.outBase} exceeded the 4MB cap on at least one format — review manually.`);
    }
  }
}

main();
