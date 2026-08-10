import { NextResponse } from "next/server";
import { getAuthSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { memoryDb } from "@/lib/memoryDb";
import { isSupabaseConfigured, supabaseAdmin } from "@/lib/supabase";

export async function GET(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const session = await getAuthSession();
    const { id } = params;

    // Security audit fix — this route (unlike app/api/competitors/route.ts's
    // list/create handlers) had NO isSupabaseConfigured branch at all, so
    // it always tried Prisma first. In this app's real deployment
    // (Supabase always configured, DATABASE_URL unset) `prisma` is a Proxy
    // whose every method unconditionally throws (lib/db.ts), so this
    // ALWAYS 404'd for real competitors regardless of ownership — a dead
    // feature that failed closed, but a landmine: a future fix copying the
    // shape below without the `user_id`/`is_fixed` filter would introduce
    // a real cross-tenant IDOR (competitors has no separate notes table in
    // Supabase yet — see the notes route's own comment).
    if (isSupabaseConfigured) {
      const { data: competitor, error } = await supabaseAdmin
        .from("competitors")
        .select("*")
        .eq("id", id)
        .or(`user_id.eq.${session.userId},is_fixed.eq.true`)
        .maybeSingle();
      if (error) throw error;
      if (!competitor) {
        return NextResponse.json({ error: "NOT_FOUND", message: "Competitor not found" }, { status: 404 });
      }
      const { data: analysisRows } = await supabaseAdmin
        .from("analysis_competitors")
        .select("*")
        .eq("user_id", session.userId)
        .ilike("name", competitor.name)
        .order("created_at", { ascending: false })
        .limit(1);
      const latestAnalysis = analysisRows?.[0];
      const threatScore = latestAnalysis?.threat_score ?? (competitor.is_fixed ? 35 : Math.floor((competitor.name.charCodeAt(0) * 7) % 55) + 30);
      return NextResponse.json({ competitor: { ...competitor, notes: [], threatScore } });
    }

    try {
      // 1. Try PostgreSQL
      const competitor = await prisma.competitor.findUnique({
        where: { id },
        include: {
          notes: { orderBy: { createdAt: "desc" } },
          analyses: {
            include: {
              analysis: true
            },
            orderBy: { id: "desc" }
          }
        }
      });

      if (!competitor || competitor.orgId !== session.orgId) {
        return NextResponse.json(
          { error: "NOT_FOUND", message: "Competitor not found" },
          { status: 404 }
        );
      }

      // Calculate threat score
      const latestAnalysis = competitor.analyses[0];
      const threatScore = latestAnalysis ? latestAnalysis.threatScore : Math.floor(Math.random() * 40) + 30;

      return NextResponse.json({
        competitor: {
          ...competitor,
          threatScore
        }
      });
    } catch (dbError) {
      console.warn(`PostgreSQL unavailable in GET /api/competitors/${id}. Falling back to memoryDb:`, dbError);
      
      // 2. Fallback to Memory Database
      const competitor = memoryDb.competitors.find(c => c.id === id);
      if (!competitor || competitor.orgId !== session.orgId) {
        return NextResponse.json(
          { error: "NOT_FOUND", message: "Competitor not found" },
          { status: 404 }
        );
      }
      
      const notes = memoryDb.notes.filter(n => n.competitorId === id).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
      const analyses = memoryDb.competitorAnalyses.filter(ca => ca.competitorId === id);
      
      const threatScore = analyses.length > 0
        ? Math.round(analyses.reduce((acc, curr) => acc + curr.threatScore, 0) / analyses.length)
        : Math.floor((competitor.name.charCodeAt(0) * 7) % 55) + 30;
      
      return NextResponse.json({
        competitor: {
          ...competitor,
          notes,
          analyses,
          threatScore
        }
      });
    }
  } catch (error: any) {
    return NextResponse.json(
      { error: "SERVER_ERROR", message: error.message },
      { status: 500 }
    );
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const session = await getAuthSession();
    const { id } = params;
    const body = await request.json();
    
    // Extraneous keys filter
    const updateData: any = {};
    if (body.name !== undefined) updateData.name = body.name;
    if (body.website !== undefined) updateData.website = body.website || null;
    if (body.description !== undefined) updateData.description = body.description || null;
    if (body.status !== undefined) updateData.status = body.status;
    if (body.tags !== undefined) updateData.tags = body.tags;
    
    // Auto favicon
    if (updateData.website) {
      try {
        const domain = new URL(updateData.website).hostname;
        updateData.logoUrl = `https://www.google.com/s2/favicons?sz=64&domain=${domain}`;
      } catch (e) {}
    }

    // Security audit fix — same missing-Supabase-branch issue as GET above.
    // Mutations require STRICT user_id ownership (never is_fixed — a
    // shared/curated reference competitor must not be editable just
    // because any user can read it).
    if (isSupabaseConfigured) {
      const { data: existing, error: findError } = await supabaseAdmin
        .from("competitors")
        .select("id, user_id")
        .eq("id", id)
        .maybeSingle();
      if (findError) throw findError;
      if (!existing || existing.user_id !== session.userId) {
        return NextResponse.json({ error: "NOT_FOUND", message: "Competitor not found" }, { status: 404 });
      }

      const sbUpdate: Record<string, any> = {};
      if (updateData.name !== undefined) sbUpdate.name = updateData.name;
      if (updateData.website !== undefined) sbUpdate.website = updateData.website;
      if (updateData.description !== undefined) sbUpdate.description = updateData.description;
      if (updateData.status !== undefined) sbUpdate.status = updateData.status;
      if (updateData.tags !== undefined) sbUpdate.tags = updateData.tags;
      if (updateData.logoUrl !== undefined) sbUpdate.logo_url = updateData.logoUrl;
      sbUpdate.updated_at = new Date().toISOString();

      const { data: updated, error } = await supabaseAdmin
        .from("competitors")
        .update(sbUpdate)
        .eq("id", id)
        .eq("user_id", session.userId)
        .select()
        .single();
      if (error) throw error;
      return NextResponse.json({ competitor: updated });
    }

    try {
      // 1. Try PostgreSQL
      const competitor = await prisma.competitor.findUnique({
        where: { id }
      });
      
      if (!competitor || competitor.orgId !== session.orgId) {
        return NextResponse.json(
          { error: "NOT_FOUND", message: "Competitor not found" },
          { status: 404 }
        );
      }
      
      const updated = await prisma.competitor.update({
        where: { id },
        data: updateData
      });
      
      return NextResponse.json({ competitor: updated });
    } catch (dbError) {
      console.warn(`PostgreSQL unavailable in PATCH /api/competitors/${id}. Falling back to memoryDb:`, dbError);
      
      // 2. Fallback to Memory Database
      const competitorIndex = memoryDb.competitors.findIndex(c => c.id === id);
      if (competitorIndex === -1 || memoryDb.competitors[competitorIndex].orgId !== session.orgId) {
        return NextResponse.json(
          { error: "NOT_FOUND", message: "Competitor not found" },
          { status: 404 }
        );
      }
      
      const existing = memoryDb.competitors[competitorIndex];
      const updated = {
        ...existing,
        ...updateData,
        updatedAt: new Date()
      };
      
      memoryDb.competitors[competitorIndex] = updated;
      
      return NextResponse.json({ competitor: updated });
    }
  } catch (error: any) {
    return NextResponse.json(
      { error: "SERVER_ERROR", message: error.message },
      { status: 500 }
    );
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const session = await getAuthSession();
    const { id } = params;

    // Security audit fix — same missing-Supabase-branch issue as GET/PATCH
    // above; strict user_id ownership (never is_fixed).
    if (isSupabaseConfigured) {
      const { data: existing, error: findError } = await supabaseAdmin
        .from("competitors")
        .select("id, user_id")
        .eq("id", id)
        .maybeSingle();
      if (findError) throw findError;
      if (!existing || existing.user_id !== session.userId) {
        return NextResponse.json({ error: "NOT_FOUND", message: "Competitor not found" }, { status: 404 });
      }
      const { error } = await supabaseAdmin.from("competitors").delete().eq("id", id).eq("user_id", session.userId);
      if (error) throw error;
      return NextResponse.json({ success: true });
    }

    try {
      // 1. Try PostgreSQL
      const competitor = await prisma.competitor.findUnique({
        where: { id }
      });

      if (!competitor || competitor.orgId !== session.orgId) {
        return NextResponse.json(
          { error: "NOT_FOUND", message: "Competitor not found" },
          { status: 404 }
        );
      }

      await prisma.competitor.delete({
        where: { id }
      });

      return NextResponse.json({ success: true });
    } catch (dbError) {
      console.warn(`PostgreSQL unavailable in DELETE /api/competitors/${id}. Falling back to memoryDb:`, dbError);
      
      // 2. Fallback to Memory Database
      const competitorIndex = memoryDb.competitors.findIndex(c => c.id === id);
      if (competitorIndex === -1 || memoryDb.competitors[competitorIndex].orgId !== session.orgId) {
        return NextResponse.json(
          { error: "NOT_FOUND", message: "Competitor not found" },
          { status: 404 }
        );
      }
      
      memoryDb.competitors.splice(competitorIndex, 1);
      
      // Cascade delete notes
      memoryDb.notes = memoryDb.notes.filter(n => n.competitorId !== id);
      
      return NextResponse.json({ success: true });
    }
  } catch (error: any) {
    return NextResponse.json(
      { error: "SERVER_ERROR", message: error.message },
      { status: 500 }
    );
  }
}
