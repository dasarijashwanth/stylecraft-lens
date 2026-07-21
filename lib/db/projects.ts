// lib/db/projects.ts
import { isSupabaseConfigured, supabaseAdmin } from "@/lib/supabase";
import { prisma } from "@/lib/db";
import { memoryDb, MockProject } from "@/lib/memoryDb";

interface ProjectInput {
  name: string;
  industry: string;
  targetMarket: string;
  productName: string;
  description?: string;
  category?: string;
  companyContext?: string;
  motorTech?: string;
  keyDiff?: string;
  pricePoint?: string;
  // The product-anchor identity, captured once at creation. `name` above
  // stays a free-text reference label only — generation prompts must
  // identify the product via a captured snapshot / this URL / this ASIN,
  // never via the project name (see lib/snapshot-capture.ts).
  productUrl?: string;
  asin?: string;
}

// Supabase columns are snake_case, but the rest of this app (Prisma models,
// memoryDb, and every frontend page) uses camelCase — normalize here so
// callers never need to know which store actually served the request.
function toProjectShape(row: any) {
  return {
    id: row.id,
    orgId: row.org_id,
    userId: row.user_id,
    name: row.name,
    industry: row.industry,
    targetMarket: row.target_market,
    productName: row.product_name,
    description: row.description,
    category: row.category,
    companyContext: row.company_context,
    motorTech: row.motor_tech,
    keyDiff: row.key_diff,
    pricePoint: row.price_point,
    productUrl: row.product_url,
    asin: row.asin,
    savedDefaults: row.saved_defaults,
    latestAnalysisId: row.latest_analysis_id,
    latestReportId: row.latest_report_id,
    lastUsedAt: row.last_used_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    analyses: row.analyses ?? [],
    reports: row.reports ?? [],
    generationState: row.project_generation_state
      ? { phase: row.project_generation_state.phase, status: row.project_generation_state.status, errorMessage: row.project_generation_state.error_message }
      : null,
  };
}

export async function createProject(userId: string, orgId: string, data: ProjectInput) {
  if (isSupabaseConfigured) {
    const { data: project, error } = await supabaseAdmin
      .from("projects")
      .insert({
        user_id: userId,
        org_id: orgId,
        name: data.name,
        industry: data.industry,
        target_market: data.targetMarket,
        product_name: data.productName,
        description: data.description ?? "",
        category: data.category ?? null,
        company_context: data.companyContext ?? null,
        motor_tech: data.motorTech ?? null,
        key_diff: data.keyDiff ?? null,
        price_point: data.pricePoint ?? null,
        product_url: data.productUrl ?? null,
        asin: data.asin ?? null,
        last_used_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (error) throw error;
    return toProjectShape(project);
  }

  try {
    const project = await prisma.project.create({
      data: {
        orgId,
        userId,
        name: data.name,
        industry: data.industry,
        targetMarket: data.targetMarket,
        productName: data.productName,
        description: data.description ?? "",
        category: data.category || null,
        companyContext: data.companyContext || null,
        motorTech: data.motorTech || null,
        keyDiff: data.keyDiff || null,
        pricePoint: data.pricePoint || null,
      },
    });
    return project;
  } catch (e) {
    console.warn("Prisma failed in createProject. Falling back to memoryDb.");
    const project: MockProject = {
      id: `proj_${Date.now()}`,
      orgId,
      userId,
      name: data.name,
      industry: data.industry,
      targetMarket: data.targetMarket,
      productName: data.productName,
      description: data.description ?? "",
      category: data.category || null,
      companyContext: data.companyContext || null,
      motorTech: data.motorTech || null,
      keyDiff: data.keyDiff || null,
      pricePoint: data.pricePoint || null,
      productUrl: data.productUrl || null,
      asin: data.asin || null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    memoryDb.projects.push(project);
    return project;
  }
}

export async function getUserProjects(orgId: string) {
  if (isSupabaseConfigured) {
    const { data, error } = await supabaseAdmin
      .from("projects")
      .select("*, analyses(*), reports(*), project_generation_state(phase, status, error_message)")
      .eq("org_id", orgId)
      .order("last_used_at", { ascending: false });

    if (error) throw error;
    return (data ?? []).map(toProjectShape);
  }

  try {
    return await prisma.project.findMany({
      where: { orgId },
      include: {
        analyses: true,
        competitors: { include: { competitor: true } },
        reports: true,
      },
      orderBy: { updatedAt: "desc" },
    });
  } catch (e) {
    console.warn("Prisma failed in getUserProjects. Falling back to memoryDb.");
    return memoryDb.projects
      .filter(p => p.orgId === orgId)
      .map(p => {
        const analyses = memoryDb.analyses.filter(a => a.projectId === p.id);
        const reports = memoryDb.reports.filter(r => r.projectId === p.id);
        const competitors = memoryDb.competitors
          .filter(c => c.orgId === orgId)
          .slice(0, 3)
          .map(c => ({ competitorId: c.id, competitor: c }));
        const genState = memoryDb.projectGenerationState.find(s => s.projectId === p.id);
        const generationState = genState ? { phase: genState.phase, status: genState.status, errorMessage: genState.errorMessage } : null;
        return { ...p, analyses, reports, competitors, generationState };
      })
      .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
  }
}

export async function getProject(projectId: string, orgId: string) {
  if (isSupabaseConfigured) {
    const { data, error } = await supabaseAdmin
      .from("projects")
      .select("*, analyses(*), reports(*)")
      .eq("id", projectId)
      .eq("org_id", orgId)
      .maybeSingle();

    if (error) throw error;
    if (!data) return null;
    return toProjectShape(data);
  }

  try {
    const project = await prisma.project.findUnique({
      where: { id: projectId },
      include: {
        analyses: { orderBy: { createdAt: "desc" } },
        competitors: { include: { competitor: true } },
        reports: { orderBy: { createdAt: "desc" } },
      },
    });
    if (!project || project.orgId !== orgId) return null;
    return project;
  } catch (e) {
    console.warn("Prisma failed in getProject. Falling back to memoryDb.");
    const project = memoryDb.projects.find(p => p.id === projectId);
    if (!project || project.orgId !== orgId) return null;

    const analyses = memoryDb.analyses
      .filter(a => a.projectId === projectId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    const reports = memoryDb.reports
      .filter(r => r.projectId === projectId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    const competitors = memoryDb.competitors
      .filter(c => c.orgId === orgId)
      .slice(0, 3)
      .map(c => ({ competitorId: c.id, competitor: c }));

    return { ...project, analyses, reports, competitors };
  }
}

const UPDATABLE_FIELDS: Record<string, string> = {
  name: "name",
  industry: "industry",
  targetMarket: "target_market",
  productName: "product_name",
  description: "description",
  category: "category",
  companyContext: "company_context",
  motorTech: "motor_tech",
  keyDiff: "key_diff",
  pricePoint: "price_point",
  productUrl: "product_url",
  asin: "asin",
  savedDefaults: "saved_defaults",
  latestAnalysisId: "latest_analysis_id",
  latestReportId: "latest_report_id",
  lastUsedAt: "last_used_at",
};

export async function updateProject(projectId: string, orgId: string, updates: Record<string, any>) {
  if (isSupabaseConfigured) {
    const snakeUpdates: Record<string, any> = { last_used_at: new Date().toISOString() };
    for (const [key, value] of Object.entries(updates)) {
      if (UPDATABLE_FIELDS[key]) snakeUpdates[UPDATABLE_FIELDS[key]] = value;
    }

    const { data, error } = await supabaseAdmin
      .from("projects")
      .update(snakeUpdates)
      .eq("id", projectId)
      .eq("org_id", orgId)
      .select()
      .single();

    if (error) throw error;
    return toProjectShape(data);
  }

  try {
    const existing = await prisma.project.findUnique({ where: { id: projectId } });
    if (!existing || existing.orgId !== orgId) throw new Error("Project not found");
    return await prisma.project.update({ where: { id: projectId }, data: updates });
  } catch (e) {
    console.warn("Prisma failed in updateProject. Falling back to memoryDb.");
    const index = memoryDb.projects.findIndex(p => p.id === projectId && p.orgId === orgId);
    if (index === -1) throw new Error("Project not found");
    const updated = { ...memoryDb.projects[index], ...updates, updatedAt: new Date() };
    memoryDb.projects[index] = updated;
    return updated;
  }
}

export async function deleteProject(projectId: string, orgId: string) {
  if (isSupabaseConfigured) {
    const { error } = await supabaseAdmin
      .from("projects")
      .delete()
      .eq("id", projectId)
      .eq("org_id", orgId);

    if (error) throw error;
    return;
  }

  try {
    await prisma.project.delete({ where: { id: projectId } });
  } catch (e) {
    console.warn("Prisma failed in deleteProject. Falling back to memoryDb.");
    const index = memoryDb.projects.findIndex(p => p.id === projectId && p.orgId === orgId);
    if (index !== -1) memoryDb.projects.splice(index, 1);
    memoryDb.analyses = memoryDb.analyses.filter(a => a.projectId !== projectId);
    memoryDb.reports = memoryDb.reports.filter(r => r.projectId !== projectId);
  }
}
