"use client";

import { useEffect } from "react";

// Next.js's root-level error boundary — only fires when the ROOT layout
// itself throws (app/(app)/error.tsx below it handles every normal
// dashboard-page error; this is the last-resort fallback). Must render its
// own <html>/<body> since it replaces the root layout entirely when active.
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error("[global error boundary]", error);
  }, [error]);

  return (
    <html lang="en">
      <body style={{ background: "#0a0a0a", color: "#fff", fontFamily: "system-ui, sans-serif" }}>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", minHeight: "100vh", textAlign: "center", padding: "24px" }}>
          <h1 style={{ fontSize: "16px", fontWeight: 700, marginBottom: "8px" }}>Something went wrong</h1>
          <p style={{ fontSize: "13px", color: "#999", maxWidth: "360px", marginBottom: "20px" }}>
            The app hit an unexpected error. Try reloading — your data is safe.
          </p>
          <button
            onClick={reset}
            style={{ padding: "10px 18px", background: "#6366F1", color: "#fff", fontSize: "13px", fontWeight: 700, borderRadius: "8px", border: "none", cursor: "pointer" }}
          >
            Reload
          </button>
          {error.digest && <p style={{ marginTop: "16px", fontSize: "10px", color: "#666", fontFamily: "monospace" }}>Error ref: {error.digest}</p>}
        </div>
      </body>
    </html>
  );
}
