-- supabase_schema.sql
-- Run this schema block in your Supabase SQL Editor.
-- This builds all required tables, relation keys, indices, and RLS policies.

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 1. PROJECTS TABLE
CREATE TABLE IF NOT EXISTS projects (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id VARCHAR(255) NOT NULL,
    org_id VARCHAR(255) NOT NULL,
    name VARCHAR(255) NOT NULL,
    industry VARCHAR(255) NOT NULL,
    target_market VARCHAR(50) NOT NULL,
    product_name VARCHAR(255) NOT NULL,
    description TEXT,
    category VARCHAR(255),
    company_context TEXT,
    motor_tech VARCHAR(255),
    key_diff VARCHAR(255),
    price_point VARCHAR(255),
    saved_defaults JSONB DEFAULT '{}'::jsonb,
    latest_analysis_id UUID,
    latest_report_id UUID,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    last_used_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 2. ANALYSES TABLE
-- phase0_result holds the mandatory Product Identification step's Identity
-- Card (see lib/product-identification.ts) — same column-per-phase pattern
-- as phase1/2/3_result. pending_question is set (and status stays
-- "running") when identification can't confidently determine the
-- product's category and the pipeline must pause for user input rather
-- than guess; its mere presence is the pause signal, checked by the
-- client and by runAnalysisStep itself before advancing.
CREATE TABLE IF NOT EXISTS analyses (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id VARCHAR(255) NOT NULL,
    org_id VARCHAR(255) NOT NULL,
    project_id UUID REFERENCES projects(id) ON DELETE SET NULL,
    status VARCHAR(50) NOT NULL DEFAULT 'PENDING',
    phase INTEGER NOT NULL DEFAULT 1,
    context JSONB DEFAULT '{}'::jsonb,
    phase0_result JSONB DEFAULT '{}'::jsonb,
    phase1_result JSONB DEFAULT '{}'::jsonb,
    phase2_result JSONB DEFAULT '{}'::jsonb,
    phase3_result JSONB DEFAULT '{}'::jsonb,
    pending_question JSONB,
    error_message TEXT,
    duration_ms INTEGER,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    completed_at TIMESTAMP WITH TIME ZONE
);

-- 3. REPORTS TABLE
CREATE TABLE IF NOT EXISTS reports (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id VARCHAR(255) NOT NULL,
    analysis_id UUID REFERENCES analyses(id) ON DELETE SET NULL,
    project_id UUID REFERENCES projects(id) ON DELETE SET NULL,
    title VARCHAR(255) NOT NULL,
    status VARCHAR(50) NOT NULL DEFAULT 'draft',
    competitive_analysis JSONB DEFAULT '{}'::jsonb,
    pricing_analysis JSONB DEFAULT '{}'::jsonb,
    go_to_market JSONB DEFAULT '{}'::jsonb,
    content_form JSONB DEFAULT '{}'::jsonb,
    product_knowledge JSONB DEFAULT '{}'::jsonb,
    drive_url VARCHAR(500),
    drive_file_id VARCHAR(255),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 4. COMPETITORS TABLE (Dynamic & Fixed Reference List)
CREATE TABLE IF NOT EXISTS competitors (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id VARCHAR(255) NOT NULL,
    org_id VARCHAR(255) NOT NULL,
    name VARCHAR(255) NOT NULL,
    website VARCHAR(255),
    description TEXT,
    main_products TEXT,
    status VARCHAR(50) DEFAULT 'active',
    is_fixed BOOLEAN DEFAULT false NOT NULL,
    logo_url VARCHAR(500),
    tags VARCHAR(255)[] DEFAULT '{}'::varchar[],
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 5. ANALYSIS COMPETITORS (Individual competitors mapped from specific analysis runs)
CREATE TABLE IF NOT EXISTS analysis_competitors (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    analysis_id UUID REFERENCES analyses(id) ON DELETE CASCADE NOT NULL,
    user_id VARCHAR(255) NOT NULL,
    name VARCHAR(255) NOT NULL,
    brand VARCHAR(255),
    tier VARCHAR(50) NOT NULL,
    asin VARCHAR(50),
    amazon_url VARCHAR(500),
    price VARCHAR(50),
    rating VARCHAR(50),
    review_count VARCHAR(50),
    monthly_sales VARCHAR(50),
    bsr_rank VARCHAR(50),
    initials VARCHAR(10),
    key_features TEXT[] DEFAULT '{}'::text[],
    strengths TEXT[] DEFAULT '{}'::text[],
    weaknesses TEXT[] DEFAULT '{}'::text[],
    recent_news TEXT[] DEFAULT '{}'::text[],
    top_feature_summary TEXT,
    threat_score INTEGER DEFAULT 50,
    tags VARCHAR(255)[] DEFAULT '{}'::varchar[],
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 6. PROJECT OUTPUTS
CREATE TABLE IF NOT EXISTS project_outputs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    project_id UUID REFERENCES projects(id) ON DELETE CASCADE NOT NULL,
    output_type VARCHAR(50) NOT NULL,
    content JSONB DEFAULT '{}'::jsonb NOT NULL,
    html TEXT,
    drive_url VARCHAR(500),
    drive_file_id VARCHAR(255),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 7. AMAZON CACHE (Rainforest product + review-analysis responses)
-- Cross-instance cache — an in-memory Map only helps within one warm
-- serverless container; this survives across all of them. product: 12h TTL,
-- reviews_analysis: 24h TTL, enforced by the caller checking fetched_at.
CREATE TABLE IF NOT EXISTS amazon_cache (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    asin VARCHAR(20) NOT NULL,
    cache_type VARCHAR(30) NOT NULL,
    payload JSONB NOT NULL,
    fetched_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS amazon_cache_asin_type_idx ON amazon_cache(asin, cache_type);

-- 8. DOCUMENTS / DOCUMENT FIELDS / DOCUMENT FIELD HISTORY
-- Field-granular generated documents (currently: doc_type = 'gtm' only).
-- One row per (project, doc_type) — regenerating updates fields in place
-- rather than creating a duplicate document. There is no separate products
-- table: project_id IS the product identifier (one product per project).
CREATE TABLE IF NOT EXISTS documents (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    project_id UUID REFERENCES projects(id) ON DELETE CASCADE NOT NULL,
    doc_type VARCHAR(30) NOT NULL,
    status VARCHAR(20) DEFAULT 'draft',
    drive_url VARCHAR(500),
    drive_file_id VARCHAR(255),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    UNIQUE (project_id, doc_type)
);

CREATE TABLE IF NOT EXISTS document_fields (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    document_id UUID REFERENCES documents(id) ON DELETE CASCADE NOT NULL,
    field_id TEXT NOT NULL,
    section TEXT NOT NULL,
    question TEXT NOT NULL,
    answer TEXT,
    source TEXT,
    source_detail JSONB DEFAULT '{}'::jsonb,
    flagged BOOLEAN DEFAULT false,
    updated_by TEXT,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    UNIQUE (document_id, field_id)
);

CREATE TABLE IF NOT EXISTS document_field_history (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    document_field_id UUID REFERENCES document_fields(id) ON DELETE CASCADE NOT NULL,
    answer TEXT,
    changed_by TEXT,
    changed_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 9. PRODUCT SNAPSHOTS
-- A raw, timestamped capture of the real product (official site scrape
-- and/or Amazon listing via Rainforest) taken at project creation or an
-- explicit "re-capture". TDS is generated ONLY from this data — never
-- from a project's typed-in description — and re-capturing creates a NEW
-- row here (never overwrites) so the TDS document's `snapshot_id` always
-- points at exactly the data it was generated from.
CREATE TABLE IF NOT EXISTS product_snapshots (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    project_id UUID REFERENCES projects(id) ON DELETE CASCADE NOT NULL,
    source_url TEXT,
    asin VARCHAR(20),
    raw_data JSONB DEFAULT '{}'::jsonb NOT NULL,
    captured_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);
CREATE INDEX IF NOT EXISTS product_snapshots_project_captured_idx ON product_snapshots(project_id, captured_at DESC);

-- 10. PROJECT GENERATION STATE
-- Backs the resumable background pipeline (scrape snapshot -> generate TDS
-- -> generate GTM) kicked off when a project is created with a product
-- anchor. One row per project, advanced one phase per
-- /api/projects/:id/pipeline/continue call — same resumable-step shape as
-- the `analyses` table's phase/status columns.
CREATE TABLE IF NOT EXISTS project_generation_state (
    project_id UUID PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
    phase VARCHAR(20) NOT NULL DEFAULT 'pending',
    status VARCHAR(20) NOT NULL DEFAULT 'pending',
    error_message TEXT,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Product-anchor identity, captured once at project creation. The project
-- NAME stays a free-text reference label only — every generation prompt
-- must identify the product via the scraped snapshot title / this URL /
-- this ASIN, never via `projects.name`.
ALTER TABLE projects ADD COLUMN IF NOT EXISTS product_url TEXT;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS asin VARCHAR(20);

-- Mandatory Product Identification stage (runs before competitor discovery)
-- added to the existing 3-phase analysis pipeline as a new phase 0.
ALTER TABLE analyses ADD COLUMN IF NOT EXISTS phase0_result JSONB DEFAULT '{}'::jsonb;
ALTER TABLE analyses ADD COLUMN IF NOT EXISTS pending_question JSONB;

-- Links a doc_type='tds' document to the exact snapshot it was generated
-- from, so the UI can show "Live snapshot captured {captured_at} from
-- {domain}". Null for doc_type='gtm'.
ALTER TABLE documents ADD COLUMN IF NOT EXISTS snapshot_id UUID REFERENCES product_snapshots(id);

-- Structured, citation-verified Key Features / Strengths / Weaknesses &
-- Sentiment / News data per competitor (lib/citations.ts's Claim shape).
-- Additive only — the existing key_features/strengths/weaknesses/recent_news
-- TEXT[] columns above stay as-is; this JSONB column is where the richer,
-- source-cited evidence objects live once populated.
ALTER TABLE analysis_competitors ADD COLUMN IF NOT EXISTS evidence JSONB;

-- Shared by GTM and TDS field rows. `owner` mirrors the internal sheet's
-- Owner column (Product Marketing/Marketing/Sales/Legal/Ops); `notes` is
-- free-text, independent of the field's `answer`/history.
ALTER TABLE document_fields ADD COLUMN IF NOT EXISTS owner TEXT DEFAULT 'Product Marketing';
ALTER TABLE document_fields ADD COLUMN IF NOT EXISTS notes TEXT;

-- Re-architecture onto Inngest durable background jobs: `analyses` becomes
-- the unified job id (no separate job table — it's already the FK target
-- for reports/analysis_competitors). `job_status` is the new unified
-- running/partial_complete/complete/failed signal the status-polling
-- endpoint and frontend read; the legacy `status` column keeps being
-- written exactly as before so nothing already reading it breaks.
ALTER TABLE analyses ADD COLUMN IF NOT EXISTS job_status VARCHAR(20) NOT NULL DEFAULT 'running';
ALTER TABLE analyses ADD COLUMN IF NOT EXISTS total_searches INTEGER NOT NULL DEFAULT 0;
ALTER TABLE analyses ADD COLUMN IF NOT EXISTS inngest_run_id TEXT;

-- Per-task checkpointing for the Inngest-driven analysis pipeline. Each
-- durable step writes its result here on completion; a retry (automatic or
-- user-clicked) re-runs only rows with status='failed' — rows already
-- 'done' are read back directly, never re-executed. This is the source of
-- truth the status-polling endpoint and the section-level retry button
-- read/write; Inngest's own step memoization is a secondary safety net,
-- not a replacement for it (see lib/inngest/functions/analyze-product.ts).
CREATE TABLE IF NOT EXISTS analysis_tasks (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    job_id UUID REFERENCES analyses(id) ON DELETE CASCADE NOT NULL,
    task_key VARCHAR(160) NOT NULL,
    task_type VARCHAR(40) NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'pending',
    attempts INTEGER NOT NULL DEFAULT 0,
    max_attempts INTEGER NOT NULL DEFAULT 3,
    provider VARCHAR(40),
    error_class VARCHAR(40),
    error TEXT,
    latency_ms INTEGER,
    result JSONB,
    inngest_run_id TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    started_at TIMESTAMP WITH TIME ZONE,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    completed_at TIMESTAMP WITH TIME ZONE,
    UNIQUE (job_id, task_key)
);
CREATE INDEX IF NOT EXISTS analysis_tasks_job_idx ON analysis_tasks(job_id);
CREATE INDEX IF NOT EXISTS analysis_tasks_status_idx ON analysis_tasks(job_id, status);
CREATE INDEX IF NOT EXISTS analysis_tasks_admin_failures_idx ON analysis_tasks(status, provider, updated_at DESC) WHERE status = 'failed';

-- Per-provider circuit breaker state (Rainforest/OpenAI web-search/etc.) —
-- tripped after 5 consecutive failures, auto-resets 60s after opening.
-- record_provider_result is a Postgres RPC (not a plain Supabase-JS
-- read-then-write) because many concurrent Inngest step invocations across
-- DIFFERENT users' jobs race to update the same provider row; a naive
-- read-then-write would lose updates under real concurrency and silently
-- under-count failures, defeating the breaker.
CREATE TABLE IF NOT EXISTS provider_circuit_state (
    provider VARCHAR(40) PRIMARY KEY,
    state VARCHAR(20) NOT NULL DEFAULT 'closed',
    consecutive_failures INTEGER NOT NULL DEFAULT 0,
    opened_at TIMESTAMP WITH TIME ZONE,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE OR REPLACE FUNCTION record_provider_result(p_provider VARCHAR, p_success BOOLEAN)
RETURNS TABLE(state VARCHAR, consecutive_failures INTEGER) AS $$
BEGIN
  INSERT INTO provider_circuit_state (provider, state, consecutive_failures, updated_at)
  VALUES (p_provider, 'closed', 0, now()) ON CONFLICT (provider) DO NOTHING;
  IF p_success THEN
    UPDATE provider_circuit_state SET consecutive_failures = 0, state = 'closed', opened_at = NULL, updated_at = now()
    WHERE provider = p_provider;
  ELSE
    UPDATE provider_circuit_state SET
      consecutive_failures = consecutive_failures + 1,
      state = CASE WHEN consecutive_failures + 1 >= 5 THEN 'open' ELSE state END,
      opened_at = CASE WHEN consecutive_failures + 1 >= 5 AND opened_at IS NULL THEN now() ELSE opened_at END,
      updated_at = now()
    WHERE provider = p_provider;
  END IF;
  RETURN QUERY SELECT provider_circuit_state.state, provider_circuit_state.consecutive_failures FROM provider_circuit_state WHERE provider = p_provider;
END;
$$ LANGUAGE plpgsql;

-- Enable RLS on all tables
ALTER TABLE projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE analyses ENABLE ROW LEVEL SECURITY;
ALTER TABLE reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE competitors ENABLE ROW LEVEL SECURITY;
ALTER TABLE analysis_competitors ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_outputs ENABLE ROW LEVEL SECURITY;
ALTER TABLE amazon_cache ENABLE ROW LEVEL SECURITY;
ALTER TABLE documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE document_fields ENABLE ROW LEVEL SECURITY;
ALTER TABLE document_field_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE product_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_generation_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE analysis_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE provider_circuit_state ENABLE ROW LEVEL SECURITY;

-- Create Permissive RLS Policies (allows anyone to query/insert/update/delete for prototype stage)
CREATE POLICY "Allow all operations for projects" ON projects FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all operations for analyses" ON analyses FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all operations for amazon_cache" ON amazon_cache FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all operations for reports" ON reports FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all operations for competitors" ON competitors FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all operations for analysis_competitors" ON analysis_competitors FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all operations for project_outputs" ON project_outputs FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all operations for documents" ON documents FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all operations for document_fields" ON document_fields FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all operations for document_field_history" ON document_field_history FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all operations for product_snapshots" ON product_snapshots FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all operations for project_generation_state" ON project_generation_state FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all operations for analysis_tasks" ON analysis_tasks FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all operations for provider_circuit_state" ON provider_circuit_state FOR ALL USING (true) WITH CHECK (true);

-- Real auth (Supabase Auth) — profile/role data for real logged-in users,
-- one row per auth.users row. Domain data (projects/competitors/analyses/
-- reports) is intentionally NOT re-keyed to this id — see lib/auth.ts's
-- getAuthSession() comment on why it still maps to the existing fixed
-- org_id/user_id literal strings for now (single-admin app, no multi-tenant
-- management yet).
CREATE TABLE IF NOT EXISTS profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    email VARCHAR(255) NOT NULL,
    name VARCHAR(255),
    role VARCHAR(50) NOT NULL DEFAULT 'ADMIN' CHECK (role IN ('OWNER','ADMIN','MEMBER','VIEWER')),
    must_change_password BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all operations for profiles" ON profiles FOR ALL USING (true) WITH CHECK (true);

-- Persisted, per-section data provenance — which source tier won, the
-- verbatim queries run, item counts used vs. rejected (with reasons), and
-- when — for each of Key Features / Reviews / News / Pricing. Append-only
-- (mirrors product_snapshots, NOT amazon_cache's overwrite-on-refresh
-- pattern): every resolver run INSERTs a new row so there's a real history,
-- never UPDATE/upsert. Keyed by product_key (== resolveCacheKey() output,
-- lib/product-cache-key.ts — the same stable identity amazon_cache already
-- uses for an in-progress, not-yet-saved competitor) + section.
-- analysis_id is best-effort/nullable (no analysis_id exists yet for a
-- competitor until an analysis job is created); product_name is denormalized
-- so the Details panel/PDF appendix can render without a join.
CREATE TABLE IF NOT EXISTS section_provenance (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    product_key VARCHAR(20) NOT NULL,
    section VARCHAR(20) NOT NULL,
    analysis_id UUID REFERENCES analyses(id) ON DELETE SET NULL,
    product_name TEXT,
    tiers JSONB NOT NULL DEFAULT '[]'::jsonb,
    queries JSONB NOT NULL DEFAULT '[]'::jsonb,
    resolved_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);
-- "Latest row per (product_key, section)": filters on the two leading
-- columns, ORDER BY resolved_at DESC LIMIT 1 rides this index directly.
CREATE INDEX IF NOT EXISTS section_provenance_key_section_resolved_idx
    ON section_provenance(product_key, section, resolved_at DESC);
ALTER TABLE section_provenance ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all operations for section_provenance" ON section_provenance FOR ALL USING (true) WITH CHECK (true);

-- Preserves the AI/derivation-generated answer separately from `answer`
-- (the current, possibly hand-edited value) so a GTM/TDS CSV export can
-- show both side by side. Only ever written by an AI-driven save (full
-- generation or per-field regenerate) — a plain manual edit (PATCH with
-- just {answer}) leaves this column untouched, so it always reflects "what
-- the pipeline last said" regardless of how many times a human edits
-- `answer` afterward.
ALTER TABLE document_fields ADD COLUMN IF NOT EXISTS ai_answer TEXT;

-- 11. DECK TEMPLATES
-- Versioned master .pptx templates for the "Project Deck" feature. The
-- binary file itself lives in Supabase Storage bucket "deck-templates"
-- (same pattern as project_artwork's "artwork" bucket) — this row is
-- metadata + a pointer + the parsed/edited token->data-field mapping.
-- Only one row may have is_active = true at a time (enforced by the
-- partial unique index below); new projects' decks always render off
-- whichever template is currently active. Regenerating an existing
-- project's deck may instead pin an explicit older template_id (see
-- project_decks below), so an active-template change never silently
-- alters a deck someone regenerates from history.
CREATE TABLE IF NOT EXISTS deck_templates (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(255) NOT NULL,
    -- No public URL, same reasoning as project_decks below — served only
    -- through the authenticated admin routes, never rendered via <img>/<a>.
    file_path VARCHAR(500) NOT NULL,
    file_name VARCHAR(255),
    file_size_bytes INTEGER,
    slide_count INTEGER NOT NULL DEFAULT 0,
    -- Shape: { version, slide_count, tokens: DeckTokenMapping[], unmapped_tokens: string[] } — see lib/deck-types.ts.
    placeholder_map JSONB NOT NULL DEFAULT '{}'::jsonb,
    is_active BOOLEAN NOT NULL DEFAULT false,
    uploaded_by VARCHAR(255),
    uploaded_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS deck_templates_one_active_idx ON deck_templates(is_active) WHERE is_active = true;
ALTER TABLE deck_templates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all operations for deck_templates" ON deck_templates FOR ALL USING (true) WITH CHECK (true);

-- 12. PROJECT DECKS
-- Append-only, mirrors product_snapshots' "never overwrite, insert a new
-- row" pattern rather than documents' "one row per (project, doc_type),
-- upsert in place" pattern — a generated deck is a binary artifact with
-- real version history (Part 1's "regenerating an old deck may use its
-- original template version" requirement needs this to be a queryable
-- fact, not something only inferable from deck_templates.is_active at
-- read time). Binary output lives in Storage bucket "project-decks" —
-- unlike project_artwork, decks are never given a public URL (a GTM deck
-- contains pricing/competitive data), bytes are only ever served through
-- the authenticated /api/projects/:id/deck/download route.
CREATE TABLE IF NOT EXISTS project_decks (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    project_id UUID REFERENCES projects(id) ON DELETE CASCADE NOT NULL,
    template_id UUID REFERENCES deck_templates(id) ON DELETE SET NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'pending', -- pending | generating | complete | failed
    file_path VARCHAR(500),
    file_name VARCHAR(255),
    file_size_bytes INTEGER,
    -- Snapshot of the resolved token->value map used for THIS render (text/
    -- table values only — image tokens store the source URL, never raw
    -- bytes) — audit trail + backs the tab's "fill report" without needing
    -- to re-derive anything from the (possibly since-edited) GTM document.
    placeholder_values JSONB DEFAULT '{}'::jsonb,
    slides_removed INTEGER[] DEFAULT '{}'::integer[],
    error_message TEXT,
    -- Captured at generation time from the GTM document's true last-edited
    -- moment (max of the document row's and its most-recent field row's
    -- updated_at — see lib/db/decks.ts's getGtmLastEditedAt) so the tab can
    -- later detect "GTM edited after this deck was generated" without
    -- re-deriving it from possibly-changed data.
    gtm_snapshot_at TIMESTAMP WITH TIME ZONE,
    generated_at TIMESTAMP WITH TIME ZONE,
    drive_url VARCHAR(500),
    drive_file_id VARCHAR(255),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);
CREATE INDEX IF NOT EXISTS project_decks_project_created_idx ON project_decks(project_id, created_at DESC);
ALTER TABLE project_decks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all operations for project_decks" ON project_decks FOR ALL USING (true) WITH CHECK (true);

-- 13. LEGACY BRAND REGISTRY
-- Curated, admin-editable brand lists that competitor discovery's Phase 1
-- (legacy/established competitors) now searches directly instead of
-- relying purely on AI judgment (see lib/legacy-brand-discovery.ts). Each
-- category maps to a stable `slug` the app resolves to from the product's
-- Identity Card (category/subcategory + pro-vs-retail) — text columns like
-- `name`/`product_types` are not good join keys, hence the slug.
CREATE TABLE IF NOT EXISTS brand_categories (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    slug VARCHAR(100) UNIQUE NOT NULL,
    name VARCHAR(255) NOT NULL,
    product_types TEXT[] DEFAULT '{}'::text[],
    audience VARCHAR(20), -- 'professional' | 'retail'
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);
ALTER TABLE brand_categories ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all operations for brand_categories" ON brand_categories FOR ALL USING (true) WITH CHECK (true);

-- sort_order is the search PRIORITY order (lowest first) — also what "fill
-- 5 slots in priority order" means in lib/legacy-brand-discovery.ts.
-- `enabled=false` keeps a brand in the registry (never silently deleted)
-- but skips it in discovery, per the spec's "disable" requirement.
CREATE TABLE IF NOT EXISTS legacy_brands (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    category_id UUID REFERENCES brand_categories(id) ON DELETE CASCADE NOT NULL,
    brand_name VARCHAR(255) NOT NULL,
    aliases TEXT[] DEFAULT '{}'::text[],
    enabled BOOLEAN NOT NULL DEFAULT true,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    UNIQUE (category_id, brand_name)
);
CREATE INDEX IF NOT EXISTS legacy_brands_category_sort_idx ON legacy_brands(category_id, sort_order);
ALTER TABLE legacy_brands ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all operations for legacy_brands" ON legacy_brands FOR ALL USING (true) WITH CHECK (true);

-- Seed the 4 default categories + their curated brand lists exactly as
-- specified. Idempotent — safe to re-run.
INSERT INTO brand_categories (slug, name, product_types, audience) VALUES
    ('legacy_professional_clippers', 'Legacy Professional Clippers, Trimmers, and Shavers', ARRAY['clipper','trimmer','shaver'], 'professional'),
    ('legacy_retail_clippers', 'Legacy Retail Clippers, Trimmers, and Shavers', ARRAY['clipper','trimmer','shaver'], 'retail'),
    ('professional_beauty', 'Professional Beauty', ARRAY['dryer','iron','styler','brush'], 'professional'),
    ('retail_beauty', 'Retail Beauty', ARRAY['dryer','iron','styler','brush'], 'retail')
ON CONFLICT (slug) DO NOTHING;

INSERT INTO legacy_brands (category_id, brand_name, aliases, sort_order)
SELECT c.id, b.brand_name, b.aliases, b.sort_order
FROM brand_categories c
JOIN (VALUES
    ('legacy_professional_clippers', 'Wahl', ARRAY[]::text[], 0),
    ('legacy_professional_clippers', 'Andis', ARRAY[]::text[], 1),
    ('legacy_professional_clippers', 'Oster', ARRAY[]::text[], 2),
    ('legacy_professional_clippers', 'BaByliss', ARRAY['BaBylissPRO','Babyliss Pro'], 3),
    ('legacy_professional_clippers', 'TPOB', ARRAY['The Profession Of Barbering'], 4),
    ('legacy_professional_clippers', 'Cocco', ARRAY[]::text[], 5),
    ('legacy_professional_clippers', 'JRL', ARRAY[]::text[], 6),

    ('legacy_retail_clippers', 'Wahl', ARRAY[]::text[], 0),
    ('legacy_retail_clippers', 'Andis', ARRAY[]::text[], 1),
    ('legacy_retail_clippers', 'Oster', ARRAY[]::text[], 2),
    ('legacy_retail_clippers', 'Panasonic', ARRAY[]::text[], 3),
    ('legacy_retail_clippers', 'Conair', ARRAY[]::text[], 4),
    ('legacy_retail_clippers', 'Manscaped', ARRAY[]::text[], 5),
    ('legacy_retail_clippers', 'Remington', ARRAY[]::text[], 6),

    ('professional_beauty', 'BaByliss', ARRAY['BaBylissPRO','Babyliss Pro'], 0),
    ('professional_beauty', 'GHD', ARRAY[]::text[], 1),
    ('professional_beauty', 'Paul Mitchell', ARRAY[]::text[], 2),
    ('professional_beauty', 'Bio Ionic', ARRAY[]::text[], 3),
    ('professional_beauty', 'Dyson', ARRAY[]::text[], 4),
    ('professional_beauty', 'Shark', ARRAY[]::text[], 5),
    ('professional_beauty', 'Amika', ARRAY[]::text[], 6),
    ('professional_beauty', 'Olivia Garden', ARRAY[]::text[], 7),
    ('professional_beauty', 'T3', ARRAY[]::text[], 8),

    ('retail_beauty', 'Conair', ARRAY[]::text[], 0),
    ('retail_beauty', 'Revlon', ARRAY[]::text[], 1),
    ('retail_beauty', 'L''Oreal', ARRAY['L''Oréal','LOreal','L Oreal'], 2),
    ('retail_beauty', 'Hot Tools', ARRAY['Hot Tools Professional'], 3),
    ('retail_beauty', 'Drybar', ARRAY[]::text[], 4),
    ('retail_beauty', 'Dyson', ARRAY[]::text[], 5),
    ('retail_beauty', 'Shark', ARRAY[]::text[], 6)
) AS b(category_slug, brand_name, aliases, sort_order) ON b.category_slug = c.slug
ON CONFLICT DO NOTHING;

-- Live per-brand search progress for Phase 1's curated discovery pass —
-- written incrementally as each brand resolves (lib/legacy-brand-discovery.ts's
-- onBrandProgress callback via lib/db/analyses.ts's updatePhase1BrandProgress),
-- polled by components/analyze/ProgressPanel.tsx via the existing
-- GET /api/analyses/[id] route WHILE the Phase 1 POST /continue call is
-- still in flight — this is what makes the brand panel genuinely live
-- without any new endpoint or websocket/SSE infrastructure.
ALTER TABLE analyses ADD COLUMN IF NOT EXISTS phase1_brand_progress JSONB;

-- 14. MOTOR TAXONOMY + COMPETITOR MATCHING WEIGHTS
-- Admin-editable motor-type families competitor selection now matches on
-- (lib/motor-taxonomy.ts) — mirrors legacy_brands/brand_categories's exact
-- dual-path CRUD pattern. `modifier=true` rows (e.g. "brushless") combine
-- with a non-modifier family rather than competing as their own family
-- (e.g. "brushless rotary") — never matched as a family on their own.
-- `adjacent_families` is a self-referencing array of other rows' family_key
-- (not a FK — simpler for a small, rarely-changed admin list) used for
-- "adjacent family" partial-credit scoring (lib/competitor-scoring.ts).
CREATE TABLE IF NOT EXISTS motor_families (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    family_key VARCHAR(50) UNIQUE NOT NULL,
    label VARCHAR(255) NOT NULL,
    domain VARCHAR(30) NOT NULL, -- 'clipper_trimmer_shaver' | 'beauty'
    aliases TEXT[] DEFAULT '{}'::text[],
    modifier BOOLEAN NOT NULL DEFAULT false,
    adjacent_families TEXT[] DEFAULT '{}'::text[],
    enabled BOOLEAN NOT NULL DEFAULT true,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);
ALTER TABLE motor_families ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all operations for motor_families" ON motor_families FOR ALL USING (true) WITH CHECK (true);

INSERT INTO motor_families (family_key, label, domain, aliases, modifier, adjacent_families, sort_order) VALUES
    ('rotary', 'Rotary', 'clipper_trimmer_shaver', ARRAY['rotary motor'], false, ARRAY[]::text[], 0),
    ('magnetic_vector', 'Magnetic / Vector', 'clipper_trimmer_shaver', ARRAY['electromagnetic','vector','magnetic'], false, ARRAY['pivot','linear'], 1),
    ('pivot', 'Pivot', 'clipper_trimmer_shaver', ARRAY['pivot motor'], false, ARRAY['magnetic_vector'], 2),
    ('linear', 'Linear', 'clipper_trimmer_shaver', ARRAY['linear magnetic'], false, ARRAY['magnetic_vector'], 3),
    ('ac_motor', 'AC Motor', 'beauty', ARRAY['ac motor'], false, ARRAY[]::text[], 4),
    ('dc_motor', 'DC Motor', 'beauty', ARRAY['dc motor'], false, ARRAY[]::text[], 5),
    ('brushless_digital', 'Brushless Digital', 'beauty', ARRAY['brushless digital motor','digital motor'], false, ARRAY[]::text[], 6),
    ('brushless', 'Brushless (modifier)', 'clipper_trimmer_shaver', ARRAY['brushless dc','bldc','brushless'], true, ARRAY[]::text[], 7)
ON CONFLICT (family_key) DO NOTHING;

-- Singleton config row for the composite-score weights
-- (lib/competitor-scoring.ts's computeCompositeScore) — admin-editable at
-- /dashboard/admin/competitor-matching without a deploy. No generic
-- settings/config table existed anywhere in this schema before this; a
-- dedicated small table (rather than a KV blob) matches this file's
-- existing preference for explicit typed columns.
CREATE TABLE IF NOT EXISTS competitor_matching_config (
    id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    motor_weight NUMERIC(4,3) NOT NULL DEFAULT 0.45,
    price_weight NUMERIC(4,3) NOT NULL DEFAULT 0.35,
    feature_weight NUMERIC(4,3) NOT NULL DEFAULT 0.20,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);
ALTER TABLE competitor_matching_config ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all operations for competitor_matching_config" ON competitor_matching_config FOR ALL USING (true) WITH CHECK (true);
INSERT INTO competitor_matching_config (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

-- 15. FAQ / HELP CENTER
-- Content lives in lib/faq-seed-data.ts (a plain TS array), NOT duplicated
-- as raw SQL here — FAQ answers are long free-text prose with apostrophes/
-- quotes/markdown, a much higher escaping-risk content type than the short
-- brand/motor-family string arrays seeded directly in SQL elsewhere in this
-- file. Run `npx tsx scripts/seed-faqs.ts` once after this table exists to
-- load the real content (idempotent — safe to re-run after editing the
-- source array). `sort_order` is the priority WITHIN its category (the
-- left-sidebar category order itself is a fixed list in code,
-- lib/faq-seed-data.ts's FAQ_CATEGORIES, not derived from this table).
CREATE TABLE IF NOT EXISTS faqs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    category VARCHAR(100) NOT NULL,
    question TEXT NOT NULL,
    answer TEXT NOT NULL, -- light markdown: **bold**, `code`, "- "/"1. " lists
    sort_order INTEGER NOT NULL DEFAULT 0,
    enabled BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);
CREATE INDEX IF NOT EXISTS faqs_category_sort_idx ON faqs(category, sort_order);
ALTER TABLE faqs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all operations for faqs" ON faqs FOR ALL USING (true) WITH CHECK (true);

-- One row per vote (not an aggregate counter column) — avoids increment
-- race conditions and keeps a real audit trail, matching this app's
-- general "insert a row, never mutate a counter in place" preference
-- (e.g. product_snapshots). Anonymous — no user identification required,
-- just aggregate counts for the admin view.
CREATE TABLE IF NOT EXISTS faq_votes (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    faq_id UUID REFERENCES faqs(id) ON DELETE CASCADE NOT NULL,
    vote VARCHAR(10) NOT NULL CHECK (vote IN ('up', 'down')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);
CREATE INDEX IF NOT EXISTS faq_votes_faq_idx ON faq_votes(faq_id);
ALTER TABLE faq_votes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all operations for faq_votes" ON faq_votes FOR ALL USING (true) WITH CHECK (true);

-- One row per zero-result search — lets admins see what people searched
-- for and couldn't find, to grow the FAQ where users actually get stuck
-- (Part 3's explicit ask).
CREATE TABLE IF NOT EXISTS faq_search_misses (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    term VARCHAR(255) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);
ALTER TABLE faq_search_misses ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all operations for faq_search_misses" ON faq_search_misses FOR ALL USING (true) WITH CHECK (true);

-- Tracks dismissal of the first-login "New here? Read the Getting Started
-- FAQ" banner (Part 1's onboarding hook) — persists across devices/sessions
-- rather than a localStorage-only flag, and doubles as "has this user seen
-- the FAQ at all" for admins. NULL = never dismissed = still shows the banner.
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS faq_banner_dismissed_at TIMESTAMP WITH TIME ZONE;

-- 16. CONTACT SUPPORT
-- Optional screenshot binary lives in the public Supabase Storage bucket
-- "support-screenshots" (create it manually in the Supabase dashboard, same
-- as "deck-templates"/"artwork" — Storage buckets aren't SQL objects).
-- screenshot_url stores the bucket's permanent public URL, matching the
-- existing "artwork" bucket's getPublicUrl() convention (not a signed URL,
-- which would expire and break the record for admins reviewing it later).
--
-- Persistence-first design: a row is inserted here BEFORE any email send is
-- attempted (see app/api/support/contact/route.ts) — a mail-provider hiccup
-- must never lose a message. email_status/email_error track the admin
-- notification email; ack_email_status tracks the separate best-effort
-- "we got your message" reply to the submitter. admin_notification_read
-- doubles as the in-app "unread support message" flag the Topbar bell polls
-- — no separate notifications table needed for this single event type.
CREATE TABLE IF NOT EXISTS support_messages (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id VARCHAR(255) NOT NULL,
    name VARCHAR(255) NOT NULL,
    email VARCHAR(255) NOT NULL,
    topic VARCHAR(30) NOT NULL, -- 'bug' | 'question' | 'data_wrong' | 'feature_request' | 'other'
    message TEXT NOT NULL,
    context JSONB,
    screenshot_url TEXT,
    email_status VARCHAR(20) NOT NULL DEFAULT 'pending', -- 'pending' | 'sent' | 'failed'
    email_error TEXT,
    ack_email_status VARCHAR(20) NOT NULL DEFAULT 'pending',
    admin_notification_read BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);
CREATE INDEX IF NOT EXISTS support_messages_created_idx ON support_messages(created_at DESC);
CREATE INDEX IF NOT EXISTS support_messages_identity_idx ON support_messages(user_id, created_at);
ALTER TABLE support_messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all operations for support_messages" ON support_messages FOR ALL USING (true) WITH CHECK (true);
