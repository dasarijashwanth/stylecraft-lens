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
CREATE TABLE IF NOT EXISTS analyses (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id VARCHAR(255) NOT NULL,
    org_id VARCHAR(255) NOT NULL,
    project_id UUID REFERENCES projects(id) ON DELETE SET NULL,
    status VARCHAR(50) NOT NULL DEFAULT 'PENDING',
    phase INTEGER NOT NULL DEFAULT 1,
    context JSONB DEFAULT '{}'::jsonb,
    phase1_result JSONB DEFAULT '{}'::jsonb,
    phase2_result JSONB DEFAULT '{}'::jsonb,
    phase3_result JSONB DEFAULT '{}'::jsonb,
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

-- Enable RLS on all tables
ALTER TABLE projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE analyses ENABLE ROW LEVEL SECURITY;
ALTER TABLE reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE competitors ENABLE ROW LEVEL SECURITY;
ALTER TABLE analysis_competitors ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_outputs ENABLE ROW LEVEL SECURITY;

-- Create Permissive RLS Policies (allows anyone to query/insert/update/delete for prototype stage)
CREATE POLICY "Allow all operations for projects" ON projects FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all operations for analyses" ON analyses FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all operations for reports" ON reports FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all operations for competitors" ON competitors FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all operations for analysis_competitors" ON analysis_competitors FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all operations for project_outputs" ON project_outputs FOR ALL USING (true) WITH CHECK (true);
