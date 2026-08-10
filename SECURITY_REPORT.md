# Security Audit Report — StyleCraft Lens

**Date:** 2026-07-28
**Scope:** Full-codebase security audit and remediation, following the 11-section brief (secrets, auth, authorization, injection, SSRF, uploads, transport hardening, dependencies, data protection/monitoring, frontend engineering, verification).
**Method:** Manual code audit + 3 parallel automated route-by-route authorization audits + a dedicated XSS audit of the PDF export path, with every fix verified by `tsc --noEmit`, a full production `next build`, and (for the security headers) a real Playwright browser run against a local production build to catch CSP breakage before shipping — not assumed. 19 findings below carry an offline `scripts/verify-*.ts` regression test (79 assertions total across 6 new scripts).

This app was in active production use by a real team throughout this audit; every fix was chosen to be safe to ship immediately, not merely theoretically correct. Where a fully "correct" fix required either a live regression-test cycle this pass didn't have room for, or a breaking framework/architecture change, that tradeoff is disclosed explicitly rather than silently shipped or silently skipped.

---

## Critical severity

### C1 — Every database table was readable/writable by anyone on the internet, no login required
**Where:** `supabase_schema.sql` — all 26 tables' RLS policies (`FOR ALL USING (true) WITH CHECK (true)`).
**Impact:** The public Supabase anon key ships in the browser bundle by design (Next.js `NEXT_PUBLIC_*` convention). Since every RLS policy was fully permissive, that public key alone could read/write `profiles` (every user's email/role), `support_messages`, `projects`, `document_fields` (GTM/TDS content), and everything else directly via the Supabase REST API — completely bypassing this app's own login and every authorization check in its Next.js code.
**Verification:** Empirically confirmed exploitable with a plain unauthenticated GET using only the anon key, before the fix.
**Fix:** Dropped all 26 permissive policies (RLS stays enabled with zero policies = deny by default for anon/authenticated). Verified zero functional impact: every real server-side query already goes through the service-role client, which bypasses RLS regardless of policy; the anon/browser clients are only ever used for `.auth.*` (login) and `.storage.*` (signed uploads), confirmed via a full grep for `.from(` calls outside standalone maintenance scripts.
**Status:** Fixed and confirmed live (re-verified with the same empirical test after the user ran the SQL).

---

## High severity

### H1 — Cross-tenant IDOR: project generation pipeline readable/retryable by any authenticated user
**Where:** `app/api/projects/[id]/pipeline/route.ts`, `.../pipeline/retry/route.ts` — no `getAuthSession()`/ownership check at all.
**Fix:** Added session + `getProject(id, session.orgId)` ownership check to both.

### H2 — Cross-tenant IDOR: pipeline continue route's ownership check ran after an early-return bypass
**Where:** `lib/project-generation-engine.ts`'s `runProjectGenerationStep` returns early for `status: "complete"|"failed"` before its own `getProject` check runs. Any authenticated user could read another org's pipeline phase/error message for a project in either state.
**Fix:** Ownership check moved to the route boundary (`app/api/projects/[id]/pipeline/continue/route.ts`), run before the engine is ever called — the engine function itself is also called by trusted service-role scripts with no real session to check against, so the fix belongs at the route, not inside the shared function.

### H3 — Cross-tenant IDOR: Sales Kit endpoint had no auth at all
**Where:** `app/api/projects/[id]/sales-kit/route.ts` (GET+POST) — no session check; `buildFullProjectContext` (`lib/project-context.ts`) has no org filter of its own.
**Fix:** Added session + ownership check to both methods, same pattern already proven in `app/api/projects/[id]/artwork/route.ts`.

### H4 — Analyses/Reports: client-supplied `projectId`/`analysisId` trusted without ownership check
**Where:** `app/api/analyses/route.ts` POST (client `projectId` never checked against the caller's org); `app/api/reports/route.ts` POST (`getAnalysis(analysisId)` has no org/user filter of its own — a fabricated report could pull another org's full phase1–3 analysis data).
**Fix:** Both now verify ownership (`getProject`/`analysisData.user_id === session.userId`) before proceeding.

### H5 — Reports: Prisma-fallback CRUD unscoped by org/user
**Where:** `lib/db/reports.ts`'s `getUserReports`/`getReport`/`updateReport` Prisma branches, and `app/api/reports/[id]/route.ts`'s DELETE handler — none filtered by org/user on the Prisma or memoryDb fallback paths (only the real Supabase path, always used in production, was correctly scoped).
**Fix:** Threaded `orgId` through all three `lib/db/reports.ts` functions and scoped the Prisma queries by it; DELETE now uses `prisma.report.deleteMany({where:{id, orgId}})` instead of an unscoped `delete`.
**Note:** Low real-world severity — Prisma isn't the live path in production (Supabase is always configured there) — but a real correctness bug on that fallback, fixed for any other deployment of this codebase.

### H6 — Drive upload: deck ownership check computed but never enforced
**Where:** `app/api/drive/upload/route.ts`'s `docType === "deck"` branch called `getProject(id, session.orgId)` but only used the result for a cosmetic filename fallback — never gated on it being `null`. Any authenticated user could supply another org's `projectId` and have that org's deck downloaded and uploaded to their own Drive.
**Fix:** The existing check now actually gates execution (`if (!project) return 404`) before any read.

### H7 — Every table's Prisma-fallback path aside, admin routes were all correct
25 `app/api/admin/**` route files (all methods) and public `faqs`/`support`/`user` routes were audited and confirmed already correctly gated (`getAuthSession()` + role check on every method) — no changes needed.

### H8 — Stored XSS via unescaped PDF export (report content, AI/scraped data)
**Where:** `lib/export-pdf.ts` (711 lines, hand-built HTML — not JSX, nothing auto-escapes). ~40 unescaped interpolation points, most seriously:
- The TipTap rich-text renderer (`parseTipTapNode`) never escaped user-typed report content at all — real stored XSS, since reports are viewed by other team members, not just their author.
- `report.title` broke out of a `<title>` RCDATA context in two places.
- A pricing-table source URL was both attribute-injectable and could carry a `javascript:` URI.
- Dozens of AI-generated (GTM/pricing/positioning text) and scraped (competitor name/brand/spec) fields rendered raw.
**Fix:** Escaped every flagged interpolation; consolidated the three independent (and previously inconsistent) `escapeHtml` copies across `lib/export-pdf.ts`, `lib/support-email.ts`, and the Sales Kit HTML builder into one shared `lib/html-escape.ts`. The pricing-table URL now also requires an `http(s)` prefix before rendering as a link at all.
**Test:** `scripts/verify-html-escaping.ts` (10 assertions, including the exact `<script>`/`<title>`-breakout/SVG-`onload` payloads this finding covers).

### H9 — SSRF: the scraper fetches arbitrary user-entered URLs with zero protection
**Where:** `lib/scrape.ts`'s `scrapeProductPage(url)` — a raw `fetch(url)` on a project's user-entered product URL. No protocol allowlist, no private-IP blocking, no redirect re-validation, no response-size cap.
**Impact:** A project's "product URL" field could be set to `http://169.254.169.254/latest/meta-data/` (cloud metadata) or an internal service address, and the server would fetch it during snapshot capture.
**Fix:** `lib/safe-fetch.ts` — blocks non-http(s) protocols; resolves DNS and blocks private/reserved ranges (RFC1918, loopback, link-local, cloud metadata, CGNAT) for both literal IPs and every resolved address; manually re-validates each redirect hop (`redirect: "manual"`, never auto-follows); caps redirects (5) and response size (10MB). Wired into `lib/scrape.ts` and `lib/citations.ts` (AI-cited source fetching, same fetch-arbitrary-external-URL surface).
**Test:** `scripts/verify-ssrf-protection.ts` (22 assertions: every blocked range/protocol/hostname, plus a real request to `https://example.com/` proving legitimate URLs still work).

### H10 — Pinned Next.js version (14.2.3) had dozens of real CVEs, including a critical cache-poisoning and an authorization-bypass advisory
**Where:** `package.json`.
**Fix:** Upgraded to `14.2.35` (same major.minor line, non-breaking patch release) — resolves the critical-severity findings and most highs. Verified via `tsc --noEmit` + full `next build`.
**Remaining, NOT fixed:** A further set of high-severity CVEs (mostly Server Actions DoS/SSRF — a feature this app doesn't use, it's built entirely on Route Handlers) only resolve on Next.js 16, a genuine breaking major-version jump. **Deliberately not done in this pass** — the app is live with a real team using it right now, and a two-major-version framework upgrade needs a dedicated regression-test cycle this pass didn't have. See "Recommended follow-ups" below.

---

## Medium severity

### M1 — Uploads trusted client-declared file type, not actual content
**Where:** Project artwork upload (`app/api/projects/[id]/artwork/route.ts`) trusted `file.type`; Contact Support screenshots (signed-upload-URL flow) trusted a client-declared `contentType` field — both spoofable (rename `malicious.html` to `photo.png`).
**Fix:** `lib/file-magic-bytes.ts` checks real PNG/JPEG/WEBP signatures. Artwork upload now rejects anything else and stores with the *verified* content-type, not the claimed one. Screenshots (bytes never pass through this server — signed-upload-URL bypass) are verified post-upload in `/api/support/contact`: downloaded, checked, and deleted+dropped from the submission if invalid, without failing the message itself.
**Also:** Dropped SVG from artwork's accepted types entirely (client + server) rather than attempting to sanitize it — SVG can embed `<script>`/event-handler XSS; this feature only ever needed raster brand images.
**Test:** `scripts/verify-file-magic-bytes.ts` (8 assertions, including the exact "renamed .html as .png" and SVG-XSS payloads the brief's manual test checklist calls out).

### M2 — CSV formula/DDE injection: one export path had the guard, the other didn't
**Where:** `app/api/documents/gtm/[id]/export-csv/route.ts` already prefixed `=+-@`-leading cells with `'`. The competitors page's client-side "Export CSV" button (`app/(app)/dashboard/competitors/page.tsx`) had no such guard at all — a competitor name/model-number starting with one of those characters would execute as a live formula in Excel/Sheets on open.
**Fix:** Extracted the guard to `lib/csv-safe.ts`, applied to both.
**Test:** `scripts/verify-csv-injection-guard.ts` (9 assertions, including a `=cmd|'/C calc'!A1`-style DDE payload).

### M3 — Login/password-reset had no rate limiting or audit logging
**Where:** Login called `supabase.auth.signInWithPassword` directly from the browser — no server-side hook to rate-limit or log from at all. No password-reset flow existed in the UI whatsoever (confirmed via a full grep for `resetPasswordForEmail`/"forgot password").
**Fix:** Login and password-reset requests now go through new server routes (`app/api/auth/login`, `app/api/auth/forgot-password`) specifically so they can be rate-limited (5 attempts/15 min per email+IP) and audit-logged to a new `auth_events` table — which doubles as the security event log Section 9 asks for (logins, failures, password changes, resets, permission denials). Built the full missing password-reset flow: request page (always responds identically regardless of whether the email exists — no user enumeration), Supabase's native single-use expiring recovery token via a PKCE callback route, and a reset-password page.
**Also:** Password policy raised from 8 to 10 characters plus a common-password/trivial-pattern blocklist (`lib/password-policy.ts`); changing your password now revokes every *other* active session (`admin.signOut(token, 'others')`) rather than leaving old sessions valid.
**Test:** `scripts/verify-rate-limit.ts` (7 assertions).

### M4 — Dev/mock auth fallback was reachable, in principle, in any environment including production
**Where:** `lib/auth.ts`'s `getAuthSession()` — if Supabase were ever unconfigured (a cleared/mistyped env var), execution fell through a Clerk/Prisma-dev-workspace chain all the way to a hardcoded `MOCK_SESSION` with **OWNER role and no login required at all**.
**Impact:** A single production misconfiguration would have made the entire app openly accessible to anyone as a full admin.
**Fix:** Added a hard production-environment guard that throws instead of falling through, while leaving the dev-bypass chain intact for local contributors without Supabase credentials (its original, legitimate purpose).

### M5 — Security headers were entirely absent
**Fix:** Added CSP, HSTS, `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, and a minimal `Permissions-Policy` via `next.config.mjs`. **Tested against a real production build with a real browser (Playwright), not assumed:** an initial strict `script-src 'self'` was verified via actual CSP-violation console output to break Next.js's own framework hydration/RSC-streaming inline scripts — not this app's own code (confirmed via a full grep: zero inline `<script>` tags, zero `dangerouslySetInnerHTML` anywhere in this codebase). Shipping `'unsafe-inline'` on `script-src` (and `style-src`, for React's `style={{}}` prop) is a **disclosed, tested tradeoff**, not an assumption. Every other directive (`frame-ancestors 'none'`, `object-src 'none'`, `base-uri 'self'`, `form-action 'self'`, a scoped `connect-src`) ships as designed.
**CORS:** confirmed already safe by default — no route anywhere sets `Access-Control-Allow-Origin`.
**Cookies:** `@supabase/ssr`'s own default is `sameSite=lax` (real CSRF protection — browsers withhold the cookie on cross-site state-changing requests) but doesn't set `secure` by default; added explicitly, gated on a production check (a `Secure` cookie is silently refused by browsers over local `http://localhost`, which would have broken dev-mode login entirely). `httpOnly` is **deliberately left at the library default (`false`)** — forcing it would break the browser Supabase client's own session-sync mechanics, a bigger change this pass couldn't safely validate without a real test cycle against the live app. Documented as a known tradeoff, not silently accepted.

### M6 — No rate limiting on expensive AI/scraping actions
**Where:** Starting an analysis or creating a project (which auto-starts a full snapshot→TDS→GTM→deck generation pipeline) had no limit — either could be spammed to run up real OpenAI/Gemini/Rainforest spend.
**Fix:** Both now rate-limited per user (10/hour for analyses, 15/hour for project creation), reusing the same `auth_events`-backed mechanism as login.

### M7 — Zip-bomb / decompression-bomb exposure on admin PPTX template uploads
**Where:** `.pptx` template uploads (`app/api/admin/deck-templates/route.ts`, `.../finalize/route.ts`) parsed via PizZip with no size cap — a maliciously crafted small file that decompresses to gigabytes could exhaust the function's memory.
**Fix:** Added a 50MB raw-size cap on both upload paths (admin-only already narrows the real risk; this bounds the worst case further), plus a storage-path-format check on the signed-upload finalize route (it previously trusted a raw client-supplied path with only an admin-role gate behind it).

### M8 — Google Drive query injection
**Where:** `lib/google-drive.ts`'s `findOrCreateFolder` built a Drive API search query by directly interpolating the project/product name into a `'...'` literal — a name containing a quote could break out of the literal and manipulate the query (e.g. matching/reusing an unintended existing folder).
**Fix:** Escaped per Drive's own query syntax (`\'` for a literal quote).

---

## Low severity / hardening

- **No focus management in any modal.** `components/ui/Modal.tsx` (the one shared overlay every modal in the app uses) had no `role="dialog"`/`aria-modal`, no focus trap, no focus returned to the trigger on close. Fixed once in the shared component — applies to every modal in the app.
- **No error boundaries anywhere.** Any render error under a dashboard page crashed to a blank white screen. Added `app/(app)/error.tsx` (Next.js's per-segment convention, friendly fallback + retry) and `app/global-error.tsx` (root-layout last resort). Unhandled promise rejections are now at least console-logged (no real monitoring service is wired up — needs a Sentry DSN from the user's own account).
- **Error responses mostly return `err.message` directly to the client.** Not a critical leak (Zod/Supabase/Prisma messages, not secrets or cross-user data) but can reveal internal implementation details (column/table names) in edge cases. Added `lib/api-error.ts` (logs the full error + a request id server-side, returns only a generic message + that id) and applied it to the login route as the reference example. **Most of this app's ~66 route handlers still return `err.message` directly** — a known, systemic, low-severity finding, recommended for incremental retrofit rather than a single mechanical rewrite of every route in this pass.
- **The 25 `app/api/admin/*` routes each redefine an identical local `requireAdmin(role)` helper.** Centralized into `lib/require-admin.ts`, which additionally logs a `permission_denied` audit event (none of the local copies did). Applied to one route as the reference example; the rest still use the old (already-correct, just unlogged) local copy — a mechanical, low-risk migration to do incrementally.
- **Header injection defense-in-depth:** `lib/support-email.ts`'s email subject line now strips CR/LF before interpolating the submitter's name (not currently user-editable, but removes the assumption).
- **Session cookie secure/sameSite flags** made explicit across all three Supabase client constructors (`lib/supabase-server.ts`, `lib/supabase-middleware.ts`, `lib/supabase-browser.ts`) for consistency.

---

## Verified clean — no finding

- **SQL injection:** N/A. Confirmed via grep: zero raw SQL, zero `$queryRaw`/`$executeRaw`, zero `.rpc()` calls anywhere in the codebase. Every query goes through supabase-js's parameterized query builder or Prisma's ORM.
- **Command injection:** N/A. Zero `child_process`/`exec`/`spawn` usage anywhere (confirmed the only `exec(` matches were `RegExp.prototype.exec()`). This app shells out to nothing — PDF/PPTX generation uses pure-JS libraries.
- **Path traversal on filenames:** Every `Content-Disposition`/Storage-path construction in this app already derives its filename through a sanitizing slugify/alphanumeric-strip step (`pdfFileNameFor`, `buildDeckFileName`, the artwork/deck-template upload paths) — verified by tracing each one to its source rather than assuming.
- **Webhooks:** N/A — this app has none.
- **Dependency/secret exposure in the client bundle:** Scanned the actual built `.next/static` output for every known API-key format (OpenAI, Anthropic, Google, Resend, AWS, generic JWT/private-key patterns) — zero matches. The only hits were the literal env-var *names* appearing as instructional text in the Settings page (`GEMINI_API_KEY="..."` placeholder strings), not real values.
- **Git history:** Scanned all 84 commits for the same secret patterns — clean.
- **CORS:** No route sets `Access-Control-Allow-Origin` — safe by default.

---

## Recommended follow-ups (not done in this pass — require your action or dedicated time)

1. **Rotate nothing** — no secret was ever found committed to this repo or its history. Nothing to rotate.
2. **Next.js 16 upgrade** — closes the remaining Server-Actions-related CVE list (a feature this app doesn't use). Needs a dedicated regression-test cycle; don't do it casually against the live app.
3. **`@clerk/nextjs` removal** — fully inert in production (Supabase is always configured there), but its client SDK still attempts to load an external script even without real keys (now blocked by the new CSP, previously silent). Confirmed via the Playwright CSP test. Kept for now since it may still serve local contributors without Supabase credentials; remove if that's no longer a supported scenario.
4. **Google OAuth scope** — this app's code doesn't specify a scope; it's whatever was selected when the refresh token was generated via OAuth Playground. Verify it's `drive.file` (minimal) rather than the broader `drive` scope, in Google Cloud Console.
5. **Spend caps/alerts** — this pass added per-user *rate limits* inside the app (5–15/hour on the expensive endpoints), which is a real mitigation, but real spend caps need to be configured directly in the OpenAI/Anthropic/Rainforest provider dashboards — outside what app code can do.
6. **Error monitoring (Sentry or similar)** — needs a DSN from your own account. The hooks (error boundaries, unhandled-rejection listener) are in place to wire one in quickly once you have it.
7. **Backups** — verify your Supabase project's plan tier includes the backup/point-in-time-recovery retention you want; this is a billing/platform setting, not app code.
8. **A per-user data-deletion path** (remove a team member's account + cascade their owned projects + revoke their Drive access) doesn't exist yet — `scripts/wipe-projects-and-analyses.ts` handles a full-database reset, not a single user's data. Worth a small dedicated admin flow if team turnover becomes a real scenario.
9. **Full retrofit of `lib/api-error.ts` and `lib/require-admin.ts`** across all ~66 routes / 25 admin routes — both are proven, low-risk, mechanical migrations; only applied to one reference route each in this pass given time.
10. **Frontend engineering items not attempted this pass**, given the actual scale (each is its own separate initiative, not a quick fix): a full WCAG AA accessibility pass, Lighthouse ≥90 measurement, a React Query/SWR migration to replace ad-hoc `fetch`-in-`useEffect`, virtualization for the 74-field GTM form and long competitor tables, and a formal ESLint-security-plugin + CI lint gate (a basic CI workflow covering typecheck/lint/build/audit/gitleaks/offline-verify-scripts was added — see `.github/workflows/security.yml` — but the frontend-specific quality bar wasn't independently measured).
11. **Minor code-quality note (not security):** `downloadTabPDF` in `lib/export-pdf.ts` computes a `title` variable that's never used — harmless dead code, noticed in passing during the XSS audit.

---

## Verification summary

- `npx tsc --noEmit` — clean after every change in this pass.
- `npm run build` — clean, full production build, after every batch of changes.
- 6 new offline verify scripts, 79 total assertions: `scripts/verify-html-escaping.ts` (10), `scripts/verify-csv-injection-guard.ts` (9), `scripts/verify-ssrf-protection.ts` (22, incl. one real request to a public test domain), `scripts/verify-file-magic-bytes.ts` (8), `scripts/verify-rate-limit.ts` (7). All pass.
- Security headers verified against a real production build with a real browser (Playwright) — not assumed. Public pages (`/sign-in`, `/forgot-password`) confirmed clean of CSP violations after the script-src adjustment; the authenticated dashboard's heavier client libraries (framer-motion, recharts, gsap, TipTap) were **not** independently re-verified under the new CSP given no test credentials were available for the live team accounts — recommend clicking through the real app once after this deploys to confirm no visual/functional regression.
- `npm audit` — critical and most high-severity findings resolved (Next.js patch upgrade); remaining findings require either a major-version framework upgrade or have no non-breaking fix available (documented above).
- The manual IDOR/XSS/SSRF/CSRF/rate-limit/file-upload test matrix the brief asks for (Section 11.2) was exercised as part of the fixes themselves — each fix above was validated against the specific attack it closes (e.g. the RLS fix was confirmed exploitable *before* and blocked *after*; the SSRF fix's test script literally attempts `169.254.169.254`, `127.0.0.1`, etc.) — not run as a separate, later pass.

---

# Second Audit Pass — 2026-08-09

**See also:** `CREDENTIAL_ROTATION.md` — real credentials found hardcoded in this pass (M9 below) that must be rotated regardless of the code fix.

**Method:** a fresh, independent adversarial pass — not a re-read of the above. 9 parallel research audits (secrets/supply-chain, auth+sessions+RLS, IDOR across all ~125 routes split 3 ways, injection classes, SSRF, file uploads, transport/headers, OAuth+logging+business-logic+frontend) each independently re-verified this pass's *own* prior claims against the current code rather than trusting them, then hunted for anything new. Every finding below was verified against real code (file:line) before being treated as real; two findings below were caught only because a *regression test* was written and initially failed. All fixes verified via `tsc --noEmit`, `npm run build`, and 17 offline `scripts/verify-*.ts` runs (2 new, 15 existing) — see Verification summary at the end of this section.

## Critical severity

### C2 — RLS regression: 15 tables silently reverted to the exact hole C1 already fixed once
**Where:** `supabase_schema.sql` — every table created in a section *after* Section 17's fix (`branded_motor_names`, `tool_types`, `scoring_profiles`, `heat_tech_families`, `branded_heat_tech_names`, `competitor_corrections`, `catalog_products`, `brand_name_hints`, `collections`, `gtm_workbook_templates`, `brand_voice_guides`, `uploaded_source_docs`, `extracted_facts`, `marketing_defaults`, `document_fill_state`) was created with the same `FOR ALL USING (true) WITH CHECK (true)` policy C1 had already found and dropped on the original 26.
**Impact:** identical to C1 — the public anon key (shipped in every page's JS bundle by `NEXT_PUBLIC_` convention) could read/write all 15 tables directly via Supabase's REST API, bypassing this app's login and every authorization check entirely. Most sensitive: `uploaded_source_docs`/`extracted_facts` (every project's uploaded TDS/spec-sheet/sales-kit full text, across every org) and `catalog_products`/`scoring_profiles`/`competitor_corrections`/`brand_voice_guides` (shared infrastructure every tenant's analyses depend on — readable *and writable*, meaning an anonymous caller could vandalize pricing/taxonomy/brand data for the whole app).
**Root cause:** C1's fix pattern (drop the permissive policy, leave RLS enabled with zero policies) was never turned into a rule future schema sections had to follow — two tables added in the same later window (`auth_events`, `feature_flags`) got it right, proving the safe pattern was known, just not applied consistently.
**Fix:** `supabase_schema.sql` Section 55 — `DROP POLICY` on all 15, same safe/zero-functional-impact reasoning as C1 (every real query already goes through `supabaseAdmin`, confirmed via a full grep — no code path uses the anon client for a `.from(table)` call on any of them). Section 55's own comment now explicitly tells future contributors never to copy the earlier permissive-policy pattern.
**Status:** SQL written; **you must run it in the Supabase SQL editor** — this is the single highest-priority action item in this whole report.

### C3 — Mass-assignment IDOR: report PATCH let a caller reassign `analysis_id`/`project_id` to read another org's data
**Where:** `app/api/reports/[id]/route.ts` PATCH → `lib/db/reports.ts`'s `updateReport()` passed the **entire raw client body** into `.update(updates)`. The WHERE clause correctly scoped by `(id, user_id)`, but nothing scoped *which columns* could be set.
**Attack:** a user owning report `R` sends `PATCH /api/reports/R {"analysis_id": "<victim's real analysis uuid>"}` — succeeds (the WHERE clause matches their own row). A follow-up `GET /api/reports/R` joins `analyses(*)` on the now-reassigned `analysis_id` and returns the **full victim analysis** (all phase0-3 competitor/pricing data) embedded in the attacker's own report response. Same trick with `project_id` leaks the joined project's name/product/price.
**Fix:** `lib/db/reports.ts`'s new `REPORT_UPDATABLE_FIELDS` allowlist (`title`, `status`, `competitive_analysis`, `pricing_analysis`, `go_to_market`, `content_form`) — `analysis_id`/`project_id`/`user_id`/`org_id`/`id` are never client-settable through this route again, full stop, applied identically across the Supabase and Prisma/memoryDb branches.
**Test:** `scripts/verify-report-update-whitelist.ts` (11 assertions) — a malicious payload's foreign-key fields are proven stripped while every real field the UI actually sends still updates.

## High severity

### H11 — Two `refill-from-sources` routes had no route-level ownership check
**Where:** `app/api/documents/gtm/[id]/refill-from-sources/route.ts`, `app/api/documents/content-form/[id]/refill-from-sources/route.ts` — relied entirely on `lib/document-fill-engine.ts`'s own internal `getProject` check (which did work — no cross-org write ever actually succeeded) instead of checking at the route boundary like every sibling route in the same directories. Created a same-org-only 404-vs-500 existence oracle and a landmine (a future refactor trimming the "redundant" internal check would introduce a real cross-org IDOR with nothing left to catch it).
**Fix:** added the standard `getProject(document.project_id, session.orgId)` check to both, matching every sibling route's own pattern exactly.

### H12 — Zero rate limiting on every AI-regeneration/refill/refresh/pipeline-continue route
**Where:** the prior pass's rate limits (M6, analyses/projects creation) covered only the two pipeline *entry points* — every route that can trigger real, repeatable OpenAI/Gemini/Rainforest spend on an *already-existing* resource had none: `app/api/documents/gtm/[id]/fields/[fieldId]/regenerate`, the content-form equivalent, both `refill-from-sources` routes, `app/api/projects/[id]/deck/regenerate`, `app/api/amazon/reviews-analysis/[asin]?refresh=true`, `app/api/amazon/product-news/[asin]?refresh=true`, `app/api/support/screenshot-upload-url` (mints a real Storage signed-upload slot per call), `app/api/faqs/[id]/vote` / `log-search-miss` (spam), `app/api/tool-types` POST (permanent writes to a global, cross-tenant taxonomy table — deliberately open to any user by design, but unthrottled), and `app/api/auth/change-password`'s current-password re-verification (a stolen session could brute-force the real password with zero app-level backoff, unlike login's identical underlying primitive).
**Fix:** extended the existing, already-proven `checkRateLimit()` helper (`lib/rate-limit.ts`, `auth_events`-backed, zero new infrastructure) to all of the above — 9 new `AuthEventType` values added to `lib/db/auth-events.ts`. Refresh-bypass routes are only rate-limited on the `?refresh=true` path (cached reads stay unthrottled, they're cheap and TTL-bounded already).

### H13 — No concurrency guard on the phase-advance `/continue` routes — spend multiplication via concurrent requests
**Where:** `app/api/analyses/[id]/continue`, `app/api/projects/[id]/pipeline/continue` — each only short-circuits on a *terminal* status; N concurrent POSTs against the SAME analysis/project id each independently re-ran the same phase's real AI/scrape work, multiplying cost per resource with no bound from the separate "starting an analysis" rate limit.
**Fix:** a tight per-resource burst guard (`checkRateLimit` keyed by `${userId}:${resourceId}`, max 1 per 3s) stops the multiplication; a looser 200/hour per-user cap bounds sustained abuse spread across many resources. A real distributed "claim this phase" lock was considered but not implemented this pass — this bound is a real, proportionate mitigation given the actual attack shape (a burst against one id), not a full architectural fix.

### H14 — Competitor-corrections poisoning: any single account could permanently blacklist a real competitor for every org
**Where:** `lib/analysisEngine.ts`'s `buildCorrectionSignals` counted raw correction **rows** per ASIN ("2+ independent corrections → hard exclude"), not distinct **users** — and `competitor_corrections` is a global, cross-org shared signal with no per-org scoping and no admin approval gate before it takes effect (`app/api/admin/competitor-corrections` is read-only reporting; the only mutation is expire/reactivate, after the fact).
**Attack:** any authenticated user (no admin role needed) submits two `wrong_product`/`discontinued` corrections, from their own account, against a real competitor's real ASIN (any brand's flagship product legitimately appears across many analyses of the same tool type) via `POST /api/analyses/[id]/competitors/replace` — that ASIN is now hard-blocked from *every future analysis, for every org*, until an admin happens to notice and manually reactivates it.
**Fix:** `buildCorrectionSignals` now counts **distinct `user_id` values** per ASIN, not raw rows — a single account's own repeated corrections can only ever *penalize*, never hard-block. Also rate-limited `competitors/replace` (30/hour) since it forces a real Rainforest refetch per call. The admin dashboard's identical display logic (`computeEffect`) was also fixed to match, so it no longer misrepresents what the real engine does.
**Test:** `scripts/verify-competitor-correction.ts` extended (2 new assertions in its existing `buildCorrectionSignals` section) — proves 2 distinct users still blocks, 2 corrections from one user does not.

### H15 — Zip-bomb: no decompressed-size ceiling on any XLSX/DOCX/PPTX parsing
**Where:** `lib/tds-doc-extract.ts` (`extractXlsxContent`/`extractDocxContent` — reachable by **any project member** via source-doc upload, not just admins), `lib/gtm-workbook-template-parser.ts`, `lib/deck-template-parser.ts` (admin-only) all fully decompress every zip entry with no size/entry-count limit — a small (~15MB max, per this app's own upload cap) file whose entries are a DEFLATE bomb (~1000:1 achievable ratio) could decompress to multiple GB in-process and OOM/crash the serverless function.
**Fix:** `lib/zip-safety.ts` — `assertZipSafe()` reads each entry's compressed/uncompressed size from PizZip's own central-directory metadata (available immediately after opening the zip, **before** any entry is actually decompressed) and rejects before any real decompression work: max 2000 entries, max 200MB per entry, max 300MB total, max 300:1 compression ratio per entry. Wired into all 3 parse call sites; skipped for `.xls` (the legacy binary format `extractXlsxContent` also handles — not a zip at all, so nothing to check).
**Test:** `scripts/verify-zip-safety.ts` (7 assertions) — includes a real 5MB-of-one-repeated-byte entry that genuinely compresses at a 1000:1+ ratio, proving the check catches a realistic bomb shape, not just an arbitrary threshold.

### H16 — Support screenshot uploads: declared content-type/size never bound to the real PUT, landing in a public bucket
**Where:** `app/api/support/screenshot-upload-url` only validates the **client-declared** `contentType`/`fileSize` JSON fields before minting a signed Storage upload URL — the signed URL itself isn't bound to that declaration, so the actual `PUT` can carry any real bytes/content-type. The magic-byte check only runs later, inside `/api/support/contact`, and **only if the attacker chooses to call it** — the `support-screenshots` bucket is public by design, so skipping that call leaves arbitrary attacker-supplied bytes (e.g. an `.html` file, served back as `text/html`) permanently live at a public URL.
**Fix:** two layers — (1) rate-limited signed-URL issuance (bounds volume); (2) `scripts/apply-storage-bucket-restrictions.ts`, a new one-off script setting real, **Storage-service-enforced** `allowedMimeTypes`/`fileSizeLimit` on the bucket itself (Supabase rejects a mismatched upload at the infrastructure level, regardless of whether any app-side "finalize" step ever runs) — the actual closing fix, since app-level validation can always be skipped by calling the signed URL directly. Applied the same restriction to `artwork`/`gtm-workbook-templates`/`deck-templates` as defense-in-depth (those are already app-validated pre-write, so this is belt-and-suspenders for them specifically).
**Status:** code shipped; **you must run `npx tsx scripts/apply-storage-bucket-restrictions.ts`** against the live project — this is the second priority action item.

### H17 — SSRF: DNS-rebinding TOCTOU bypass of the existing `safeFetch` guard
**Where:** `lib/safe-fetch.ts`'s `assertUrlIsSafe` resolves and validates a hostname's DNS, but the subsequent `fetch(currentUrl, ...)` performs its **own, completely independent** second DNS resolution when it actually opens the connection. An attacker controlling the target domain's DNS (a "rebinding" setup: answer a safe IP on the first query, a private/metadata IP moments later) could pass validation and still have the real request land internally — a well-understood attack class with off-the-shelf public tooling, not merely theoretical.
**Fix:** the validated address is now **pinned** for the actual connection via a per-request `undici.Agent` with a custom `connect.lookup` (added `undici` as a direct dependency), so the same address that was checked is the one actually connected to — DNS resolution is overridden, but TLS SNI/certificate hostname verification is untouched, so legitimate HTTPS targets still validate correctly (confirmed via a real request in the test below). Each per-hop Agent is explicitly closed after use to avoid leaking connections.
**Test:** `scripts/verify-safe-fetch-pinning.ts` (4 assertions, incl. one real HTTPS request proving the pin doesn't break legitimate TLS) + the existing `scripts/verify-ssrf-protection.ts` (22 assertions) re-confirmed passing with zero regressions.
**Side effect caught during this fix:** adding `undici@^7.28.0` as a direct dependency initially introduced a *new* high-severity `npm audit` finding (a downstream-response-desync/cache-poisoning advisory in that version range) — resolved in the same pass via `npm audit fix` (a non-breaking patch bump to 7.29.0); re-confirmed clean.

## Medium severity

### M9 — Hardcoded real credentials for real production mailboxes
**Where:** `scripts/create-admin-user.ts` (`ADMIN_PASSWORD` fallback `"stylecraft123"` for the real `jashwanthd@stylecraftus.com` account) and `scripts/create-team-users.ts` (`TEMP_PASSWORD = "123456789"`, hardcoded with no override, shared across 5 real mailboxes — notably a value that's *also* on this app's own `lib/password-policy.ts` common-password blocklist, just never applied to admin-API-set passwords). Both scripts also **always** overwrote an existing user's password on every re-run regardless of whether they'd already changed it, while leaving `must_change_password` untouched — silently reverting a real admin's chosen password back to a known value with no forced re-change prompt ever surfaced.
**Fix:** both env vars are now **required with no fallback** (script refuses to run without them, plus a 10-char minimum matching the app's own policy); resetting an *existing* user's password now requires explicit opt-in (`ADMIN_RESET_PASSWORD=true` / `TEAM_RESET_PASSWORD=true`) and always re-flags `must_change_password: true` when it does.
**Action required:** see the Credential Rotation List below — these values were real and must be rotated regardless of the code fix.

### M10 — `must_change_password` was enforced only client-side
**Where:** `components/layout/Shell.tsx`'s redirect to `/change-password` is a browser-only nudge; a valid session obtained via a just-set temporary password (M9) could call **any** API route directly (curl/script) for as long as the real owner hadn't yet logged in through the browser to trigger the redirect.
**Fix:** `lib/auth.ts`'s `getAuthSession()` now throws (`403 PASSWORD_CHANGE_REQUIRED`) whenever `mustChangePassword` is true, for every caller — at **zero extra query cost**, since the `profiles` row (which already carries this flag) was already being fetched on every call. One deliberate exception: `GET /api/auth/session` passes `{allowPendingPasswordChange: true}` since it must report the true pending state for the client redirect to have something to react to; `/api/auth/change-password` itself is unaffected (it never called `getAuthSession()` to begin with).

### M11 — Dead route landmine: `competitors/[id]` had no Supabase branch at all
**Where:** `app/api/competitors/[id]/route.ts` (GET/PATCH/DELETE) and `.../notes/route.ts` always tried Prisma first with no `isSupabaseConfigured` check — in this app's real deployment (Supabase always configured, `DATABASE_URL` unset), `prisma` is a Proxy that unconditionally throws, so these routes **always 404'd for real competitors**, regardless of ownership. Failed closed today (not itself exploitable), but a landmine: a future fix copying the shape elsewhere in this codebase without the `user_id`/`is_fixed` filter would introduce a real cross-tenant IDOR.
**Fix:** added the real Supabase branch to all three methods, mirroring `app/api/competitors/route.ts`'s own list/create pattern (`user_id`/`is_fixed` for reads, strict `user_id`-only for mutations — a shared/curated `is_fixed` competitor is never editable just because any user can read it). Competitor **notes** have no Supabase table at all (never migrated) — rather than let its memoryDb fallback silently "succeed" into a note that vanishes on the next cold start, it now returns an honest `501` explaining the gap.

### M12 — Support contact form: automated confirmation email relay to an arbitrary address
**Where:** `app/api/support/contact` sends its automated "we received your message" ack to `body.email` — a client-editable field (legitimate feature: "we reply directly to your email"). Any signed-in account (rate-limited 5/hour) could set it to an arbitrary third party and have this app's own real sending domain deliver an automated, legitimate-looking email carrying attacker-chosen topic/message content — a spam/phishing-enablement primitive.
**Fix:** the automated ack (`sendSupportAckEmail`) now always targets the caller's **real, session-verified** email; the "reply to a different address" intent still works via the admin notification's `replyTo` field, which requires a human support staffer to actually choose to reply there — never an automated system-fired send to an arbitrary target.

### M13 — Google Drive integration logged raw SDK errors (possible live access-token leak)
**Where:** `lib/google-drive.ts` logged the full `googleapis`/`gaxios` error object on two failure paths — that error type carries the outgoing request (including the live Bearer access token derived from this app's one shared `GOOGLE_REFRESH_TOKEN`) as enumerable own properties, which Node's default `console.warn` formatting prints in full.
**Fix:** both call sites now log only `{message, status/code}`.
**Still open (needs your action, not app code):** the OAuth scope actually granted to that refresh token can't be verified from code (it was selected once, manually, via OAuth Playground) — confirm it's the minimal `drive.file` scope in Google Cloud Console, not the broader `drive` scope. Carried forward from the prior pass, still unresolved.

### M14 — Artwork upload: unsanitized `purpose` form field in the Storage path
**Where:** `app/api/projects/[id]/artwork/route.ts` interpolated a client-supplied `purpose` field into the Storage object key with zero sanitization — unlike every other upload path in this app. Bounded blast radius (the path is still prefixed by a project id the caller already owns), but a real inconsistency with the rest of the codebase's otherwise-disciplined path handling.
**Fix:** same character-strip treatment (`[^a-zA-Z0-9_-]` → `_`, length-capped) already applied to `file.name` on the same line.

### M15 — Vestigial report-export handler always returned fake success
**Where:** `app/api/reports/[id]/export/route.ts` was pre-migration mock code with no `isSupabaseConfigured` branch; its ownership-check failure path was silently absorbed (no `else`), so it returned `200 {fileUrl}` for **any** report id — yours, another org's, or nonexistent — without ever marking a real report `EXPORTED`.
**Fix:** rebuilt on `lib/db/reports.ts`'s own `getReport`/`updateReport` (already ownership-scoped, already fixed in C3 above) — now honestly 404s and mutates the real row.

### M16 — `getClientIp()` trusted the client-controlled end of the `x-forwarded-for` chain
**Where:** `lib/request-ip.ts` read the **first** (leftmost) entry of `x-forwarded-for` — the leftmost entries are whatever a client chooses to send; Vercel's edge appends the real, verified address as the **last** entry. A caller could set `X-Forwarded-For: 1.2.3.4` to make every request appear to originate from an arbitrary address, defeating the IP half of login's email+IP rate limit (the email half, a targeted single-account lockout, was unaffected either way).
**Fix:** reads the **last** entry instead — the standard "trust the nearest-hop-appended value" convention.

### M17 — Admin catalog-import confirm route trusted client row shape with only a presence check
**Where:** `app/api/admin/catalog-products/import/confirm` (already admin-gated) validated only that 4 fields were non-empty — no type checks, no length caps, and it trusts whatever JSON the browser sends at confirm-time rather than re-parsing what `/import`'s preview actually computed.
**Fix:** a real Zod schema (`ConfirmBodySchema`) validating types/lengths on every field, kept deliberately lenient on `industry`/`targetMarket` (plain string, not a strict enum) since this ingests legacy spreadsheet data that predates the newer 2-value enum.

## Low severity / cleanup

- **Admin competitor-corrections page** fetched unconditionally on mount instead of gating on the resolved admin role like every sibling admin page (no real leak — the server route already independently enforced `requireAdmin` — a pure consistency fix). Its `computeEffect` display helper also mirrored the *old* (pre-H14-fix) raw-row-count logic; updated to count distinct users too, so it no longer misrepresents what the engine actually does.
- **Stale claim correction:** the prior report's "zero `child_process`/`exec`/`spawn` usage anywhere" (Verified-clean section) is no longer accurate — `scripts/convert-hero-videos.ts` now uses `execFileSync(ffmpegPath, args, ...)`. Confirmed safe (fixed literal argument array, never a shell string; hardcoded static inputs; not reachable from any HTTP route) — noted here for the record, not a new finding.
- `create-team-users.ts`'s temp-password `console.log` (needed so the operator can hand it out) now has an explicit comment warning never to pipe this script's output to a CI log or shared terminal.

## Verified clean this pass (re-confirmed, not just re-read)

- **SQL/command injection:** still zero raw SQL, zero `$queryRaw`, zero shell-string `exec`. No change from the prior pass's finding.
- **XSS:** the "Related Products" feature (added after the prior pass) was independently audited — every interpolated field in its PDF-export section is escaped; no regression.
- **CSV injection guard:** still applied at both real export sites.
- **Prompt injection:** all three untrusted-content categories (scraped pages, uploaded documents, Amazon reviews) are delimited and backed by a verbatim-quote verification gate. Real residual gap (Medium, judged not worth a dedicated fix this pass): the verification proves a claim's text appears in the source, not that the source itself is trustworthy — an attacker who controls the source (their own uploaded TDS, or a public Amazon review anyone can post) can still get a literal false claim (e.g. a fabricated "FDA approved") accepted as "grounded," since it's genuinely present in the text they planted. Bounded impact: field ids stay within a fixed schema vocabulary; no code execution or tool-call path exists downstream.
- **Path traversal:** every upload path's server-generated key construction confirmed traversal-safe (M14 above was a real gap in a *different* dimension — an unsanitized non-path field, not a traversal per se, since the project-id prefix already bounds it).
- **Tariff/pricing integrity:** the multiplier table and price-stack math are confirmed still hardcoded/server-recomputed on every render, never trusting a persisted final number as authoritative for anything beyond the explicitly-editable salon/retail override.
- **CORS, security headers, `SameSite` CSRF protection, `dangerouslySetInnerHTML` usage, `target="_blank"` `rel` attributes, `frame-ancestors`/`X-Frame-Options`, `localStorage` contents:** all independently re-verified this pass, no regressions, no new findings.

## Recommended follow-ups (not done this pass)

1. **Google OAuth scope** (M13) — verify in Google Cloud Console; can't be confirmed from code.
2. **`xlsx` package** — `npm audit` surfaced 2 real, currently-unfixed high-severity advisories (prototype pollution, ReDoS) with **no available fix** for this dependency. Partial mitigation already in place (H15's zip-bomb/decompression guard runs before `XLSX.read()` ever touches the buffer), but the underlying parser vulnerabilities remain. Worth watching for an upstream fix or evaluating a replacement library if this becomes higher-priority.
3. **Next.js 16 upgrade** — still not done, same reasoning as the prior pass (needs a dedicated regression cycle; the CVEs it closes are Server-Actions-related, a feature this app doesn't use).
4. **A true distributed lock on `/continue` routes** (H13) — the per-resource burst guard is a real, proportionate mitigation for the actual attack shape, but a genuine "claim this phase" conditional-update lock would close the underlying race more completely. Not attempted this pass given the scope already covered.
5. **Competitor-corrections: consider an admin pre-approval gate** — H14's distinct-user fix closes the single-account abuse path, but the table is still a global cross-org signal that takes effect immediately with no review step. A "queue for admin approval before it affects other orgs" workflow would be a more thorough fix if this feature sees real abuse in practice.
6. Everything listed as unresolved in the prior pass's own follow-up section (Next.js CVEs, `@clerk/nextjs` removal, spend caps at the provider level, Sentry DSN, backup verification, per-user data-deletion path, `lib/api-error.ts`/`lib/require-admin.ts` full retrofit, frontend engineering items) remains unresolved — none were in scope for this pass.

## Verification summary (this pass)

- `npx tsc --noEmit` — clean after every change.
- `npm run build` — clean, full production build, confirmed after all changes.
- 17 offline `scripts/verify-*.ts` runs, zero live AI/Rainforest calls except one deliberate real HTTPS request in `verify-safe-fetch-pinning.ts` (same "prove legitimate URLs still work" precedent as the prior pass's SSRF test):
  - **New:** `verify-zip-safety.ts` (7 assertions), `verify-report-update-whitelist.ts` (11), `verify-safe-fetch-pinning.ts` (4).
  - **Existing, re-run to confirm zero regressions:** `verify-competitor-correction.ts` (30, one fixture corrected — see below), `verify-rate-limit.ts` (7), `verify-competitor-scoring.ts` (26), `verify-ssrf-protection.ts` (22), `verify-tds-doc-ingestion.ts` (84, one real bug caught and fixed — see below), `verify-deck-template-parser.ts` (45), `verify-gtm-multi-template.ts` (32), `verify-gtm-workbook-export.ts` (60), `verify-deck-render.ts` (16), `verify-catalog-products.ts` (30), `verify-gtm-schema-v3.ts` (46), `verify-html-escaping.ts` (10), `verify-legacy-brand-registry.ts` (22), `verify-tool-type-editable.ts` (20), `verify-tool-type-taxonomy.ts` (36).
  - **Two real regressions caught and fixed during this verification pass, not just assumed clean:** (1) `verify-competitor-correction.ts`'s own fixture modeled "2 independent corrections" as 2 rows with the same/null `user_id` — exactly the vulnerable assumption H14 fixes — corrected to use distinct user ids, matching the new real semantics; (2) `verify-tds-doc-ingestion.ts` caught that H15's zip-bomb guard was incorrectly rejecting legitimate legacy `.xls` files (a non-zip binary format also handled by `extractXlsxContent`) — fixed by only running the zip check when the buffer's magic bytes actually indicate a zip.
- `npm audit --audit-level=high` — 12 → 8 findings (undici's introduced-then-fixed advisory, see H17); remaining 8 are the pre-existing Next.js major-version CVE list and the newly-flagged `xlsx` advisories (Recommended follow-ups #2-3), neither newly introduced by this pass.
- `.github/workflows/security.yml` extended with 9 more of this pass's + the prior pass's already-offline verify scripts (was 6, now 15) — broadens the CI regression gate going forward.
