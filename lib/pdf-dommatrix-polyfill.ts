// lib/pdf-dommatrix-polyfill.ts
// Side-effect-only module — MUST be the very first import in any file that
// imports "pdf-parse" (see lib/tds-doc-extract.ts), before that import line.
// ES modules evaluate a file's own `import` declarations in the order
// they're written (depth-first), so importing this module first guarantees
// its top-level code below runs to completion before pdf-parse's own
// module graph (and therefore pdfjs-dist) ever loads.
//
// Root cause this fixes (confirmed live via real Vercel logs): pdf-parse's
// `pdfjs-dist` dependency ships a "legacy" Node build
// (pdfjs-dist/legacy/build/pdf.mjs) that references `DOMMatrix` as a bare
// global — a browser-only API with no equivalent in the Node.js runtime —
// for its internal page/viewport transform math, needed even for plain
// text extraction (getText()), not just rendering. Node never defines this
// global, so the reference throws `ReferenceError: DOMMatrix is not
// defined` the instant pdfjs-dist's module body evaluates, before any of
// our own route handler code runs. `@napi-rs/canvas` (already pdf-parse's
// OWN dependency, confirmed present in node_modules) implements a real,
// correct DOMMatrix — this just wires it onto `globalThis` ourselves, since
// pdf-parse apparently doesn't do so automatically.
//
// Wrapped in try/catch: if @napi-rs/canvas's native binding itself somehow
// fails to load on a given deployment platform, this degrades to "PDF
// extraction/upload will fail with an honest error" rather than crashing
// EVERY route that transitively imports this module (which is what was
// happening before this fix existed at all).
try {
  if (typeof (globalThis as any).DOMMatrix === "undefined") {
    const { DOMMatrix } = require("@napi-rs/canvas");
    (globalThis as any).DOMMatrix = DOMMatrix;
  }
} catch (err) {
  console.warn("[pdf-dommatrix-polyfill] Failed to load @napi-rs/canvas's DOMMatrix polyfill — PDF text extraction will fail gracefully instead of crashing at import time:", err);
}

export {};
