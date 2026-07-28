// lib/file-magic-bytes.ts
// Real content-type verification by file signature ("magic bytes"), not by
// trusting a client-supplied extension or Content-Type/contentType field —
// either of those can be spoofed trivially (rename malicious.html to
// photo.png, declare Content-Type: image/png). Used wherever this app
// accepts an image upload (project artwork, Contact Support screenshots).
export type DetectedImageType = "png" | "jpeg" | "webp" | null;

export function detectImageType(buffer: Buffer): DetectedImageType {
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return "png";
  }
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return "jpeg";
  }
  if (
    buffer.length >= 12 &&
    buffer.subarray(0, 4).toString("ascii") === "RIFF" &&
    buffer.subarray(8, 12).toString("ascii") === "WEBP"
  ) {
    return "webp";
  }
  return null;
}

export function isAllowedImage(buffer: Buffer, allowed: DetectedImageType[] = ["png", "jpeg"]): boolean {
  const detected = detectImageType(buffer);
  return detected !== null && allowed.includes(detected);
}
