// lib/db/reports.ts
import { isSupabaseConfigured, supabaseAdmin } from "@/lib/supabase";
import { prisma } from "@/lib/db";
import { memoryDb } from "@/lib/memoryDb";

// Helper to structure report sections from analysis results
function buildReportSections(analysis: {
  phase1: any;
  phase2: any;
  phase3: any;
  productName: string;
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
      notes: "",
    },
    content_form: {
      product_name: analysis.productName,
      key_messages: opps.map((o: any) => o.action || o.detail || o.description || ""),
      target_audience: "",
      notes: "",
    },
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
  }
) {
  const sections = buildReportSections(analysis);
  const title = `Competitive Analysis — ${analysis.productName}`;

  if (isSupabaseConfigured) {
    const { data, error } = await supabaseAdmin
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
            latest_report_id: data.id,
            last_used_at: new Date().toISOString(),
          })
          .eq("id", projectId);
      }
    } catch (saveErr) {
      console.error("Failed to update project latest analysis/report:", saveErr);
    }
    return data;
  } else {
    // Local DB/memoryDb Fallback
    try {
      const report = await prisma.report.create({
        data: {
          orgId: "dev_org_id",
          projectId: projectId || null,
          title,
          content: sections as any,
          status: "DRAFT",
        }
      });
      if (projectId) {
        try {
          await prisma.project.update({
            where: { id: projectId },
            data: { updatedAt: new Date() }
          });
        } catch (e) {}
      }
      return {
        id: report.id,
        user_id: userId,
        analysis_id: analysisId,
        project_id: report.projectId,
        title: report.title,
        status: "draft",
        ...sections
      };
    } catch (e) {
      console.warn("Prisma failed in createReportFromAnalysis. Falling back to memoryDb.");
      const mockId = `rep_${Date.now()}`;
      const report = {
        id: mockId,
        orgId: "dev_org_id",
        projectId: projectId || null,
        title,
        content: sections,
        status: "DRAFT" as const,
        fileUrl: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      memoryDb.reports.push(report);

      if (projectId) {
        const memP = memoryDb.projects.find(p => p.id === projectId);
        if (memP) {
          memP.latestAnalysisId = analysisId;
          memP.latestReportId = mockId;
          memP.lastUsedAt = new Date();
        }
      }

      return {
        id: report.id,
        user_id: userId,
        analysis_id: analysisId,
        project_id: report.projectId,
        title: report.title,
        status: "draft",
        ...sections
      };
    }
  }
}

// Update (edit) a report section
export async function updateReport(
  reportId: string,
  userId: string,
  updates: {
    competitive_analysis?: object;
    pricing_analysis?: object;
    go_to_market?: object;
    content_form?: object;
    status?: string;
    title?: string;
  }
) {
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
  } else {
    // Local DB/memoryDb Fallback
    try {
      // Find existing content first
      const existingReport = await prisma.report.findUnique({ where: { id: reportId } });
      const currentContent = (existingReport?.content as any) || {};
      
      const newContent = {
        ...currentContent,
        ...(updates.competitive_analysis ? { competitive_analysis: updates.competitive_analysis } : {}),
        ...(updates.pricing_analysis ? { pricing_analysis: updates.pricing_analysis } : {}),
        ...(updates.go_to_market ? { go_to_market: updates.go_to_market } : {}),
        ...(updates.content_form ? { content_form: updates.content_form } : {}),
      };

      const updatedReport = await prisma.report.update({
        where: { id: reportId },
        data: {
          ...(updates.title ? { title: updates.title } : {}),
          ...(updates.status ? { status: updates.status.toUpperCase() as any } : {}),
          content: newContent,
        }
      });

      return {
        id: updatedReport.id,
        user_id: userId,
        title: updatedReport.title,
        status: updatedReport.status.toLowerCase(),
        ...newContent
      };
    } catch (e) {
      console.warn("Prisma failed in updateReport. Falling back to memoryDb.");
      const mockReport = memoryDb.reports.find(r => r.id === reportId);
      if (mockReport) {
        if (updates.title) mockReport.title = updates.title;
        if (updates.status) mockReport.status = updates.status.toUpperCase() as any;
        mockReport.content = {
          ...mockReport.content,
          ...(updates.competitive_analysis ? { competitive_analysis: updates.competitive_analysis } : {}),
          ...(updates.pricing_analysis ? { pricing_analysis: updates.pricing_analysis } : {}),
          ...(updates.go_to_market ? { go_to_market: updates.go_to_market } : {}),
          ...(updates.content_form ? { content_form: updates.content_form } : {}),
        };
        mockReport.updatedAt = new Date();
        return {
          id: mockReport.id,
          user_id: userId,
          title: mockReport.title,
          status: mockReport.status.toLowerCase(),
          ...mockReport.content
        };
      }
      throw new Error("Report not found");
    }
  }
}

// Get single report
export async function getReport(reportId: string, userId: string) {
  if (isSupabaseConfigured) {
    const { data, error } = await supabaseAdmin
      .from("reports")
      .select("*, analyses(*), projects(*)")
      .eq("id", reportId)
      .eq("user_id", userId)
      .single();

    if (error) throw error;
    return data;
  } else {
    // Local DB/memoryDb Fallback
    try {
      const report = await prisma.report.findUnique({
        where: { id: reportId },
        include: { project: true }
      });
      if (!report) return null;
      const content = (report.content as any) || {};
      return {
        id: report.id,
        project_id: report.projectId,
        user_id: userId,
        title: report.title,
        status: report.status.toLowerCase(),
        created_at: report.createdAt,
        updated_at: report.updatedAt,
        competitive_analysis: content.competitive_analysis || null,
        pricing_analysis: content.pricing_analysis || null,
        go_to_market: content.go_to_market || null,
        content_form: content.content_form || null,
        projects: report.project || null,
      };
    } catch (e) {
      console.warn("Prisma failed in getReport. Falling back to memoryDb.");
      const mockReport = memoryDb.reports.find(r => r.id === reportId);
      if (!mockReport) return null;
      const project = memoryDb.projects.find(p => p.id === mockReport.projectId);
      const content = mockReport.content || {};
      return {
        id: mockReport.id,
        project_id: mockReport.projectId,
        user_id: userId,
        title: mockReport.title,
        status: mockReport.status.toLowerCase(),
        created_at: mockReport.createdAt,
        updated_at: mockReport.updatedAt,
        competitive_analysis: content.competitive_analysis || null,
        pricing_analysis: content.pricing_analysis || null,
        go_to_market: content.go_to_market || null,
        content_form: content.content_form || null,
        projects: project || null,
      };
    }
  }
}

// Get all reports for user
export async function getUserReports(userId: string) {
  if (isSupabaseConfigured) {
    const { data, error } = await supabaseAdmin
      .from("reports")
      .select("id, title, status, created_at, updated_at, projects(name)")
      .eq("user_id", userId)
      .order("updated_at", { ascending: false });

    if (error) throw error;
    return data;
  } else {
    // Local DB/memoryDb Fallback
    try {
      const reports = await prisma.report.findMany({
        include: { project: true },
        orderBy: { updatedAt: "desc" }
      });
      return reports.map(r => ({
        id: r.id,
        title: r.title,
        status: r.status.toLowerCase(),
        created_at: r.createdAt,
        updated_at: r.updatedAt,
        projects: r.project ? { name: r.project.name } : null
      }));
    } catch (e) {
      console.warn("Prisma failed in getUserReports. Falling back to memoryDb.");
      const list = memoryDb.reports;
      return list.map(r => {
        const project = memoryDb.projects.find(p => p.id === r.projectId);
        return {
          id: r.id,
          title: r.title,
          status: r.status.toLowerCase(),
          created_at: r.createdAt,
          updated_at: r.updatedAt,
          projects: project ? { name: project.name } : null
        };
      }).sort((a, b) => b.updated_at.getTime() - a.updated_at.getTime());
    }
  }
}

// Get reports for a project (for Projects page)
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
  } else {
    // Local DB/memoryDb Fallback
    try {
      const reports = await prisma.report.findMany({
        where: { projectId },
        orderBy: { createdAt: "desc" }
      });
      return reports.map(r => {
        const content = (r.content as any) || {};
        return {
          id: r.id,
          project_id: r.projectId,
          user_id: userId,
          title: r.title,
          status: r.status.toLowerCase(),
          created_at: r.createdAt,
          updated_at: r.updatedAt,
          competitive_analysis: content.competitive_analysis || null,
          pricing_analysis: content.pricing_analysis || null,
          go_to_market: content.go_to_market || null,
          content_form: content.content_form || null,
        };
      });
    } catch (e) {
      console.warn("Prisma failed in getProjectReports. Falling back to memoryDb.");
      const list = memoryDb.reports.filter(r => r.projectId === projectId);
      return list.map(r => {
        const content = r.content || {};
        return {
          id: r.id,
          project_id: r.projectId,
          user_id: userId,
          title: r.title,
          status: r.status.toLowerCase(),
          created_at: r.createdAt,
          updated_at: r.updatedAt,
          competitive_analysis: content.competitive_analysis || null,
          pricing_analysis: content.pricing_analysis || null,
          go_to_market: content.go_to_market || null,
          content_form: content.content_form || null,
        };
      }).sort((a, b) => b.created_at.getTime() - a.created_at.getTime());
    }
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
