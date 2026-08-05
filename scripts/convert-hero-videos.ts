// scripts/convert-hero-videos.ts
// One-off script (run by hand, not part of the normal dev loop — see CLAUDE.md's
// "other one-off scripts" convention). Converts the 2 source hero GIFs sitting at
// the repo root into looping MP4 (H.264) + WebM (VP9) pairs under public/video/,
// per the scroll-driven cinematic redesign plan's asset pipeline.
//
// Uses ffmpeg-static's bundled binary directly via child_process — no system
// ffmpeg install required, works identically on any dev machine or CI runner.
//
// Run once: npx tsx scripts/convert-hero-videos.ts
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
}

const JOBS: Job[] = [
  { src: path.join(ROOT, "asset-gif-1.gif"), outBase: "hero-1" },
  { src: path.join(ROOT, "asset-gif-2.gif"), outBase: "hero-2" },
];

// Even dimensions required by H.264/VP9 4:2:0 chroma subsampling — the source
// GIFs are 800x388 (odd height), so pad up to the nearest even height with the
// same frame duplicated (no crop, no upscale of real content).
const SCALE_FILTER = "scale=trunc(iw/2)*2:trunc(ih/2)*2";

function run(args: string[]): void {
  execFileSync(ffmpegPath as string, args, { stdio: "inherit" });
}

function convertMp4(src: string, out: string): void {
  run([
    "-y",
    "-i", src,
    "-vf", SCALE_FILTER,
    "-c:v", "libx264",
    "-pix_fmt", "yuv420p",
    "-movflags", "+faststart",
    "-an",
    out,
  ]);
}

function convertWebm(src: string, out: string): void {
  run([
    "-y",
    "-i", src,
    "-vf", SCALE_FILTER,
    "-c:v", "libvpx-vp9",
    "-b:v", "0",
    "-crf", "32",
    "-an",
    out,
  ]);
}

// A real still frame from the video itself (not an unrelated hero image) —
// used as the <video poster> and as the reduced-motion fallback image so
// HeroVideo.tsx's two render paths always show coherent content.
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
    const mp4Out = path.join(OUT_DIR, `${job.outBase}.mp4`);
    const webmOut = path.join(OUT_DIR, `${job.outBase}.webm`);
    const posterOut = path.join(POSTER_DIR, `${job.outBase}-poster.jpg`);

    console.log(`[convert-hero-videos] ${path.basename(job.src)} -> ${job.outBase}.mp4`);
    convertMp4(job.src, mp4Out);
    console.log(`[convert-hero-videos] ${path.basename(job.src)} -> ${job.outBase}.webm`);
    convertWebm(job.src, webmOut);
    console.log(`[convert-hero-videos] ${path.basename(job.src)} -> ${job.outBase}-poster.jpg`);
    extractPoster(job.src, posterOut);

    const mp4Size = statSync(mp4Out).size;
    const webmSize = statSync(webmOut).size;
    const posterSize = statSync(posterOut).size;
    console.log(`[convert-hero-videos] done: ${job.outBase}.mp4 (${mp4Size} bytes), ${job.outBase}.webm (${webmSize} bytes), ${job.outBase}-poster.jpg (${posterSize} bytes)`);
  }
}

main();
