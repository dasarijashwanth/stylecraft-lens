// scripts/verify-ssrf-protection.ts
// Offline verification of lib/safe-fetch.ts's SSRF guards. Blocked cases
// (protocol/hostname/literal private IP) are rejected before any network
// call happens, so those assertions make zero network requests. The one
// "should still allow a real request" case hits https://example.com/ —
// IANA's dedicated, free, no-credential public test domain, not a paid
// provider — to prove legitimate URLs aren't collaterally blocked.
//
// Run with: npx tsx scripts/verify-ssrf-protection.ts
import { safeFetch, SsrfBlockedError } from "../lib/safe-fetch";

let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string) {
  if (condition) {
    passed++;
  } else {
    failed++;
    console.log(`✗ FAILED: ${message}`);
  }
}

async function assertBlocked(url: string, label: string) {
  try {
    await safeFetch(url);
    assert(false, `${label}: expected SsrfBlockedError, but the request was allowed through`);
  } catch (err) {
    assert(err instanceof SsrfBlockedError, `${label}: expected SsrfBlockedError, got ${(err as Error)?.constructor?.name}: ${(err as Error)?.message}`);
  }
}

async function main() {
  console.log("Blocked protocols...");
  await assertBlocked("ftp://example.com/file", "ftp://");
  await assertBlocked("file:///etc/passwd", "file://");
  await assertBlocked("javascript:alert(1)", "javascript:");
  await assertBlocked("gopher://example.com", "gopher://");

  console.log("Blocked literal private/reserved IPv4 addresses...");
  await assertBlocked("http://127.0.0.1/", "127.0.0.1 (loopback)");
  await assertBlocked("http://127.0.0.1:8080/admin", "127.0.0.1:8080 (loopback + port)");
  await assertBlocked("http://10.0.0.5/", "10.0.0.5 (RFC1918)");
  await assertBlocked("http://172.16.0.1/", "172.16.0.1 (RFC1918)");
  await assertBlocked("http://172.31.255.255/", "172.31.255.255 (RFC1918 upper bound)");
  await assertBlocked("http://192.168.1.1/", "192.168.1.1 (RFC1918)");
  await assertBlocked("http://169.254.169.254/latest/meta-data/", "169.254.169.254 (cloud metadata)");
  await assertBlocked("http://0.0.0.0/", "0.0.0.0");
  await assertBlocked("http://100.64.0.1/", "100.64.0.1 (CGNAT)");

  console.log("Blocked literal private IPv6 addresses...");
  await assertBlocked("http://[::1]/", "::1 (loopback)");
  await assertBlocked("http://[fe80::1]/", "fe80::1 (link-local)");
  await assertBlocked("http://[fc00::1]/", "fc00::1 (unique local)");
  await assertBlocked("http://[::ffff:127.0.0.1]/", "::ffff:127.0.0.1 (IPv4-mapped loopback)");
  await assertBlocked("http://[::ffff:169.254.169.254]/", "::ffff:169.254.169.254 (IPv4-mapped cloud metadata)");

  console.log("Blocked hostnames...");
  await assertBlocked("http://localhost/", "localhost");
  await assertBlocked("http://localhost.localdomain/", "localhost.localdomain");
  await assertBlocked("http://metadata.google.internal/computeMetadata/v1/", "metadata.google.internal");

  console.log("A legitimate public URL is still allowed through...");
  try {
    const res = await safeFetch("https://example.com/", { timeoutMs: 8000 });
    assert(res.ok, "https://example.com/ should respond 200 OK");
  } catch (err) {
    assert(false, `https://example.com/ should not be blocked: ${(err as Error).message}`);
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

main();
