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

- Every route handler must call `getAuthSession()` before doing anything — it throws `"UNAUTHENTICATED"` if nobody's logged in (never returns a mock/guest session outside local dev).
- **Object-level ownership is not automatic.** `lib/db/projects.ts`'s `getProject(id, orgId)` returns `null` if the id doesn't belong to that org — every route touching a specific project/document/report/analysis by id must call it (or the equivalent `user_id`/`org_id` check) and 404 if it's null, **before** reading or writing anything. Several routes shipped without this check and were only caught by a dedicated audit — see `SECURITY_REPORT.md`'s High-severity findings for the exact pattern to avoid (computing the check but forgetting to actually gate on its result is the subtlest version of this bug).
- Admin-only routes (`app/api/admin/**`) additionally require `session.role === "OWNER" || "ADMIN"` — use `lib/require-admin.ts` for new routes (it also audit-logs the denial); existing routes still have their own local copy of this check pending a mechanical migration.
- Never trust a `userId`/`orgId`/`role`/`email` field if the client sends one in a request body — always derive identity from `getAuthSession()`.

## Injection & untrusted content

- All database access goes through supabase-js's query builder or Prisma's ORM — never build a query with string concatenation.
- Anywhere this app hand-builds an HTML string (PDF export, emails — **not** JSX, where React already escapes) — escape every interpolated value with `lib/html-escape.ts`'s `escapeHtml()`. Treat AI-generated text and scraped web content exactly like user input: neither is trustworthy.
- CSV exports must prefix any cell starting with `=`, `+`, `-`, or `@` — use `lib/csv-safe.ts`'s `sanitizeCsvCell()` — to prevent formula/DDE injection when the file is opened in Excel/Sheets.
- Any server-side fetch of a URL that a user typed or an AI cited (not a fixed, hardcoded host like the OpenAI/Rainforest/Google APIs) must go through `lib/safe-fetch.ts`, not raw `fetch()` — it blocks non-http(s) protocols, private/reserved IP ranges (including cloud metadata), and re-validates redirects.
- File uploads (project artwork, Contact Support screenshots) are verified by real file signature (`lib/file-magic-bytes.ts`), never by trusting the client's declared filename or Content-Type. SVG is not an accepted upload type anywhere in this app — it can embed executable script.

## Rate limiting

`lib/rate-limit.ts` (backed by the `auth_events` table) rate-limits expensive per-user actions — currently login, password-reset requests, starting an analysis, and creating a project. Add a new `checkRateLimit()` call for any future endpoint that triggers real AI/scraping spend.

## Headers & transport

`next.config.mjs`'s `headers()` sets CSP, HSTS, `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, and `Permissions-Policy` on every route. **Before tightening the CSP further** (e.g. removing `script-src`'s `unsafe-inline`), test against a real production build with a real browser first — an earlier attempt at a strict `script-src 'self'` broke Next.js's own framework hydration scripts, confirmed via actual CSP-violation console output, not assumption.

## CI

`.github/workflows/security.yml` runs on every push/PR: gitleaks (secret scanning), `npm audit --audit-level=high`, `tsc --noEmit` + `eslint` + `next build`, and the offline `scripts/verify-*.ts` regression scripts. It does **not** run the `verify-*-schema-live.ts` scripts (those intentionally target a real, configured Supabase project) or anything that spends real OpenAI/Rainforest/Anthropic credits.

## What NOT to do

- Never make a live OpenAI/Gemini/Rainforest API call from a test/verify script — stub `globalThis.fetch` and use synthetic data (see any `scripts/verify-*.ts` for the pattern).
- Never add a new admin/API route without an ownership check on every id-bearing parameter — see "Authorization" above.
- Never store a raw client-declared file type/extension as ground truth for what a file actually is.
- Never loosen the CSP or cookie flags without re-running the same real-browser verification this pass used (see `SECURITY_REPORT.md`'s M5 finding for exactly what broke and why).
