// lib/db/analyses.ts
import { isSupabaseConfigured, supabaseAdmin } from "@/lib/supabase";
import { prisma } from "@/lib/db";
import { memoryDb } from "@/lib/memoryDb";

export async function createAnalysis(userId: string, orgId: string = "dev_org_id", projectId?: string, context?: any) {
  if (isSupabaseConfigured) {
    const { data, error } = await supabaseAdmin
      .from("analyses")
      .insert({
        user_id: userId,
        org_id: orgId,
        project_id: projectId || null,
        status: "pending",
        phase: 0,
        context: context || {},
      })
      .select()
      .single();

    if (error) throw error;
    return data;
  } else {
    // Local DB/memoryDb Fallback
    try {
      const analysis = await prisma.analysis.create({
        data: {
          orgId,
          userId: userId,
          projectId: projectId || null,
          status: "PENDING",
          phase: 0,
          context: context || {},
        }
      });
      return {
        id: analysis.id,
        project_id: analysis.projectId,
        user_id: analysis.userId,
        status: "pending",
        phase: 0,
      };
    } catch (e) {
      console.warn("Prisma failed in createAnalysis. Falling back to memoryDb.");
      const mockId = `an_${Date.now()}`;
      const analysis = {
        id: mockId,
        orgId,
        userId: userId,
        projectId: projectId || null,
        status: "PENDING" as const,
        phase: 0,
        context: context || {},
        phase1Result: null,
        phase2Result: null,
        phase3Result: null,
        errorMessage: null,
        durationMs: null,
        createdAt: new Date(),
        completedAt: null,
      };
      memoryDb.analyses.push(analysis);
      return {
        id: analysis.id,
        project_id: analysis.projectId,
        user_id: analysis.userId,
        status: "pending",
        phase: 0,
      };
    }
  }
}

export async function deleteAnalysis(analysisId: string, userId: string) {
  if (isSupabaseConfigured) {
    const { error } = await supabaseAdmin
      .from("analyses")
      .delete()
      .eq("id", analysisId)
      .eq("user_id", userId);

    if (error) throw error;
    return;
  }

  try {
    await prisma.analysis.delete({ where: { id: analysisId } });
  } catch (e) {
    console.warn("Prisma failed in deleteAnalysis. Falling back to memoryDb.");
    const index = memoryDb.analyses.findIndex(a => a.id === analysisId && a.userId === userId);
    if (index !== -1) memoryDb.analyses.splice(index, 1);
    memoryDb.competitorAnalyses = memoryDb.competitorAnalyses.filter(ca => ca.analysisId !== analysisId);
  }
}

export async function updateAnalysisPhase(
  analysisId: string,
  phase: number,
  phaseKey: string, // "phase1_result" | "phase2_result" | "phase3_result"
  result: object,
  searches: number
) {
  if (isSupabaseConfigured) {
    // Note: total_searches is intentionally not persisted — it's tracked
    // and returned per-step to the client instead, not part of the schema.
    const { error } = await supabaseAdmin
      .from("analyses")
      .update({
        phase,
        status: "running",
        [phaseKey]: result,
      })
      .eq("id", analysisId);

    if (error) throw error;
  } else {
    // Local DB/memoryDb Fallback
    const prismaKey = phaseKey === "phase1_result" ? "phase1Result"
                    : phaseKey === "phase2_result" ? "phase2Result"
                    : "phase3Result";
    try {
      await prisma.analysis.update({
        where: { id: analysisId },
        data: {
          phase,
          status: "RUNNING",
          [prismaKey]: result,
        }
      });
    } catch (e) {
      console.warn("Prisma failed in updateAnalysisPhase. Falling back to memoryDb.");
      const mockAnalysis = memoryDb.analyses.find(a => a.id === analysisId);
      if (mockAnalysis) {
        mockAnalysis.phase = phase;
        mockAnalysis.status = "RUNNING";
        mockAnalysis[prismaKey as "phase1Result" | "phase2Result" | "phase3Result"] = result;
      }
    }
  }
}

export async function completeAnalysis(analysisId: string, durationMs: number) {
  if (isSupabaseConfigured) {
    const { error } = await supabaseAdmin
      .from("analyses")
      .update({
        status: "complete",
        phase: 4,
        completed_at: new Date().toISOString(),
        duration_ms: durationMs,
      })
      .eq("id", analysisId);

    if (error) throw error;
  } else {
    // Local DB/memoryDb Fallback
    try {
      await prisma.analysis.update({
        where: { id: analysisId },
        data: {
          status: "COMPLETE",
          phase: 4,
          completedAt: new Date(),
          durationMs,
        }
      });
    } catch (e) {
      console.warn("Prisma failed in completeAnalysis. Falling back to memoryDb.");
      const mockAnalysis = memoryDb.analyses.find(a => a.id === analysisId);
      if (mockAnalysis) {
        mockAnalysis.status = "COMPLETE";
        mockAnalysis.phase = 4;
        mockAnalysis.completedAt = new Date();
        mockAnalysis.durationMs = durationMs;
      }
    }
  }
}

export async function failAnalysis(analysisId: string, errorMessage: string) {
  if (isSupabaseConfigured) {
    const { error } = await supabaseAdmin
      .from("analyses")
      .update({ status: "failed", error_message: errorMessage })
      .eq("id", analysisId);

    if (error) throw error;
  } else {
    // Local DB/memoryDb Fallback
    try {
      await prisma.analysis.update({
        where: { id: analysisId },
        data: {
          status: "FAILED",
          errorMessage,
        }
      });
    } catch (e) {
      console.warn("Prisma failed in failAnalysis. Falling back to memoryDb.");
      const mockAnalysis = memoryDb.analyses.find(a => a.id === analysisId);
      if (mockAnalysis) {
        mockAnalysis.status = "FAILED";
        mockAnalysis.errorMessage = errorMessage;
      }
    }
  }
}

export async function getAnalysis(analysisId: string) {
  if (isSupabaseConfigured) {
    const { data, error } = await supabaseAdmin
      .from("analyses")
      .select("*, projects(*)")
      .eq("id", analysisId)
      .single();

    if (error) throw error;
    return data;
  } else {
    // Local DB/memoryDb Fallback
    try {
      const analysis = await prisma.analysis.findUnique({
        where: { id: analysisId },
        include: { project: true }
      });
      if (!analysis) return null;
      return {
        id: analysis.id,
        org_id: analysis.orgId,
        project_id: analysis.projectId,
        user_id: analysis.userId,
        status: analysis.status.toLowerCase(),
        phase: analysis.phase,
        context: analysis.context,
        phase1_result: analysis.phase1Result,
        phase2_result: analysis.phase2Result,
        phase3_result: analysis.phase3Result,
        error_message: analysis.errorMessage,
        duration_ms: analysis.durationMs,
        created_at: analysis.createdAt,
        completed_at: analysis.completedAt,
        projects: analysis.project ? {
          id: analysis.project.id,
          name: analysis.project.name,
          product_name: analysis.project.productName,
          industry: analysis.project.industry,
          description: analysis.project.description,
        } : null
      };
    } catch (e) {
      console.warn("Prisma failed in getAnalysis. Falling back to memoryDb.");
      const mockAnalysis = memoryDb.analyses.find(a => a.id === analysisId);
      if (!mockAnalysis) return null;
      const project = memoryDb.projects.find(p => p.id === mockAnalysis.projectId);
      return {
        id: mockAnalysis.id,
        org_id: mockAnalysis.orgId,
        project_id: mockAnalysis.projectId,
        user_id: mockAnalysis.userId,
        status: mockAnalysis.status.toLowerCase(),
        phase: mockAnalysis.phase,
        context: mockAnalysis.context,
        phase1_result: mockAnalysis.phase1Result,
        phase2_result: mockAnalysis.phase2Result,
        phase3_result: mockAnalysis.phase3Result,
        error_message: mockAnalysis.errorMessage,
        duration_ms: mockAnalysis.durationMs,
        created_at: mockAnalysis.createdAt,
        completed_at: mockAnalysis.completedAt,
        projects: project ? {
          id: project.id,
          name: project.name,
          product_name: project.productName,
          industry: project.industry,
          description: project.description,
        } : null
      };
    }
  }
}

export async function getUserAnalyses(userId: string) {
  if (isSupabaseConfigured) {
    const { data, error } = await supabaseAdmin
      .from("analyses")
      .select("*, projects(name, product_name)")
      .eq("user_id", userId)
      .order("created_at", { ascending: false });

    if (error) throw error;
    return data;
  } else {
    // Local DB/memoryDb Fallback
    try {
      const analyses = await prisma.analysis.findMany({
        where: { userId },
        include: { project: true },
        orderBy: { createdAt: "desc" }
      });
      return analyses.map(an => ({
        id: an.id,
        project_id: an.projectId,
        user_id: an.userId,
        status: an.status.toLowerCase(),
        phase: an.phase,
        created_at: an.createdAt,
        projects: an.project ? {
          name: an.project.name,
          product_name: an.project.productName,
        } : null
      }));
    } catch (e) {
      console.warn("Prisma failed in getUserAnalyses. Falling back to memoryDb.");
      const list = memoryDb.analyses.filter(a => a.userId === userId);
      return list.map(an => {
        const project = memoryDb.projects.find(p => p.id === an.projectId);
        return {
          id: an.id,
          project_id: an.projectId,
          user_id: an.userId,
          status: an.status.toLowerCase(),
          phase: an.phase,
          created_at: an.createdAt,
          projects: project ? {
            name: project.name,
            product_name: project.productName,
          } : null
        };
      }).sort((a, b) => b.created_at.getTime() - a.created_at.getTime());
    }
  }
}
