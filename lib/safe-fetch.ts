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

async function assertUrlIsSafe(urlString: string): Promise<URL> {
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

  // A literal IP in the URL needs no DNS lookup.
  if (net.isIP(hostname)) {
    if (isPrivateIp(hostname)) throw new SsrfBlockedError(`Blocked private/reserved IP: ${hostname}`);
    return parsed;
  }

  let addresses: string[];
  try {
    const results = await dns.lookup(hostname, { all: true });
    addresses = results.map(r => r.address);
  } catch {
    throw new SsrfBlockedError(`DNS resolution failed for ${hostname}`);
  }
  if (addresses.length === 0) throw new SsrfBlockedError(`No addresses resolved for ${hostname}`);
  for (const addr of addresses) {
    if (isPrivateIp(addr)) throw new SsrfBlockedError(`Blocked private/reserved IP for ${hostname}: ${addr}`);
  }
  return parsed;
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
    await assertUrlIsSafe(currentUrl);

    const res = await fetch(currentUrl, {
      ...init,
      redirect: "manual",
      signal: AbortSignal.timeout(timeoutMs),
    });

    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get("location");
      if (!location) return capResponseSize(res, maxResponseBytes);
      currentUrl = new URL(location, currentUrl).toString();
      continue;
    }

    return capResponseSize(res, maxResponseBytes);
  }
  throw new SsrfBlockedError("Too many redirects");
}
