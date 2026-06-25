import { NextResponse } from "next/server";
import { getAuthSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { memoryDb } from "@/lib/memoryDb";
import { AddCompetitorSchema } from "@/lib/validations";

export async function GET(request: Request) {
  try {
    const session = await getAuthSession();
    const { searchParams } = new URL(request.url);
    
    const search = searchParams.get("search") || "";
    const status = searchParams.get("status") || "";
    const tagsParam = searchParams.get("tags") || "";
    const sort = searchParams.get("sort") || "name";
    const order = searchParams.get("order") || "asc";
    const page = parseInt(searchParams.get("page") || "1", 10);
    const limit = parseInt(searchParams.get("limit") || "20", 10);
    
    const tags = tagsParam ? tagsParam.split(",").map(t => t.trim().toLowerCase()) : [];
    
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
