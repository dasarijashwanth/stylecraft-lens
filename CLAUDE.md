# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev              # start dev server (localhost:3000)
npm run build             # production build (also runs eslint/type checking)
npm run lint               # eslint only
npx tsc --noEmit           # type-check only, no build (fastest correctness check)
```

There is no automated test runner (no jest/vitest/playwright configured). Correctness is verified two ways:

- **`scripts/verify-*.ts`** — standalone, offline scripts asserting behavior with plain `console.log`/`throw` (not a test framework). Run individually: `npx tsx scripts/verify-price-band.ts`. These must NOT make live Rainforest/OpenAI/Gemini calls — stub `globalThis.fetch` and pass synthetic data instead. Read an existing one (e.g. `scripts/verify-competitor-scoring.ts`) as a template before writing a new one.
- **`scripts/verify-*-schema-live.ts`** — read-only checks against the REAL configured Supabase project (loads `.env.local`, uses `SUPABASE_SERVICE_ROLE_KEY` directly, bypassing this repo's `@/` module system) confirming tables/columns/Storage buckets exist after a manual schema change. Run after applying new SQL by hand.

Other one-off scripts (`create-admin-user.ts`, `create-team-users.ts`, `seed-faqs.ts`, `backfill-*.ts`, `wipe-projects-and-analyses.ts`) are meant to be run directly against production via `npx tsx scripts/<name>.ts` when their situation applies — they are not part of a normal dev loop.

**No migrations CLI.** All schema changes are idempotent (`CREATE TABLE IF NOT EXISTS`, `ADD COLUMN IF NOT EXISTS`) blocks appended to `supabase_schema.sql`, which a human runs by hand in the Supabase SQL editor. When changing schema: append a new numbered section to that file, never edit past sections in place, and add a matching `verify-*-schema-live.ts` script. Storage buckets (e.g. `deck-templates`, `support-screenshots`, `artwork`) are not SQL objects — they must be created manually in the Supabase dashboard; document the required bucket name/visibility (public vs private) in a script comment.

## Architecture

Next.js 14 App Router, deployed to **Vercel Hobby** (serverless functions capped at 60s execution and ~4.5MB request body — both limits shape major parts of this codebase, see below).

### Three-tier data layer

Every domain table has a CRUD module in `lib/db/*.ts` that branches on `isSupabaseConfigured` (from `lib/supabase.ts`):

```ts
if (isSupabaseConfigured) { /* supabaseAdmin (service-role client) query */ }
else { /* read/write memoryDb, an in-process array-based mock (lib/memoryDb.ts) */ }
```

Supabase is the real store in production and is always configured there. `memoryDb` is the local-dev-without-credentials fallback (snapshotted to `.local-data` between restarts, except a few explicitly-excluded "real usage data" arrays that reset every restart — see comments in `lib/memoryDb.ts`). A third path, Prisma (`lib/db.ts`, `prisma/schema.prisma`), exists only for a "developer bypass" auth mode in `lib/auth.ts` when neither Supabase nor real Clerk keys are set — it is not used by the `lib/db/*.ts` CRUD layer at all and can mostly be ignored.

When adding a new table: write both branches in the new `lib/db/*.ts` module, add the interface to `lib/memoryDb.ts`'s `MemoryDatabase` class, and decide whether it's "real default reference config" (seed unconditionally in the constructor, like `motorFamilies`/`faqs`) or "real usage data" (starts empty, like `faqVotes`/`supportMessages`).

### Auth & per-account data isolation

`lib/auth.ts`'s `getAuthSession()` is the single source of truth for the current user, returning a `UserSession` with `userId`/`orgId`/`role`. Real Supabase Auth (via `lib/supabase-server.ts`) is the live identity provider; a `profiles` table row supplies `role` (`OWNER`/`ADMIN`/`MEMBER`/`VIEWER`) and `must_change_password`. Route protection is enforced in `middleware.ts` (401 for unauthenticated `/api/**`, redirect for `/dashboard/**`) — not per-route by convention alone.

**Ownership model:** `OWNER`/`ADMIN` accounts share one fixed legacy identity (`userId: "dev_user_id"`, `orgId: "dev_org_id"`) for backward compatibility with data created before real per-user accounts existed. Every other role gets its own real Supabase Auth `user.id` as both `userId` and `orgId`, making their `lib/db/projects.ts`/`analyses.ts`/`reports.ts` rows (all filtered by `org_id`/`user_id`) genuinely isolated from every other account. **Any new project-scoped route must verify ownership itself** — `lib/db/documents.ts`, `project-decks.ts`, etc. take raw ids with no org/user awareness of their own; the caller is responsible for checking the parent project belongs to `session.orgId` first (see `getProject(id, orgId)` returning `null` on mismatch) before trusting a `projectId`/`documentId` from the request.

### Resumable, phase-at-a-time pipelines

Two long AI-driven pipelines are both built the same way to survive Vercel's 60s cap: **do exactly one phase per request**, persist the result, and let the client poll/re-trigger the next phase.

- **Competitive analysis** (`lib/analysisEngine.ts`, driven by `app/api/analyses/[id]/continue`): phase 0 (product identification) → phase 1 (legacy/established competitors) → phase 2 (indie/emerging competitors) → phase 3 (synthesis). State lives in `analyses.phase{0,1,2,3}_result` JSONB columns plus a `phase`/`status` column.
- **Project generation** (`lib/project-generation-engine.ts`, driven by `app/api/projects/[id]/pipeline/continue`): snapshot capture → TDS generation → GTM generation → deck generation. State lives in the one-row-per-project `project_generation_state` table (`lib/db/generation-state.ts`).

Both patterns support **pause-and-ask**: when a phase can't proceed without human input (e.g. ambiguous product category, missing target price, missing motor type), it sets a `pending_question` field instead of guessing, the client renders a question UI, and `app/api/analyses/[id]/answer` resumes the same phase with the answer merged into context — never re-runs completed phases. Read `lib/analysisEngine.ts`'s and `lib/project-generation-engine.ts`'s own header comments before modifying either; they explain this in more depth than is worth duplicating here.

### Competitor discovery & scoring

Not a simple search — competitor selection is a layered pipeline: `lib/legacy-brand-registry.ts` + `lib/legacy-brand-discovery.ts` prioritize an admin-editable curated brand list (`lib/db/legacy-brands.ts`) over free AI judgment for "legacy" competitors; `lib/indie-brand-lineup.ts` builds a real per-brand Amazon price lineup for "indie/emerging" competitors' relative pricing. Final selection scores every candidate on a weighted composite (`lib/competitor-scoring.ts`): motor-type match (via the admin-editable taxonomy in `lib/motor-taxonomy.ts`/`lib/db/motor-families.ts`) dominates, then price proximity, then feature overlap — weights are configurable at runtime via `lib/db/competitor-matching-config.ts`. `lib/price-band.ts` computes the price tolerance band candidates must fall within.

### Field-granular generated documents (GTM/TDS)

GTM and TDS are not opaque generated blobs — they're stored as one row per (`project_id`, `doc_type`) in `documents`, with individual editable `document_fields` rows (schema-defined in `lib/gtm-field-schema.ts`/`lib/tds-field-schema.ts`), each carrying its own `source`/`source_detail` provenance and a full edit history (`document_field_history`). `lib/field-answer-state.ts` classifies a field's state (real answer / awaiting internal input / not determinable) consistently across the UI and PDF export. TDS is a point-in-time snapshot (from `lib/snapshot-capture.ts` + `product_snapshots`) with no regenerate button; GTM is regenerable per-field and cross-fills from TDS/analysis data (`lib/tds-gtm-reconcile.ts`).

### PDF / deck export

`lib/export-pdf.ts` + `lib/pdf/` (React-PDF) render reports/documents to PDF. Project Decks are a separate PPTX pipeline: an admin-uploaded template is parsed for `{{token}}` placeholders (`lib/deck-template-parser.ts`), mapped against known fields (`lib/deck-field-registry.ts`, `lib/deck-data-mapper.ts`), and rendered (`lib/deck-render.ts`/`lib/deck-generate.ts`). Large-file uploads (decks, screenshots) bypass Vercel's ~4.5MB request-body limit via a signed-Supabase-Storage-upload-URL flow: the browser uploads directly to Storage, then a small JSON "finalize" call does the actual server-side processing (see `app/api/admin/deck-templates/upload-url` + `finalize`, or `app/api/support/screenshot-upload-url` for the smaller Contact Support version).

### Frontend

`app/(app)/dashboard/**` are the authenticated pages, wrapped by `components/layout/Shell.tsx` (mounts global providers — `ContactSupportProvider`, the Getting Started banner — plus the sidebar/topbar/command palette). Design tokens (`surface-1/2/3`, `text-primary/secondary/muted`, `accent`) are CSS variables mapped through `tailwind.config`, not hardcoded colors — match existing components' class patterns rather than inventing new tokens. `app/(app)/dashboard/projects/[id]/page.tsx` is intentionally a single large file housing the 6 project tabs (Competitive Analysis/Pricing/Go-To-Market/Content Form/Artwork/Project Deck) plus the TDS/GTM sections — read its `Tab`/`TAB_LABELS` structures before adding a 7th tab or another tab-scoped feature.

### Help / support systems

`lib/faq-seed-data.ts` is the single source of truth for FAQ content (seeded into `faqs` via `scripts/seed-faqs.ts`, not duplicated as raw SQL — long free-text prose is high-escaping-risk compared to the short string arrays that do live directly in `supabase_schema.sql`). Contact Support (`components/help/ContactSupportProvider.tsx`, `lib/support-email.ts`) persists every submission to `support_messages` *before* attempting delivery via Resend, so a mail-provider failure never loses a message — only its `email_status` reflects the outcome, visible/retriable from `/dashboard/admin/support-messages`.
