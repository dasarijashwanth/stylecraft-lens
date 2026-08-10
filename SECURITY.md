# Security practices

This document describes how security works in this codebase, for whoever touches it next. See `SECURITY_REPORT.md` for the full audit history and findings this file's practices came out of.

## Reporting a vulnerability

Contact the project owner directly (jashwanthd@stylecraftus.com). This is a small internal team tool, not a public product — there's no formal bug bounty, but a real report is always welcome.

## Secrets

- All secrets live in environment variables only, never in code or committed files. `.env.local` is gitignored; `.env.example` documents every variable with a placeholder value.
- Required-in-production variables (Supabase, at least one AI provider) are checked by `lib/env.ts`, surfaced via `GET /api/health` — hit it after every deploy (or point an uptime monitor at it) to confirm nothing is misconfigured. It logs loudly (`console.error`/`warn`, visible in `vercel logs`) rather than crashing the app, since a false positive here would take down an already-live site.
- Before committing, never assume a `.env*` file is safe just because it's gitignored today — check `git status` for anything unexpected before staging.

## Authentication & sessions

- Real identity is Supabase Auth (GoTrue) — this app never stores or hashes a password itself. Session cookies are `sameSite=lax` (CSRF protection) and `secure` in production (see `lib/supabase-server.ts`/`lib/supabase-middleware.ts`/`lib/supabase-browser.ts`).
- Login and password-reset go through `app/api/auth/login` and `app/api/auth/forgot-password` (not a direct client-side Supabase call) specifically so they can be rate-limited (5 attempts/15 min per email+IP) and audit-logged to the `auth_events` table.
- Password policy: 10-character minimum + a common-password/trivial-pattern blocklist, enforced server-side in `lib/password-policy.ts`. Client-side `minLength` attributes are a UX hint only — never the real check.
- `lib/auth.ts`'s Clerk/Prisma-dev-workspace fallback chain exists **only** for local contributors without Supabase credentials, and is hard-blocked from ever activating in a production environment (`isProductionEnv` throws instead of falling through). Do not weaken that guard.

## Authorization

- Every route handler must call `getAuthSession()` before doing anything — it throws `"UNAUTHENTICATED"` if nobody's logged in (never returns a mock/guest session outside local dev). It also throws `"PASSWORD_CHANGE_REQUIRED"` (403) if the caller's `must_change_password` flag is set — the ONE exception is `GET /api/auth/session`, which passes `{allowPendingPasswordChange: true}` since it must report the true pending state for the client-side redirect to react to. Don't add a second exception without a real reason; the whole point is that nothing else should work until the password is changed.
- **Object-level ownership is not automatic.** `lib/db/projects.ts`'s `getProject(id, orgId)` returns `null` if the id doesn't belong to that org — every route touching a specific project/document/report/analysis by id must call it (or the equivalent `user_id`/`org_id` check) and 404 if it's null, **before** reading or writing anything. Several routes shipped without this check and were only caught by a dedicated audit — see `SECURITY_REPORT.md`'s High-severity findings for the exact pattern to avoid (computing the check but forgetting to actually gate on its result is the subtlest version of this bug). Relying SOLELY on a shared helper function's own internal ownership check (rather than also checking at the route boundary) has separately caused a same-org-only 404-vs-500 existence oracle — check at the route, even when a lower-level function also checks.
- **Never let a PATCH/PUT route pass the raw client body into a DB `.update()` call.** A caller updating their OWN row can still reassign a foreign-key column (`project_id`, `analysis_id`, etc.) to another org's real id if nothing scopes which *columns* can be set — a real mass-assignment IDOR found in this codebase (`lib/db/reports.ts`'s `updateReport`). Always allowlist the specific fields a route may update.
- Admin-only routes (`app/api/admin/**`) additionally require `session.role === "OWNER" || "ADMIN"` — use `lib/require-admin.ts` for new routes (it also audit-logs the denial); existing routes still have their own local copy of this check pending a mechanical migration.
- Never trust a `userId`/`orgId`/`role`/`email` field if the client sends one in a request body — always derive identity from `getAuthSession()`. This includes a "contact/reply-to email" style field: an automated email SENT to a client-supplied address (not just displayed) is a spam/phishing-relay primitive — send system-generated confirmations to the session-verified address, never a client-editable one.

## Row-Level Security (RLS) — a rule, not a one-time fix

- **Every new Supabase table must have RLS enabled with either NO policy at all, or a real policy scoped to `auth.uid()`/org.** Never copy the `CREATE POLICY ... USING (true) WITH CHECK (true)` pattern that appears in `supabase_schema.sql`'s early sections — those are dead, superseded definitions kept only so the file still runs top-to-bottom on a fresh database (see Sections 17 and 55's own comments). This exact permissive policy was found and fixed TWICE (Section 17 on the first 26 tables, Section 55 on 15 more added afterward) — it is the single most severe class of bug this app can ship, because the public anon key that makes it exploitable ships in the browser bundle by design and there is no way to "just not expose it."
- If a table is only ever queried via `supabaseAdmin` (the service-role client, which bypasses RLS regardless of policy — true for nearly every table in this app), the correct policy is **no policy at all** (RLS enabled, zero policies = deny by default for `anon`/`authenticated`).
- Before trusting that this holds, you can empirically check: grep for `{ supabase }` (the anon-key client, not `supabaseAdmin`) imported from `@/lib/supabase` — it should only ever be used for `.auth.*`/`.storage.*` calls, never `.from(table)`.

## Rate limiting on the FULL abuse surface, not just entry points

- Rate-limiting the "start" of a flow (creating an analysis, creating a project) is not sufficient — every route that can **repeat** real AI/scrape spend against an *already-existing* resource needs its own limit too: per-field regenerate routes, bulk refill-from-sources routes, deck regeneration, any cache-bypass (`?refresh=true`-style) parameter, and presigned-upload-URL issuance (each call is a real Storage write even if the upload never completes). Use `lib/rate-limit.ts`'s `checkRateLimit()` — add a new `AuthEventType` in `lib/db/auth-events.ts` for each new limited action.
- For a route that can be called **concurrently** against the SAME resource id (a phase-advance/"continue" polling route), a per-user hourly cap alone doesn't stop N simultaneous requests from each re-running the same expensive work before any of their rate-limit counters land. Add a tight per-resource burst guard too — key `checkRateLimit` by `${userId}:${resourceId}` with a very short window (seconds, not minutes) in addition to the normal per-user cap.

## Zip-bomb / decompression-bomb guard

- Any time this app parses an uploaded `.xlsx`/`.docx`/`.pptx` (all OOXML zips) with PizZip or the `xlsx` package, call `lib/zip-safety.ts`'s `assertZipSafe()` (or `isZipSafe()`) **before** any entry's content is actually read/decompressed — it checks PizZip's own central-directory metadata (entry count, per-entry and total uncompressed size, compression ratio), which is available with zero real decompression work. Skip it only for genuinely non-zip formats (e.g. legacy binary `.xls`/`.doc` — check the buffer's magic bytes first if a function handles both a zip and a non-zip format, like `lib/tds-doc-extract.ts`'s `extractXlsxContent` does).

## SSRF: DNS resolution must be PINNED for the real request, not just checked

- `lib/safe-fetch.ts`'s `safeFetch()` validates a target's resolved DNS addresses, but if the actual `fetch()` call is left to re-resolve DNS on its own, that's a TOCTOU gap — a DNS-rebinding attacker can pass validation and still have the real connection land on a different (private/internal) address moments later. `safeFetch` now pins the validated address via a per-request `undici.Agent` with a custom `connect.lookup`; if you ever build a second SSRF-safe fetch path, do the same — checking DNS without pinning it for the connection isn't a real fix.

## Credential-issuing scripts

- Any `scripts/*.ts` that sets or resets a real user's password (`create-admin-user.ts`, `create-team-users.ts`) must require the password as an env var with **no hardcoded fallback** — a value baked into the script IS a permanently-exposed credential the moment it's committed, regardless of `.env.local` being gitignored. Resetting an **existing** user's password must be an explicit opt-in (a separate `*_RESET_PASSWORD=true` flag), and doing so must always re-set `must_change_password: true` — silently reverting a real password to a known value with no forced re-change prompt is how a "temporary" credential stays valid indefinitely.

## Injection & untrusted content

- All database access goes through supabase-js's query builder or Prisma's ORM — never build a query with string concatenation.
- Anywhere this app hand-builds an HTML string (PDF export, emails — **not** JSX, where React already escapes) — escape every interpolated value with `lib/html-escape.ts`'s `escapeHtml()`. Treat AI-generated text and scraped web content exactly like user input: neither is trustworthy. Note the ceiling on this: escaping/quote-verification proves a claim's text appears in its source, not that the source is honest — an attacker who controls the source itself (their own uploaded document, a public review they posted) can still get a literal false claim accepted as "grounded." Bound the blast radius by keeping AI output scoped to a fixed field vocabulary, never a downstream tool-call/code-execution path.
- CSV exports must prefix any cell starting with `=`, `+`, `-`, or `@` — use `lib/csv-safe.ts`'s `sanitizeCsvCell()` — to prevent formula/DDE injection when the file is opened in Excel/Sheets.
- Any server-side fetch of a URL that a user typed or an AI cited (not a fixed, hardcoded host like the OpenAI/Rainforest/Google APIs) must go through `lib/safe-fetch.ts`, not raw `fetch()` — see "SSRF" above for why checking DNS isn't enough on its own.
- File uploads (project artwork, Contact Support screenshots) are verified by real file signature (`lib/file-magic-bytes.ts`), never by trusting the client's declared filename or Content-Type. SVG is not an accepted upload type anywhere in this app — it can embed executable script. For any upload that lands in a **public** bucket via a signed-upload-URL flow (bypassing this server entirely for the actual bytes), app-level validation isn't sufficient on its own — it can always be skipped by calling the signed URL directly. Set real `allowedMimeTypes`/`fileSizeLimit` on the bucket itself (Supabase Storage enforces these at the infrastructure level) via a one-off script like `scripts/apply-storage-bucket-restrictions.ts`.
- Any parsed zip (`.xlsx`/`.docx`/`.pptx`) needs the zip-bomb guard — see "Zip-bomb / decompression-bomb guard" above.

## Headers & transport

`next.config.mjs`'s `headers()` sets CSP, HSTS, `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, and `Permissions-Policy` on every route. **Before tightening the CSP further** (e.g. removing `script-src`'s `unsafe-inline`), test against a real production build with a real browser first — an earlier attempt at a strict `script-src 'self'` broke Next.js's own framework hydration scripts, confirmed via actual CSP-violation console output, not assumption.

## CI

`.github/workflows/security.yml` runs on every push/PR: gitleaks (secret scanning), `npm audit --audit-level=high`, `tsc --noEmit` + `eslint` + `next build`, and 15 offline `scripts/verify-*.ts` regression scripts (grew from 6 in the first audit pass — add any new pure-offline verify script you write to that list too). It does **not** run the `verify-*-schema-live.ts` scripts (those intentionally target a real, configured Supabase project) or anything that makes a real network call, even a benign one (e.g. `verify-ssrf-protection.ts`/`verify-safe-fetch-pinning.ts` each make one real HTTPS request to prove legitimate URLs still work — deliberately excluded from CI for that reason, run them locally when touching `lib/safe-fetch.ts`).

## What NOT to do

- Never make a live OpenAI/Gemini/Rainforest API call from a test/verify script — stub `globalThis.fetch` and use synthetic data (see any `scripts/verify-*.ts` for the pattern).
- Never add a new admin/API route without an ownership check on every id-bearing parameter — see "Authorization" above.
- Never store a raw client-declared file type/extension as ground truth for what a file actually is.
- Never loosen the CSP or cookie flags without re-running the same real-browser verification this pass used (see `SECURITY_REPORT.md`'s M5 finding for exactly what broke and why).
- Never add a `CREATE POLICY ... USING (true)` (or any policy that isn't genuinely scoped to `auth.uid()`/org) to a new Supabase table — see "Row-Level Security" above. This exact mistake has already been made and fixed twice in this codebase.
- Never write a `scripts/*.ts` that hardcodes a real password/credential as a fallback default, even one gated behind an env-var override — see "Credential-issuing scripts" above.
