// lib/db/reports.ts
import { isSupabaseConfigured, supabaseAdmin } from "@/lib/supabase";
import { prisma } from "@/lib/db";
import { memoryDb, MockReport } from "@/lib/memoryDb";
import { STYLECRAFT_PRODUCTS } from "@/lib/stylecraft-products";

// Find the catalog entry for a product being analyzed, if it's a known
// StyleCraft SKU (matched by name/shortName, case- and punctuation-insensitive).
function matchCatalogProduct(productName: string) {
  if (!productName) return null;
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const target = norm(productName);
  return STYLECRAFT_PRODUCTS.find(p => {
    const name = norm(p.name);
    const short = norm(p.shortName);
    return target === name || target === short || target.includes(short) || short.includes(target);
  }) || null;
}

function priceRange(prices: string[]) {
  const nums = prices.map(p => parseFloat((p || "").replace(/[^0-9.]/g, ""))).filter(n => !isNaN(n) && n > 0);
  if (!nums.length) return null;
  return { min: Math.min(...nums), max: Math.max(...nums) };
}

function buildTargetAudience(
  productName: string,
  targetMarket: string | undefined,
  industry: string | undefined,
  catalogProduct: ReturnType<typeof matchCatalogProduct>,
  gaps: string[],
  legacyPrices: string[]
) {
  const segment =
    targetMarket === "pro"
      ? "Licensed barbers and professional stylists who use their tools for 30+ client services a week"
      : targetMarket === "consumer"
      ? "At-home grooming consumers who cut or maintain their own hair between salon visits"
      : "Both licensed barbers/stylists and at-home grooming consumers";

  const industryLabel = industry === "haircare-styling" ? "hair styling and finishing" : "barbering and grooming";

  const catalogClause = catalogProduct
    ? ` They're shopping specifically within ${catalogProduct.category}${catalogProduct.motorType !== "N/A" ? ` (${catalogProduct.motorType} tier)` : ""}, and care most about: ${catalogProduct.keyFeatures.slice(0, 3).join(", ").toLowerCase()}.`
    : "";

  const range = priceRange(legacyPrices);
  const priceClause = range
    ? ` The established price band for this category runs $${range.min.toFixed(2)}–$${range.max.toFixed(2)}, so buyers are actively comparing ${productName} against that range on value-for-money.`
    : "";

  const gapClause = gaps.length
    ? ` The clearest unmet need in this audience today is: "${gaps[0]}" — a gap the current field of competitors hasn't closed.`
    : "";

  return `${segment} in the ${industryLabel} space.${catalogClause}${priceClause}${gapClause}`.trim();
}

function buildContentFormNotes(
  opps: any[],
  threats: any[],
  p1Comps: any[],
  p2Comps: any[]
) {
  const lines: string[] = [];

  const painPoint = [...p1Comps, ...p2Comps]
    .flatMap((c: any) => c.top_negative_review_themes || [])
    .find(Boolean);
  if (painPoint) {
    lines.push(`Lead creative with a pain point competitors haven't solved: "${painPoint}."`);
  }

  const proofPoint = [...p1Comps, ...p2Comps]
    .flatMap((c: any) => c.top_positive_review_themes || [])
    .filter(Boolean)[0];
  if (proofPoint) {
    lines.push(`Buyers already reward tools that deliver on "${proofPoint}" — call this out explicitly if the product matches it.`);
  }

  if (opps[0]?.description) {
    lines.push(`Primary content angle: ${opps[0].description}`);
  }

  if (threats[0]?.threat_description) {
    lines.push(`Address directly: ${threats[0].threat_description}`);
  }

  return lines.join("\n");
}

function buildGoToMarketNotes(
  positioning: string,
  wins: string[],
  legacyPrices: string[],
  pricePoint: string | undefined
) {
  const lines: string[] = [];
  const range = priceRange(legacyPrices);
  const ourPrice = parseFloat((pricePoint || "").replace(/[^0-9.]/g, ""));

  if (range && !isNaN(ourPrice)) {
    const positionLabel = ourPrice >= range.max ? "premium ceiling" : ourPrice <= range.min ? "value floor" : "mid-pack";
    lines.push(`Priced at the ${positionLabel} of the competitive set ($${range.min.toFixed(2)}–$${range.max.toFixed(2)}); messaging must justify that position on spec or brand equity.`);
  }

  if (wins.length) {
    lines.push(`Immediate launch actions: ${wins.slice(0, 2).join(" ")}`);
  }

  if (positioning) {
    lines.push(`Anchor all channel messaging to the core positioning statement above rather than re-deriving it per channel.`);
  }

  return lines.join("\n");
}

// Helper to structure report sections from analysis results
export function buildReportSections(analysis: {
  phase1: any;
  phase2: any;
  phase3: any;
  productName: string;
  industry?: string;
  targetMarket?: string;
  pricePoint?: string;
}) {
  const p1Comps = analysis.phase1?.competitors || [];
  const p2Comps = analysis.phase2?.competitors || [];
  const snapshot = analysis.phase3?.market_snapshot || {};
  const trends = analysis.phase3?.key_trends || [];
  const gaps = analysis.phase3?.market_gaps || [];
  const threats = analysis.phase3?.top_threats || [];
  const opps = analysis.phase3?.top_opportunities || [];
  const positioning = analysis.phase3?.positioning_recommendation || "";
  const recommendations = analysis.phase3?.strategic_recommendations || [];
  const wins = analysis.phase3?.quick_wins || [];

  const catalogProduct = matchCatalogProduct(analysis.productName);
  const legacyPrices = p1Comps.map((c: any) => c.price).filter(Boolean);

  return {
    competitive_analysis: {
      product_name: analysis.productName,
      large_brand_competitors: p1Comps,
      indie_emerging_competitors: p2Comps,
      market_snapshot: snapshot,
      key_trends: trends,
      market_gaps: gaps,
      top_threats: threats,
      top_opportunities: opps,
      positioning_recommendation: positioning,
      strategic_recommendations: recommendations,
      quick_wins: wins,
    },
    pricing_analysis: {
      competitors_pricing: [
        ...p1Comps.map((c: any) => ({ name: c.name, price: c.price, tier: "large" })),
        ...p2Comps.map((c: any) => ({ name: c.name, price: c.price, tier: "emerging" })),
      ],
      price_positioning: snapshot.headline_stat_value || "",
      notes: "",
    },
    go_to_market: {
      recommendations: recommendations,
      quick_wins: wins,
      positioning: positioning,
      notes: buildGoToMarketNotes(positioning, wins, legacyPrices, analysis.pricePoint ?? catalogProduct?.pricePoint),
    },
    content_form: {
      product_name: analysis.productName,
      key_messages: opps.map((o: any) => o.action || o.detail || o.description || ""),
      target_audience: buildTargetAudience(
        analysis.productName,
        analysis.targetMarket ?? catalogProduct?.targetMarket,
        analysis.industry ?? catalogProduct?.industry,
        catalogProduct,
        gaps,
        legacyPrices
      ),
      notes: buildContentFormNotes(opps, threats, p1Comps, p2Comps),
    },
  };
}

function toApiShape(r: MockReport, project?: { id: string; name: string; productName: string } | null) {
  return {
    id: r.id,
    user_id: r.userId,
    analysis_id: r.analysisId ?? null,
    project_id: r.projectId,
    title: r.title,
    status: r.status,
    competitive_analysis: r.competitive_analysis ?? {},
    pricing_analysis: r.pricing_analysis ?? {},
    go_to_market: r.go_to_market ?? {},
    content_form: r.content_form ?? {},
    product_knowledge: r.product_knowledge ?? {},
    created_at: r.createdAt,
    updated_at: r.updatedAt,
    projects: project ? { id: project.id, name: project.name, product_name: project.productName } : null,
  };
}

// Create report from analysis result
export async function createReportFromAnalysis(
  userId: string,
  analysisId: string,
  projectId: string | null,
  analysis: {
    phase1: any;
    phase2: any;
    phase3: any;
    productName: string;
    industry?: string;
    targetMarket?: string;
    pricePoint?: string;
  },
  orgId: string = "dev_org_id"
) {
  const sections = buildReportSections(analysis);
  const title = `Competitive Analysis — ${analysis.productName}`;

  if (isSupabaseConfigured) {
    const { data: report, error } = await supabaseAdmin
      .from("reports")
      .insert({
        user_id: userId,
        analysis_id: analysisId,
        project_id: projectId || null,
        title: title,
        status: "draft",
        competitive_analysis: sections.competitive_analysis,
        pricing_analysis: sections.pricing_analysis,
        go_to_market: sections.go_to_market,
        content_form: sections.content_form,
      })
      .select()
      .single();

    if (error) throw error;

    try {
      await saveAnalysisCompetitors(analysisId, userId, analysis.phase1, analysis.phase2);
      if (projectId) {
        await supabaseAdmin
          .from("projects")
          .update({
            latest_analysis_id: analysisId,
            latest_report_id: report.id,
            last_used_at: new Date().toISOString(),
          })
          .eq("id", projectId);
      }
    } catch (saveErr) {
      console.error("Failed to update project latest analysis/report:", saveErr);
    }

    return report;
  }

  // Local DB/memoryDb Fallback
  try {
    const report = await prisma.report.create({
      data: {
        orgId,
        projectId: projectId || null,
        title,
        status: "DRAFT",
        content: sections,
      },
    });

    if (projectId) {
      await prisma.project.update({
        where: { id: projectId },
        data: { updatedAt: new Date() },
      }).catch(() => {});
    }

    return toApiShape({
      id: report.id,
      orgId: report.orgId,
      userId,
      projectId: report.projectId,
      analysisId,
      title: report.title,
      status: report.status,
      fileUrl: report.fileUrl,
      content: sections,
      ...sections,
      createdAt: report.createdAt,
      updatedAt: report.updatedAt,
    });
  } catch (e) {
    console.warn("Prisma failed in createReportFromAnalysis. Falling back to memoryDb.");
    const mockReport: MockReport = {
      id: `rpt_${Date.now()}`,
      orgId,
      userId,
      projectId: projectId || null,
      analysisId,
      title,
      status: "draft",
      content: sections,
      fileUrl: null,
      ...sections,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    memoryDb.reports.push(mockReport);

    if (projectId) {
      const project = memoryDb.projects.find(p => p.id === projectId);
      if (project) {
        project.latestAnalysisId = analysisId;
        project.latestReportId = mockReport.id;
        project.lastUsedAt = new Date();
        project.updatedAt = new Date();
      }
    }

    return toApiShape(mockReport);
  }
}

export async function getUserReports(userId: string) {
  if (isSupabaseConfigured) {
    const { data, error } = await supabaseAdmin
      .from("reports")
      .select(`
        id, title, status, created_at, updated_at, project_id,
        projects (id, name, product_name)
      `)
      .eq("user_id", userId)
      .order("updated_at", { ascending: false });

    if (error) throw error;
    return data ?? [];
  }

  try {
    const reports = await prisma.report.findMany({
      include: { project: true },
      orderBy: { updatedAt: "desc" },
    });
    return reports.map(r => toApiShape({
      id: r.id, orgId: r.orgId, userId, projectId: r.projectId, analysisId: null,
      title: r.title, status: r.status, fileUrl: r.fileUrl, content: r.content,
      ...(r.content as any || {}),
      createdAt: r.createdAt, updatedAt: r.updatedAt,
    }, r.project ? { id: r.project.id, name: r.project.name, productName: r.project.productName } : null));
  } catch (e) {
    console.warn("Prisma failed in getUserReports. Falling back to memoryDb.");
    return memoryDb.reports
      .filter(r => r.userId === userId)
      .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
      .map(r => {
        const project = memoryDb.projects.find(p => p.id === r.projectId);
        return toApiShape(r, project ? { id: project.id, name: project.name, productName: project.productName } : null);
      });
  }
}

export async function getReport(reportId: string, userId: string) {
  if (isSupabaseConfigured) {
    const { data, error } = await supabaseAdmin
      .from("reports")
      .select("*, projects(name, product_name), analyses(*)")
      .eq("id", reportId)
      .eq("user_id", userId)
      .single();

    if (error) throw error;
    return data;
  }

  try {
    const report = await prisma.report.findUnique({
      where: { id: reportId },
      include: { project: true },
    });
    if (!report) return null;
    return toApiShape({
      id: report.id, orgId: report.orgId, userId, projectId: report.projectId, analysisId: null,
      title: report.title, status: report.status, fileUrl: report.fileUrl, content: report.content,
      ...(report.content as any || {}),
      createdAt: report.createdAt, updatedAt: report.updatedAt,
    }, report.project ? { id: report.project.id, name: report.project.name, productName: report.project.productName } : null);
  } catch (e) {
    console.warn("Prisma failed in getReport. Falling back to memoryDb.");
    const report = memoryDb.reports.find(r => r.id === reportId && r.userId === userId);
    if (!report) return null;
    const project = memoryDb.projects.find(p => p.id === report.projectId);
    return toApiShape(report, project ? { id: project.id, name: project.name, productName: project.productName } : null);
  }
}

export async function getAllReportsForLinking(userId: string) {
  // ALL reports the user has (linked or not) — shown in the Link Report modal
  if (isSupabaseConfigured) {
    const { data, error } = await supabaseAdmin
      .from("reports")
      .select("id, title, status, created_at, project_id, projects(name)")
      .eq("user_id", userId)
      .order("created_at", { ascending: false });

    if (error) throw error;
    return data ?? [];
  }

  try {
    const reports = await prisma.report.findMany({
      include: { project: true },
      orderBy: { createdAt: "desc" },
    });
    return reports.map(r => toApiShape({
      id: r.id, orgId: r.orgId, userId, projectId: r.projectId, analysisId: null,
      title: r.title, status: r.status, fileUrl: r.fileUrl, content: r.content,
      createdAt: r.createdAt, updatedAt: r.updatedAt,
    }, r.project ? { id: r.project.id, name: r.project.name, productName: r.project.productName } : null));
  } catch (e) {
    console.warn("Prisma failed in getAllReportsForLinking. Falling back to memoryDb.");
    return memoryDb.reports
      .filter(r => r.userId === userId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .map(r => {
        const project = memoryDb.projects.find(p => p.id === r.projectId);
        return toApiShape(r, project ? { id: project.id, name: project.name, productName: project.productName } : null);
      });
  }
}

export async function linkReportToProject(reportId: string, projectId: string, userId: string) {
  if (isSupabaseConfigured) {
    const { data, error } = await supabaseAdmin
      .from("reports")
      .update({ project_id: projectId })
      .eq("id", reportId)
      .eq("user_id", userId)
      .select()
      .single();

    if (error) throw error;

    await supabaseAdmin
      .from("projects")
      .update({ latest_report_id: reportId, latest_analysis_id: data.analysis_id })
      .eq("id", projectId)
      .eq("user_id", userId);

    return data;
  }

  try {
    const report = await prisma.report.update({
      where: { id: reportId },
      data: { projectId },
    });
    return toApiShape({
      id: report.id, orgId: report.orgId, userId, projectId: report.projectId, analysisId: null,
      title: report.title, status: report.status, fileUrl: report.fileUrl, content: report.content,
      ...(report.content as any || {}),
      createdAt: report.createdAt, updatedAt: report.updatedAt,
    });
  } catch (e) {
    console.warn("Prisma failed in linkReportToProject. Falling back to memoryDb.");
    const report = memoryDb.reports.find(r => r.id === reportId && r.userId === userId);
    if (!report) throw new Error("Report not found");
    report.projectId = projectId;
    report.updatedAt = new Date();

    const project = memoryDb.projects.find(p => p.id === projectId);
    if (project) {
      project.latestReportId = reportId;
      project.latestAnalysisId = report.analysisId ?? project.latestAnalysisId;
      project.lastUsedAt = new Date();
    }

    return toApiShape(report, project ? { id: project.id, name: project.name, productName: project.productName } : null);
  }
}

export async function updateReport(reportId: string, userId: string, updates: any) {
  if (isSupabaseConfigured) {
    const { data, error } = await supabaseAdmin
      .from("reports")
      .update(updates)
      .eq("id", reportId)
      .eq("user_id", userId)
      .select()
      .single();

    if (error) throw error;
    return data;
  }

  // Translate the Supabase-shaped snake_case relational keys into the
  // internal camelCase fields used by Prisma/memoryDb. Content-blob keys
  // (competitive_analysis, pricing_analysis, go_to_market, content_form)
  // and title/status pass through unchanged.
  const { project_id, analysis_id, ...rest } = updates;
  const prismaData: any = { ...rest };
  if (project_id !== undefined) prismaData.projectId = project_id;

  try {
    const report = await prisma.report.update({
      where: { id: reportId },
      data: {
        ...(prismaData.title !== undefined ? { title: prismaData.title } : {}),
        ...(prismaData.status !== undefined ? { status: prismaData.status } : {}),
        ...(prismaData.projectId !== undefined ? { projectId: prismaData.projectId } : {}),
        content: { ...rest },
      },
    });
    return toApiShape({
      id: report.id, orgId: report.orgId, userId, projectId: report.projectId, analysisId: null,
      title: report.title, status: report.status, fileUrl: report.fileUrl, content: report.content,
      ...(report.content as any || {}),
      createdAt: report.createdAt, updatedAt: report.updatedAt,
    });
  } catch (e) {
    console.warn("Prisma failed in updateReport. Falling back to memoryDb.");
    const report = memoryDb.reports.find(r => r.id === reportId && r.userId === userId);
    if (!report) throw new Error("Report not found");

    Object.assign(report, rest);
    if (project_id !== undefined) report.projectId = project_id;
    if (analysis_id !== undefined) report.analysisId = analysis_id;
    report.updatedAt = new Date();

    const project = memoryDb.projects.find(p => p.id === report.projectId);
    return toApiShape(report, project ? { id: project.id, name: project.name, productName: project.productName } : null);
  }
}

export async function deleteReport(reportId: string, userId: string) {
  if (isSupabaseConfigured) {
    const { error } = await supabaseAdmin
      .from("reports")
      .delete()
      .eq("id", reportId)
      .eq("user_id", userId);

    if (error) throw error;
    return;
  }

  try {
    await prisma.report.delete({ where: { id: reportId } });
  } catch (e) {
    console.warn("Prisma failed in deleteReport. Falling back to memoryDb.");
    const index = memoryDb.reports.findIndex(r => r.id === reportId && r.userId === userId);
    if (index !== -1) memoryDb.reports.splice(index, 1);
  }
}

export async function getProjectReports(projectId: string, userId: string) {
  if (isSupabaseConfigured) {
    const { data, error } = await supabaseAdmin
      .from("reports")
      .select("*")
      .eq("project_id", projectId)
      .eq("user_id", userId)
      .order("created_at", { ascending: false });

    if (error) throw error;
    return data;
  }

  try {
    const reports = await prisma.report.findMany({
      where: { projectId },
      orderBy: { createdAt: "desc" },
    });
    return reports.map(r => toApiShape({
      id: r.id, orgId: r.orgId, userId, projectId: r.projectId, analysisId: null,
      title: r.title, status: r.status, fileUrl: r.fileUrl, content: r.content,
      ...(r.content as any || {}),
      createdAt: r.createdAt, updatedAt: r.updatedAt,
    }));
  } catch (e) {
    console.warn("Prisma failed in getProjectReports. Falling back to memoryDb.");
    return memoryDb.reports
      .filter(r => r.projectId === projectId && r.userId === userId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .map(r => toApiShape(r));
  }
}

async function saveAnalysisCompetitors(
  analysisId: string,
  userId: string,
  phase1: any,
  phase2: any
) {
  const allCompetitors = [
    ...(phase1?.competitors || []).map((c: any) => ({ ...c, tier: "legacy" })),
    ...(phase2?.competitors || []).map((c: any) => ({ ...c, tier: "emerging" })),
  ];

  const rows = allCompetitors.map(c => ({
    analysis_id:          analysisId,
    user_id:              userId,
    name:                 c.name,
    brand:                c.brand,
    tier:                 c.tier,
    asin:                 c.asin   || null,
    amazon_url:           c.asin   ? `https://www.amazon.com/dp/${c.asin}` : null,
    price:                c.price  || null,
    rating:               c.rating || null,
    review_count:         c.review_count || null,
    monthly_sales:        c.monthly_sales || null,
    bsr_rank:             c.bsr_rank || null,
    initials:             c.initials || c.name.substring(0, 2).toUpperCase(),
    key_features:         c.key_features || [],
    strengths:            c.strengths || [],
    weaknesses:           c.weaknesses || [],
    recent_news:          c.recent_news || [],
    top_feature_summary:  c.top_feature_summary || "",
    threat_score:         c.threat_score ?? (c.tier === "legacy" ? 75 : 55),
    tags:                 c.tags || [],
  }));

  if (rows.length === 0) return;

  const { error } = await supabaseAdmin
    .from("analysis_competitors")
    .insert(rows);

  if (error) console.error("Failed to save analysis competitors:", error);
}
