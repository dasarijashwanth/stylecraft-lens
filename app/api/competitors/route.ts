import { NextResponse } from "next/server";
import { getAuthSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { memoryDb } from "@/lib/memoryDb";
import { AddCompetitorSchema } from "@/lib/validations";
import { isSupabaseConfigured, supabaseAdmin } from "@/lib/supabase";

export async function GET(request: Request) {
  try {
    const session = await getAuthSession();
    const { searchParams } = new URL(request.url);
    const source = searchParams.get("source") || "manual";
    
    if (source === "analysis") {
      if (isSupabaseConfigured) {
        const { data, error } = await supabaseAdmin
          .from("analysis_competitors")
          .select("*, analyses(created_at, project_id, projects(name))")
          .eq("user_id", session.userId)
          .order("created_at", { ascending: false });

        if (error) throw error;
        return NextResponse.json({ competitors: data || [] });
      } else {
        // Fallback: Query completed analyses from Prisma / memoryDb and extract competitors
        let analyses = [];
        try {
          analyses = await prisma.analysis.findMany({
            where: { userId: session.userId, status: "COMPLETE" },
            include: { project: true },
            orderBy: { createdAt: "desc" }
          });
        } catch (dbErr) {
          analyses = memoryDb.analyses.filter(a => a.userId === session.userId && a.status === "COMPLETE");
        }

        const analysisCompetitors = [];
        for (const a of analyses) {
          const p1 = (a.phase1Result as any) || {};
          const p2 = (a.phase2Result as any) || {};
          const projectName = (a as any).project?.name || null;
          
          const p1Comps = (p1.competitors || []).map((c: any) => ({
            id: `${a.id}_p1_${c.asin || c.name}`,
            analysis_id: a.id,
            user_id: session.userId,
            name: c.name,
            brand: c.brand,
            tier: "legacy",
            asin: c.asin || null,
            // Prefer the already-computed amazon_url (a search link for
            // unverified competitors) over recomputing a bare /dp/{asin}
            // link from asin alone.
            amazon_url: c.amazon_url || (c.asin ? `https://www.amazon.com/dp/${c.asin}` : null),
            price: c.price || null,
            rating: c.rating || null,
            review_count: c.review_count || null,
            monthly_sales: c.monthly_sales || null,
            bsr_rank: c.bsr_rank || null,
            initials: c.initials || c.name.substring(0, 2).toUpperCase(),
            key_features: c.key_features || [],
            strengths: c.strengths || [],
            weaknesses: c.weaknesses || [],
            recent_news: c.recent_news || [],
            top_feature_summary: c.top_feature_summary || "",
            created_at: a.createdAt,
            analyses: {
              created_at: a.createdAt,
              project_id: a.projectId,
              projects: projectName ? { name: projectName } : null
            }
          }));

          const p2Comps = (p2.competitors || []).map((c: any) => ({
            id: `${a.id}_p2_${c.asin || c.name}`,
            analysis_id: a.id,
            user_id: session.userId,
            name: c.name,
            brand: c.brand,
            tier: "emerging",
            asin: c.asin || null,
            // Prefer the already-computed amazon_url (a search link for
            // unverified competitors) over recomputing a bare /dp/{asin}
            // link from asin alone.
            amazon_url: c.amazon_url || (c.asin ? `https://www.amazon.com/dp/${c.asin}` : null),
            price: c.price || null,
            rating: c.rating || null,
            review_count: c.review_count || null,
            monthly_sales: c.monthly_sales || null,
            bsr_rank: c.bsr_rank || null,
            initials: c.initials || c.name.substring(0, 2).toUpperCase(),
            key_features: c.key_features || [],
            strengths: c.strengths || [],
            weaknesses: c.weaknesses || [],
            recent_news: c.recent_news || [],
            top_feature_summary: c.top_feature_summary || "",
            created_at: a.createdAt,
            analyses: {
              created_at: a.createdAt,
              project_id: a.projectId,
              projects: projectName ? { name: projectName } : null
            }
          }));

          analysisCompetitors.push(...p1Comps, ...p2Comps);
        }

        return NextResponse.json({ competitors: analysisCompetitors });
      }
    }

    const search = searchParams.get("search") || "";
    const status = searchParams.get("status") || "";
    const tagsParam = searchParams.get("tags") || "";
    const sort = searchParams.get("sort") || "name";
    const order = searchParams.get("order") || "asc";
    const page = parseInt(searchParams.get("page") || "1", 10);
    const limit = parseInt(searchParams.get("limit") || "20", 10);
    
    const tags = tagsParam ? tagsParam.split(",").map(t => t.trim().toLowerCase()) : [];

    if (isSupabaseConfigured) {
      let query = supabaseAdmin
        .from("competitors")
        .select("*", { count: "exact" })
        .or(`user_id.eq.${session.userId},is_fixed.eq.true`);

      if (search) {
        query = query.ilike("name", `%${search}%`);
      }
      if (status && status !== "ALL") {
        query = query.eq("status", status.toLowerCase());
      }
      if (tags.length > 0) {
        query = query.contains("tags", tags);
      }

      const sbOrder = order === "asc";
      if (sort === "name") {
        query = query.order("name", { ascending: sbOrder });
      } else if (sort === "date" || sort === "dateAdded") {
        query = query.order("created_at", { ascending: sbOrder });
      } else {
        query = query.order("updated_at", { ascending: sbOrder });
      }

      const from = (page - 1) * limit;
      const to = from + limit - 1;
      query = query.range(from, to);

      const { data: dbComps, count: total, error } = await query;
      if (error) throw error;

      const competitors = (dbComps || []).map(c => {
        const threatScore = c.is_fixed ? 35 : Math.floor((c.name.charCodeAt(0) * 7) % 55) + 30;
        return {
          ...c,
          threatScore,
        };
      });

      return NextResponse.json({
        competitors,
        total: total || 0,
        page,
        totalPages: Math.ceil((total || 0) / limit),
      });
    }
    
    try {
      // 1. Try PostgreSQL
      let whereClause: any = {
        orgId: session.orgId,
      };
      
      if (search) {
        whereClause.name = {
          contains: search,
          mode: "insensitive",
        };
      }
      
      if (status && status !== "ALL") {
        whereClause.status = status;
      }
      
      if (tags.length > 0) {
        whereClause.tags = {
          hasEvery: tags,
        };
      }
      
      const total = await prisma.competitor.count({ where: whereClause });
      
      let orderBy: any = {};
      if (sort === "name") {
        orderBy = { name: order };
      } else if (sort === "date" || sort === "dateAdded") {
        orderBy = { createdAt: order };
      } else {
        orderBy = { updatedAt: order };
      }
      
      const dbCompetitors = await prisma.competitor.findMany({
        where: whereClause,
        orderBy,
        skip: (page - 1) * limit,
        take: limit,
        include: {
          analyses: {
            orderBy: { id: "desc" },
            take: 1
          }
        }
      });
      
      const competitors = dbCompetitors.map(c => {
        // Average threat score or fallback to a default
        const latestAnalysis = c.analyses[0];
        const threatScore = latestAnalysis ? latestAnalysis.threatScore : Math.floor(Math.random() * 40) + 30; // default range 30-70
        return {
          ...c,
          threatScore,
        };
      });
      
      return NextResponse.json({
        competitors,
        total,
        page,
        totalPages: Math.ceil(total / limit),
      });
      
    } catch (dbError) {
      console.warn("PostgreSQL unavailable in GET /api/competitors. Falling back to memoryDb:", dbError);
      
      // 2. Fallback to Memory Database
      let filtered = memoryDb.competitors.filter(c => c.orgId === session.orgId);
      
      if (search) {
        filtered = filtered.filter(c =>
          c.name.toLowerCase().includes(search.toLowerCase())
        );
      }
      
      if (status && status !== "ALL") {
        filtered = filtered.filter(c => c.status === status);
      }
      
      if (tags.length > 0) {
        filtered = filtered.filter(c =>
          tags.every(tag => c.tags.map(t => t.toLowerCase()).includes(tag))
        );
      }
      
      // Sorting
      filtered.sort((a, b) => {
        let valA: any = a.name.toLowerCase();
        let valB: any = b.name.toLowerCase();
        
        if (sort === "date" || sort === "dateAdded") {
          valA = a.createdAt.getTime();
          valB = b.createdAt.getTime();
        } else if (sort === "updated") {
          valA = a.updatedAt.getTime();
          valB = b.updatedAt.getTime();
        }
        
        if (valA < valB) return order === "asc" ? -1 : 1;
        if (valA > valB) return order === "asc" ? 1 : -1;
        return 0;
      });
      
      const total = filtered.length;
      const paginated = filtered.slice((page - 1) * limit, page * limit);
      
      // Attach mock threat scores
      const competitors = paginated.map(c => {
        // Find if they have analyses
        const hasAn = memoryDb.competitorAnalyses.filter(ca => ca.competitorId === c.id);
        const threatScore = hasAn.length > 0
          ? Math.round(hasAn.reduce((acc, curr) => acc + curr.threatScore, 0) / hasAn.length)
          : Math.floor((c.name.charCodeAt(0) * 7) % 55) + 30; // semi-stable mock score based on name
        
        return {
          ...c,
          threatScore,
        };
      });
      
      return NextResponse.json({
        competitors,
        total,
        page,
        totalPages: Math.ceil(total / limit),
      });
    }
  } catch (error: any) {
    return NextResponse.json(
      { error: "SERVER_ERROR", message: error.message },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const session = await getAuthSession();
    const body = await request.json();
    
    // Validate
    const validation = AddCompetitorSchema.safeParse(body);
    if (!validation.success) {
      return NextResponse.json(
        { error: "VALIDATION_FAILED", message: "Validation failed", details: validation.error.flatten() },
        { status: 400 }
      );
    }
    
    const { name, website, description, status, tags } = validation.data;
    
    // Fetch favicon helper
    let logoUrl = null;
    if (website) {
      try {
        const domain = new URL(website).hostname;
        logoUrl = `https://www.google.com/s2/favicons?sz=64&domain=${domain}`;
      } catch (e) {
        // Ignore invalid URL formatting for favicon
      }
    }

    if (isSupabaseConfigured) {
      const { data: duplicate, error: dupError } = await supabaseAdmin
        .from("competitors")
        .select("id")
        .eq("user_id", session.userId)
        .ilike("name", name)
        .maybeSingle();
      
      if (dupError) throw dupError;
      if (duplicate) {
        return NextResponse.json(
          { error: "CONFLICT", message: "Competitor with this name already exists" },
          { status: 409 }
        );
      }

      const { data: competitor, error } = await supabaseAdmin
        .from("competitors")
        .insert({
          user_id: session.userId,
          org_id: session.orgId || session.userId,
          name,
          website: website || null,
          description: description || null,
          status: status.toLowerCase(),
          tags: tags || [],
          logo_url: logoUrl,
          is_fixed: false,
        })
        .select()
        .single();

      if (error) throw error;
      return NextResponse.json({ competitor }, { status: 201 });
    }
    
    try {
      // 1. Try PostgreSQL
      // Check duplicate
      const duplicate = await prisma.competitor.findFirst({
        where: {
          orgId: session.orgId,
          name: { equals: name, mode: "insensitive" }
        }
      });
      
      if (duplicate) {
        return NextResponse.json(
          { error: "CONFLICT", message: "Competitor with this name already exists" },
          { status: 409 }
        );
      }
      
      const competitor = await prisma.competitor.create({
        data: {
          orgId: session.orgId,
          name,
          website: website || null,
          description: description || null,
          status,
          tags: tags || [],
          logoUrl,
        }
      });
      
      return NextResponse.json({ competitor }, { status: 201 });
      
    } catch (dbError) {
      console.warn("PostgreSQL unavailable in POST /api/competitors. Falling back to memoryDb:", dbError);
      
      // 2. Fallback to Memory Database
      const duplicate = memoryDb.competitors.find(
        c => c.orgId === session.orgId && c.name.toLowerCase() === name.toLowerCase()
      );
      
      if (duplicate) {
        return NextResponse.json(
          { error: "CONFLICT", message: "Competitor with this name already exists" },
          { status: 409 }
        );
      }
      
      const newId = `comp_${Date.now()}`;
      const competitor = {
        id: newId,
        orgId: session.orgId,
        name,
        website: website || null,
        description: description || null,
        status,
        tags: tags || [],
        logoUrl,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      
      memoryDb.competitors.push(competitor);
      
      return NextResponse.json({ competitor }, { status: 201 });
    }
  } catch (error: any) {
    return NextResponse.json(
      { error: "SERVER_ERROR", message: error.message },
      { status: 500 }
    );
  }
}
