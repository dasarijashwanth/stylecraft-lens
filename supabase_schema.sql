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
