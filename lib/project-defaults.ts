import { isSupabaseConfigured, supabaseAdmin } from "@/lib/supabase";
import { prisma } from "@/lib/db";
import { memoryDb } from "@/lib/memoryDb";

export interface ProjectDefaults {
  // Core product info
  productName: string;
  industry: string;
  targetMarket: "pro" | "consumer" | "both";
  description: string;
  category: string;
  pricePoint: string;
  // Company info
  companyName: string;
  companyContext: string;
  website: string;
  // Technical
  motorTech: string;
  keyDiff: string;
  // StylecraftUS product link
  stylecraftProductId: string;
}

// Save defaults whenever user submits a form
export async function saveProjectDefaults(
  projectId: string,
  userId: string,
  defaults: Partial<ProjectDefaults>
) {
  if (!projectId) return;

  const cleanDefaults = Object.fromEntries(
    Object.entries(defaults).filter(([_, v]) => v !== "" && v !== null && v !== undefined)
  );

  // 1. Supabase update if configured
  if (isSupabaseConfigured) {
    try {
      const { data: existing } = await supabaseAdmin
        .from("projects")
        .select("saved_defaults")
        .eq("id", projectId)
        .single();

      const merged = {
        ...(existing?.saved_defaults ?? {}),
        ...cleanDefaults,
      };

      await supabaseAdmin
        .from("projects")
        .update({
          saved_defaults: merged,
          last_used_at: new Date().toISOString(),
        })
        .eq("id", projectId);
    } catch (err) {
      console.warn("Supabase saveProjectDefaults failed, using memory/prisma fallback:", err);
    }
  }

  // 2. Prisma / memoryDb update
  try {
    const proj = await prisma.project.findUnique({ where: { id: projectId } });
    if (proj) {
      const existing = (proj as any).savedDefaults || {};
      await prisma.project.update({
        where: { id: projectId },
        data: {
          updatedAt: new Date(),
        } as any,
      });
    }
  } catch (e) {
    const memProj = memoryDb.projects.find(p => p.id === projectId);
    if (memProj) {
      memProj.savedDefaults = {
        ...(memProj.savedDefaults || {}),
        ...cleanDefaults,
      };
      memProj.lastUsedAt = new Date();
    }
  }
}

// Load defaults for a project
export async function loadProjectDefaults(
  projectId: string,
  userId: string
): Promise<Partial<ProjectDefaults>> {
  if (!projectId) return {};

  if (isSupabaseConfigured) {
    try {
      const { data } = await supabaseAdmin
        .from("projects")
        .select("saved_defaults")
        .eq("id", projectId)
        .single();

      if (data?.saved_defaults && Object.keys(data.saved_defaults).length > 0) {
        return data.saved_defaults;
      }
    } catch (err) {
      // fallback
    }
  }

  // Memory fallback
  const memProj = memoryDb.projects.find(p => p.id === projectId);
  if (memProj?.savedDefaults) {
    return memProj.savedDefaults;
  }
  if (memProj) {
    return {
      productName: memProj.productName,
      industry: memProj.industry,
      targetMarket: memProj.targetMarket as any,
      description: memProj.description,
      category: memProj.category || "",
      companyContext: memProj.companyContext || "",
      motorTech: memProj.motorTech || "",
      keyDiff: memProj.keyDiff || "",
      pricePoint: memProj.pricePoint || "",
    };
  }

  return {};
}

// Get most recently used project (for pre-filling new forms)
export async function getMostRecentProject(userId: string) {
  if (isSupabaseConfigured) {
    try {
      const { data } = await supabaseAdmin
        .from("projects")
        .select("id, product_name, saved_defaults")
        .order("last_used_at", { ascending: false })
        .limit(1)
        .single();

      if (data) return data;
    } catch (err) {
      // fallback
    }
  }

  if (memoryDb.projects.length > 0) {
    const sorted = [...memoryDb.projects].sort((a, b) => {
      const tA = a.lastUsedAt ? new Date(a.lastUsedAt).getTime() : new Date(a.updatedAt).getTime();
      const tB = b.lastUsedAt ? new Date(b.lastUsedAt).getTime() : new Date(b.updatedAt).getTime();
      return tB - tA;
    });
    return sorted[0];
  }

  return null;
}
