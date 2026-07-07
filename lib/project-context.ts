import { isSupabaseConfigured, supabaseAdmin } from "@/lib/supabase";
import { prisma } from "@/lib/db";
import { memoryDb } from "@/lib/memoryDb";

export interface FullProjectContext {
  // Project basics
  projectId: string;
  productName: string;
  industry: string;
  targetMarket: string;
  description: string;
  pricePoint: string;
  motorTech: string;
  keyDiff: string;
  companyContext: string;
  // From latest competitive analysis
  topCompetitors: any[];
  marketGaps: string[];
  topOpportunities: any[];
  positioning: string;
  quickWins: string[];
  // From pricing tab
  competitorPrices: any[];
  // From GTM tab
  recommendations: any[];
  // From content form
  keyMessages: string[];
  targetAudience: string;
}

export async function buildFullProjectContext(
  projectId: string
): Promise<FullProjectContext | null> {
  if (!projectId) return null;

  let projectObj: any = null;
  let reportObj: any = null;

  // 1. Try Supabase
  if (isSupabaseConfigured) {
    try {
      const { data: project } = await supabaseAdmin
        .from("projects")
        .select(`
          *,
          reports (
            id,
            competitive_analysis,
            pricing_analysis,
            go_to_market,
            content_form
          )
        `)
        .eq("id", projectId)
        .single();

      if (project) {
        projectObj = project;
        reportObj = project.reports?.[0] ?? null;
      }
    } catch (err) {
      console.warn("Supabase buildFullProjectContext fallback:", err);
    }
  }

  // 2. Try Prisma / memoryDb if not found
  if (!projectObj) {
    try {
      const p = await prisma.project.findUnique({
        where: { id: projectId },
        include: { reports: { orderBy: { createdAt: "desc" }, take: 1 } }
      });
      if (p) {
        projectObj = p;
        reportObj = p.reports?.[0] ?? null;
      }
    } catch (e) {
      const p = memoryDb.projects.find(x => x.id === projectId);
      if (p) {
        projectObj = p;
        const r = memoryDb.reports
          .filter(x => x.projectId === projectId)
          .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
        reportObj = r ?? null;
      }
    }
  }

  if (!projectObj) return null;

  const d = projectObj.savedDefaults || projectObj.saved_defaults || {};
  const content = reportObj?.content || {};
  const ca = reportObj?.competitive_analysis || content?.competitive_analysis || {};
  const pricing = reportObj?.pricing_analysis || content?.pricing_analysis || {};
  const gtm = reportObj?.go_to_market || content?.go_to_market || {};
  const cf = reportObj?.content_form || content?.content_form || {};

  return {
    projectId,
    productName: d.productName || projectObj.productName || projectObj.product_name || "Stylecraft Tool",
    industry: d.industry || projectObj.industry || "grooming-barbering",
    targetMarket: d.targetMarket || projectObj.targetMarket || projectObj.target_market || "pro",
    description: d.description || projectObj.description || "",
    pricePoint: d.pricePoint || projectObj.pricePoint || projectObj.price_point || "",
    motorTech: d.motorTech || projectObj.motorTech || projectObj.motor_tech || "",
    keyDiff: d.keyDiff || projectObj.keyDiff || projectObj.key_diff || "",
    companyContext: d.companyContext || projectObj.companyContext || projectObj.company_context || "",
    topCompetitors: [
      ...(ca.large_brand_competitors || ca.largeBrandCompetitors || ca.competitors?.filter((c: any) => c.tier === "legacy") || []),
      ...(ca.indie_emerging_competitors || ca.indieEmergingCompetitors || ca.competitors?.filter((c: any) => c.tier === "emerging") || []),
    ],
    marketGaps: ca.market_gaps || ca.marketGaps || [],
    topOpportunities: ca.top_opportunities || ca.topOpportunities || [],
    positioning: ca.positioning_recommendation || ca.positioningRecommendation || "",
    quickWins: ca.quick_wins || ca.quickWins || [],
    competitorPrices: pricing.competitor_prices || pricing.competitorPrices || [],
    recommendations: gtm.recommendations || [],
    keyMessages: cf.key_messages || cf.keyMessages || [],
    targetAudience: cf.target_audience || cf.targetAudience || "",
  };
}
