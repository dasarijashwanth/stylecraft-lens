// lib/safe-fetch.ts
// SSRF-safe fetch wrapper for every server-side request whose target URL
// is influenced by a user (a project's product URL) or by AI-provider
// search results the app didn't choose itself (lib/citations.ts's cited
// sources) — this app scrapes arbitrary external pages (lib/scrape.ts),
// which is exactly the class of feature that turns into a way to reach
// internal services/cloud metadata if left unguarded. Never use raw
// fetch() for a URL that didn't come from a fixed, hardcoded host (Amazon/
// OpenAI/Gemini/Resend/Google API calls elsewhere in this codebase target
// fixed hosts and don't need this).
import dns from "node:dns/promises";
import net from "node:net";
import { Agent } from "undici";

export class SsrfBlockedError extends Error {}

const MAX_REDIRECTS = 5;
const MAX_RESPONSE_BYTES = 10 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 8000;

const BLOCKED_HOSTNAMES = new Set(["localhost", "localhost.localdomain", "metadata.google.internal"]);

function isPrivateIPv4(ip: string): boolean {
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some(p => Number.isNaN(p))) return true; // malformed -> fail closed
  const [a, b] = parts;
  if (a === 127) return true; // loopback
  if (a === 10) return true; // 10.0.0.0/8
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
  if (a === 192 && b === 168) return true; // 192.168.0.0/16
  if (a === 169 && b === 254) return true; // 169.254.0.0/16 (incl. cloud metadata 169.254.169.254)
  if (a === 100 && b >= 64 && b <= 127) return true; // 100.64.0.0/10 (carrier-grade NAT)
  if (a === 0) return true; // 0.0.0.0/8
  if (a >= 224) return true; // multicast (224+) / reserved (240+)
  return false;
}

function isPrivateIPv6(ip: string): boolean {
  const lower = ip.toLowerCase();
  if (lower === "::1" || lower === "::") return true; // loopback / unspecified
  if (lower.startsWith("fe80:")) return true; // link-local
  if (lower.startsWith("fc") || lower.startsWith("fd")) return true; // unique local fc00::/7
  const mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isPrivateIPv4(mapped[1]);
  return false;
}

function isPrivateIp(ip: string): boolean {
  if (net.isIPv4(ip)) return isPrivateIPv4(ip);
  if (net.isIPv6(ip)) return isPrivateIPv6(ip);
  return true; // unrecognized format -> fail closed
}

interface SafeUrlResult {
  url: URL;
  // The exact IP address(es) validated as safe, to be PINNED for the
  // actual connection below — see the TOCTOU comment on safeFetch's main
  // loop for why this matters. Empty when the hostname itself was a
  // literal IP (nothing to pin beyond the URL's own hostname).
  pinnedAddresses: { address: string; family: 4 | 6 }[];
}

async function assertUrlIsSafe(urlString: string): Promise<SafeUrlResult> {
  let parsed: URL;
  try {
    parsed = new URL(urlString);
  } catch {
    throw new SsrfBlockedError("Invalid URL");
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new SsrfBlockedError(`Blocked protocol: ${parsed.protocol}`);
  }

  const hostname = parsed.hostname;
  if (BLOCKED_HOSTNAMES.has(hostname.toLowerCase())) {
    throw new SsrfBlockedError(`Blocked hostname: ${hostname}`);
  }

  // A literal IP in the URL needs no DNS lookup, and nothing to pin — the
  // connection can only ever go to the one address already in the URL.
  if (net.isIP(hostname)) {
    if (isPrivateIp(hostname)) throw new SsrfBlockedError(`Blocked private/reserved IP: ${hostname}`);
    return { url: parsed, pinnedAddresses: [] };
  }

  let results: { address: string; family: number }[];
  try {
    results = await dns.lookup(hostname, { all: true });
  } catch {
    throw new SsrfBlockedError(`DNS resolution failed for ${hostname}`);
  }
  if (results.length === 0) throw new SsrfBlockedError(`No addresses resolved for ${hostname}`);
  for (const r of results) {
    if (isPrivateIp(r.address)) throw new SsrfBlockedError(`Blocked private/reserved IP for ${hostname}: ${r.address}`);
  }
  return { url: parsed, pinnedAddresses: results.map(r => ({ address: r.address, family: r.family === 6 ? 6 : 4 })) };
}

// TOCTOU / DNS-rebinding fix — assertUrlIsSafe resolves and validates the
// hostname, but the runtime's own fetch() would otherwise perform a
// SECOND, completely independent DNS resolution when it actually opens the
// connection. An attacker controlling the target's DNS (a "rebinding"
// domain answering a safe IP on the first query, then a private/metadata
// IP on the very next one) could pass validation here and still have the
// real request land on the internal address moments later. Pinning the
// dispatcher's own `lookup` to the address(es) already validated above
// closes that gap — Node's global fetch still handles TLS SNI/certificate
// hostname verification normally (this only overrides DNS resolution, not
// the hostname used for the connection/handshake), so a legitimate HTTPS
// target's certificate still validates correctly.
function pinnedDispatcher(pinnedAddresses: { address: string; family: 4 | 6 }[]): Agent | undefined {
  if (pinnedAddresses.length === 0) return undefined;
  return new Agent({
    connect: {
      lookup: (_hostname, options, callback) => {
        const wantFamily = options.family === 6 ? 6 : options.family === 4 ? 4 : undefined;
        const matching = wantFamily ? pinnedAddresses.filter(a => a.family === wantFamily) : pinnedAddresses;
        const pool = matching.length > 0 ? matching : pinnedAddresses;
        callback(null, pool.map(a => ({ address: a.address, family: a.family })));
      },
    },
  });
}

async function capResponseSize(res: Response, maxBytes: number): Promise<Response> {
  if (!res.body) return res;
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new SsrfBlockedError(`Response exceeded ${maxBytes}-byte limit`);
    }
    chunks.push(value);
  }
  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new Response(body, { status: res.status, statusText: res.statusText, headers: res.headers });
}

export interface SafeFetchOptions extends Omit<RequestInit, "redirect"> {
  timeoutMs?: number;
  maxRedirects?: number;
  maxResponseBytes?: number;
}

// Drop-in replacement for fetch() against an untrusted/user-influenced URL:
// blocks non-http(s) protocols, resolves DNS and blocks private/reserved
// ranges (including cloud metadata), re-validates after every redirect hop
// (redirect: "manual" — never lets the runtime silently follow one into an
// internal address), caps redirect count and response size, and applies a
// timeout.
export async function safeFetch(urlString: string, opts: SafeFetchOptions = {}): Promise<Response> {
  const { timeoutMs = DEFAULT_TIMEOUT_MS, maxRedirects = MAX_REDIRECTS, maxResponseBytes = MAX_RESPONSE_BYTES, ...init } = opts;

  let currentUrl = urlString;
  for (let hop = 0; hop <= maxRedirects; hop++) {
    const { pinnedAddresses } = await assertUrlIsSafe(currentUrl);
    const dispatcher = pinnedDispatcher(pinnedAddresses);

    // Each hop mints its own per-request Agent (pinned to that hop's own
    // validated address) — it MUST be explicitly closed once this hop is
    // done with it, or its underlying socket/connection-pool handle is
    // left dangling. Closing only after the body is fully consumed below
    // (capResponseSize reads it) — closing earlier would tear down the
    // connection mid-read.
    const closeDispatcher = async (): Promise<void> => {
      if (!dispatcher) return;
      try {
        await dispatcher.close();
      } catch {
        // best-effort — never fail the real request over cleanup
      }
    };

    try {
      const res = await fetch(currentUrl, {
        ...init,
        redirect: "manual",
        signal: AbortSignal.timeout(timeoutMs),
        ...(dispatcher ? { dispatcher } : {}),
      } as RequestInit);

      if (res.status >= 300 && res.status < 400) {
        const location = res.headers.get("location");
        if (!location) {
          const result = await capResponseSize(res, maxResponseBytes);
          await closeDispatcher();
          return result;
        }
        // Redirecting to the next hop — this response's body is never
        // read; release it before moving on.
        await res.body?.cancel().catch(() => {});
        await closeDispatcher();
        currentUrl = new URL(location, currentUrl).toString();
        continue;
      }

      const result = await capResponseSize(res, maxResponseBytes);
      await closeDispatcher();
      return result;
    } catch (err) {
      await closeDispatcher();
      throw err;
    }
  }
  throw new SsrfBlockedError("Too many redirects");
}
