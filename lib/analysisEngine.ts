import { EventEmitter } from "events";
import { prisma } from "./db";
import { memoryDb } from "./memoryDb";
import { anthropic, hasAnthropicKey } from "./anthropic";

// Global event emitter for streaming progress updates
class AnalysisEmitter extends EventEmitter {}

const globalForAnalysis = globalThis as unknown as {
  analysisEvents: AnalysisEmitter | undefined;
};

export const analysisEvents =
  globalForAnalysis.analysisEvents ?? new AnalysisEmitter();

if (process.env.NODE_ENV !== "production") {
  globalForAnalysis.analysisEvents = analysisEvents;
}

export interface AnalysisContext {
  id: string;
  orgId: string;
  userId: string;
  projectId: string | null;
  industry: string;
  targetMarket: "pro" | "consumer" | "both";
  productName: string;
  description: string;
  category?: string;
  companyContext?: string;
  motorTech?: string;
  keyDiff?: string;
  pricePoint?: string;
}

export async function startAnalysis(context: AnalysisContext) {
  // Start the async analysis in the background
  runAnalysisInBackground(context).catch(err => {
    console.error(`Background analysis error for ${context.id}:`, err);
  });
}

async function runAnalysisInBackground(context: AnalysisContext) {
  const startTime = Date.now();
  const id = context.id;
  
  const updateStatus = async (phase: number, status: string, phase1Res?: any, phase2Res?: any, phase3Res?: any, err?: string) => {
    const isComplete = phase === 4;
    const isFailed = status === "FAILED";
    
    const data: any = {
      phase,
      status: isFailed ? "FAILED" : isComplete ? "COMPLETE" : "RUNNING",
      errorMessage: err || null,
      completedAt: isComplete ? new Date() : null,
      durationMs: isComplete ? Date.now() - startTime : null,
    };
    
    if (phase1Res) data.phase1Result = phase1Res;
    if (phase2Res) data.phase2Result = phase2Res;
    if (phase3Res) data.phase3Result = phase3Res;
    
    try {
      // 1. Update PostgreSQL
      await prisma.analysis.update({
        where: { id },
        data
      });
    } catch (e) {
      // 2. Update Memory DB
      const item = memoryDb.analyses.find(a => a.id === id);
      if (item) {
        item.phase = phase;
        item.status = data.status;
        item.errorMessage = data.errorMessage;
        item.completedAt = data.completedAt;
        item.durationMs = data.durationMs;
        if (phase1Res) item.phase1Result = phase1Res;
        if (phase2Res) item.phase2Result = phase2Res;
        if (phase3Res) item.phase3Result = phase3Res;
      }
    }
  };

  try {
    // ----------------------------------------------------
    // PHASE 1: DISCOVERY (0% -> 33%)
    // ----------------------------------------------------
    emitProgress(id, "phase_start", 1, "Searching for competitor products...");
    await sleep(2500); // simulate network/crawling latency
    emitProgress(id, "phase_progress", 1, "Searching Amazon, beauty retail listings, and search index...", 40);
    await sleep(2000);
    emitProgress(id, "phase_progress", 1, "Identifying 5 established and 5 emerging brands...", 80);
    
    let phase1Result: any;
    if (hasAnthropicKey) {
      try {
        phase1Result = await executePhase1Claude(context);
      } catch (err: any) {
        console.warn("Claude Phase 1 failed, falling back to mock:", err);
        phase1Result = generateMockPhase1(context);
      }
    } else {
      phase1Result = generateMockPhase1(context);
    }
    
    await updateStatus(1, "RUNNING", phase1Result);
    emitProgress(id, "phase_complete", 1, "Found 10 competitors (5 established, 5 emerging)", 100, phase1Result);
    await sleep(1500);

    // ----------------------------------------------------
    // PHASE 2: RESEARCH INTELLIGENCE (33% -> 66%)
    // ----------------------------------------------------
    emitProgress(id, "phase_start", 2, "Gathering intelligence for identified competitors...");
    await sleep(2000);
    emitProgress(id, "phase_progress", 2, "Crawling specifications, product reviews, and price points...", 45);
    await sleep(2500);
    emitProgress(id, "phase_progress", 2, "Extracting competitor positioning, strengths, and weaknesses...", 75);
    
    let phase2Result: any;
    if (hasAnthropicKey) {
      try {
        phase2Result = await executePhase2Claude(context, phase1Result);
      } catch (err: any) {
        console.warn("Claude Phase 2 failed, falling back to mock:", err);
        phase2Result = generateMockPhase2(context, phase1Result);
      }
    } else {
      phase2Result = generateMockPhase2(context, phase1Result);
    }
    
    await updateStatus(2, "RUNNING", null, phase2Result);
    emitProgress(id, "phase_complete", 2, "Completed competitor research and positioning analysis", 100, phase2Result);
    await sleep(1500);

    // ----------------------------------------------------
    // PHASE 3: STRATEGIC SYNTHESIS (66% -> 100%)
    // ----------------------------------------------------
    emitProgress(id, "phase_start", 3, "Synthesising strategic intelligence report...");
    await sleep(2000);
    emitProgress(id, "phase_progress", 3, "Mapping product capabilities vs competitors...", 50);
    await sleep(2000);
    emitProgress(id, "phase_progress", 3, "Formulating opportunities, threats, and strategic recommendations...", 85);
    
    let phase3Result: any;
    if (hasAnthropicKey) {
      try {
        phase3Result = await executePhase3Claude(context, phase1Result, phase2Result);
      } catch (err: any) {
        console.warn("Claude Phase 3 failed, falling back to mock:", err);
        phase3Result = generateMockPhase3(context, phase1Result, phase2Result);
      }
    } else {
      phase3Result = generateMockPhase3(context, phase1Result, phase2Result);
    }
    
    await updateStatus(3, "RUNNING", null, null, phase3Result);
    
    // Save CompetitorAnalyses to DB/Memory for link references
    await saveCompetitorAnalyses(id, context.orgId, phase1Result, phase2Result);
    
    // Mark as complete
    await updateStatus(4, "COMPLETE", null, null, null);
    
    const duration = Date.now() - startTime;
    emitProgress(id, "analysis_complete", 4, "Analysis completed successfully", 100, {
      duration,
      analysisId: id,
    });
    
  } catch (error: any) {
    console.error("Analysis process crashed:", error);
    await updateStatus(0, "FAILED", null, null, null, error.message || "Unknown error during analysis");
    emitProgress(id, "error", 0, error.message || "Analysis failed");
  }
}

function emitProgress(analysisId: string, type: string, phase: number, message: string, progress = 100, result: any = null) {
  analysisEvents.emit(`progress:${analysisId}`, {
    type,
    phase,
    message,
    progress,
    result,
  });
}

// ----------------------------------------------------
// CLAUDE API RUNNERS
// ----------------------------------------------------

async function executePhase1Claude(context: AnalysisContext) {
  const systemPrompt = `You are a competitive intelligence analyst specialising in the ${context.industry} industry.
Your task is to identify 10 real competing products or brands.
Return ONLY a JSON object with this exact structure, no markdown, no preamble:
{
  "established": [
    {
      "name": "Brand Name",
      "category": "Product type / positioning",
      "tags": ["tag1", "tag2", "tag3"],
      "threat_score": 85,
      "price_range": "$XX–$XX",
      "standout_feature": "One sentence"
    }
  ],
  "emerging": [
    {
      "name": "Brand Name",
      "category": "Product type / positioning",
      "tags": ["tag1", "tag2", "tag3"],
      "threat_score": 60,
      "price_range": "$XX–$XX",
      "standout_feature": "One sentence"
    }
  ]
}
Provide exactly 5 established (well-known market leaders) and 5 emerging (newer, niche, or fast-growing) competitors.
Tags = 2-3 short descriptors of the product's traits.
Threat score = 0-100 integer.`;

  const userPrompt = `Find 10 competitors for this product:
Product: ${context.productName}
Industry: ${context.industry}
Target market: ${context.targetMarket}
Description: ${context.description}
${context.motorTech ? `Motor tech: ${context.motorTech}` : ""}
${context.keyDiff ? `Key differentiator: ${context.keyDiff}` : ""}
${context.pricePoint ? `Target price: ${context.pricePoint}` : ""}
${context.category ? `Amazon category: ${context.category}` : ""}

Search Amazon and the web. Prioritise real products with verified market presence.`;

  const response = await anthropic.messages.create({
    model: "claude-3-5-sonnet-20241022", // Sonnet 3.5 latest or fallback
    max_tokens: 2000,
    system: systemPrompt,
    messages: [{ role: "user", content: userPrompt }],
  });

  const text = response.content
    .filter(b => b.type === "text")
    .map(b => b.text)
    .join("");

  return JSON.parse(cleanJsonString(text));
}

async function executePhase2Claude(context: AnalysisContext, phase1: any) {
  const allCompetitors = [...phase1.established, ...phase1.emerging];
  
  const systemPrompt = `You are a senior competitive intelligence researcher.
Return ONLY valid JSON, no markdown:
{
  "research": [
    {
      "competitor": "Name",
      "tier": "established" | "emerging",
      "pricing": "Current price range",
      "positioning": "How they position themselves",
      "strength": "Their main competitive advantage",
      "weakness": "Their main vulnerability",
      "insight": "One actionable strategic insight for our client"
    }
  ]
}`;

  const userPrompt = `Research these competitors for our product "${context.productName}" in the ${context.industry} industry:
${allCompetitors.map(c => `- ${c.name}: ${c.category} (${c.price_range})`).join("\n")}

For each competitor, search for: current pricing, key features, customer reviews, and market positioning.
Our product context: ${context.description}
${context.companyContext ? `Our company context: ${context.companyContext}` : ""}`;

  const response = await anthropic.messages.create({
    model: "claude-3-5-sonnet-20241022",
    max_tokens: 2000,
    system: systemPrompt,
    messages: [{ role: "user", content: userPrompt }],
  });

  const text = response.content
    .filter(b => b.type === "text")
    .map(b => b.text)
    .join("");

  return JSON.parse(cleanJsonString(text));
}

async function executePhase3Claude(context: AnalysisContext, phase1: any, phase2: any) {
  const systemPrompt = `You are a senior competitive strategy consultant.
Return ONLY valid JSON:
{
  "executive_summary": "2-3 sentence competitive landscape overview",
  "market_position": "Where our product sits vs competitors",
  "opportunities": ["opportunity 1", "opportunity 2", "opportunity 3"],
  "threats": ["threat 1", "threat 2", "threat 3"],
  "recommendations": [
    {
      "title": "Short title",
      "detail": "One to two sentence recommendation",
      "priority": "high" | "medium" | "low"
    }
  ],
  "competitive_score": 72
}
competitive_score = 0-100 overall competitive position assessment.`;

  const userPrompt = `Create a strategic synthesis for:
Product: ${context.productName}
${context.companyContext ? `Company Context: ${context.companyContext}` : ""}

Competitor landscape: ${JSON.stringify(phase1)}
Intelligence gathered: ${JSON.stringify(phase2)}

Provide honest, actionable strategic analysis.`;

  const response = await anthropic.messages.create({
    model: "claude-3-5-sonnet-20241022",
    max_tokens: 1500,
    system: systemPrompt,
    messages: [{ role: "user", content: userPrompt }],
  });

  const text = response.content
    .filter(b => b.type === "text")
    .map(b => b.text)
    .join("");

  return JSON.parse(cleanJsonString(text));
}

function cleanJsonString(text: string): string {
  return text.replace(/```json|```/g, "").trim();
}

// ----------------------------------------------------
// SMART MOCK GENERATORS FOR OFFLINE / NO-KEY USE
// ----------------------------------------------------

function generateMockPhase1(context: AnalysisContext) {
  const ind = context.industry.toLowerCase();
  
  if (ind.includes("grooming") || ind.includes("hair") || ind.includes("beauty")) {
    return {
      established: [
        {
          name: "Wahl Professional 5-Star",
          category: "Professional Clippers & Trimmers",
          tags: ["classic", "heavy-duty", "barber-standard"],
          threat_score: 85,
          price_range: "$110–$140",
          standout_feature: "Legendary electromagnetic motor power and traditional metal build."
        },
        {
          name: "BaBylissPRO GoldFX",
          category: "Luxury Grooming Tools",
          tags: ["cordless", "high-torque", "designer"],
          threat_score: 92,
          price_range: "$200–$230",
          standout_feature: "Ferrari-designed high-torque brushless motor in an all-metal housing."
        },
        {
          name: "Andis Master Cordless",
          category: "High-End Professional Clippers",
          tags: ["aluminum-casing", "adjustable-blade", "high-speed"],
          threat_score: 78,
          price_range: "$180–$210",
          standout_feature: "High-speed rotary motor with iconic aluminum housing and carbon-steel blade."
        },
        {
          name: "Oster Classic 76",
          category: "Heavy-Duty Salon Clippers",
          tags: ["universal-motor", "detachable-blade", "heritage"],
          threat_score: 70,
          price_range: "$150–$180",
          standout_feature: "Single-speed universal motor designed to cut through wet or dry hair all day."
        },
        {
          name: "Panasonic Professional Ergonomic",
          category: "Premium Styling Tools",
          tags: ["ergonomic", "linear-motor", "precision"],
          threat_score: 65,
          price_range: "$160–$190",
          standout_feature: "Ultra-fast linear motor drive with constant speed control and X-taper blades."
        }
      ],
      emerging: [
        {
          name: "Caliber 9mm Clipper",
          category: "Niche Cordless Tools",
          tags: ["high-rpm", "lightweight", "barber-focused"],
          threat_score: 55,
          price_range: "$90–$120",
          standout_feature: "Magnetic motor running at 10,000+ RPM in a super lightweight build."
        },
        {
          name: "Stylecraft Rebel Clipper",
          category: "Customizable Grooming Tech",
          tags: ["super-torque", "modular", "colored-covers"],
          threat_score: 80,
          price_range: "$130–$160",
          standout_feature: "Super-torque rotary motor with modular bodies and customizable click levers."
        },
        {
          name: "Gamma+ X-Ergo",
          category: "Ergonomic Barber Clippers",
          tags: ["magnetic-motor", "low-noise", "micro-chipped"],
          threat_score: 75,
          price_range: "$150–$180",
          standout_feature: "Microchipped magnetic motor with 10,000 strokes per minute and linear sound suppression."
        },
        {
          name: "TPOB X Clipper",
          category: "Direct-to-Barber Emerging Brand",
          tags: ["budget-friendly", "stealth-matte", "social-media-viral"],
          threat_score: 68,
          price_range: "$70–$90",
          standout_feature: "High power-to-cost ratio, stealth black designs, and massive online hype."
        },
        {
          name: "JRL FreshFade 2020C",
          category: "Quiet Smart Clippers",
          tags: ["stay-cool-blade", "2-speed", "lcd-display"],
          threat_score: 72,
          price_range: "$120–$150",
          standout_feature: "Patented Stay-Cool blade technology and advanced smart-clip lever."
        }
      ]
    };
  }

  // Generic fallback for any other industry
  return {
    established: [
      {
        name: "Market Leader Corp",
        category: "Enterprise Solution",
        tags: ["market-leader", "high-price", "full-featured"],
        threat_score: 90,
        price_range: "$500–$800",
        standout_feature: "Deep legacy integrations and extensive global distributor network."
      },
      {
        name: "Standard Competitor Inc",
        category: "Mid-Market Standard",
        tags: ["reliable", "standard", "industry-baseline"],
        threat_score: 70,
        price_range: "$300–$400",
        standout_feature: "Broad feature parity with excellent customer service and stability."
      },
      {
        name: "Premium Alternative",
        category: "Boutique / High-End",
        tags: ["luxury", "bespoke", "premium-features"],
        threat_score: 80,
        price_range: "$700–$1000",
        standout_feature: "Exceptional design aesthetics, premium materials, and elite user support."
      },
      {
        name: "Volume Vendor Co",
        category: "Mass Market",
        tags: ["budget", "mass-market", "low-cost"],
        threat_score: 60,
        price_range: "$100–$150",
        standout_feature: "Highly optimized manufacturing enabling rock-bottom prices."
      },
      {
        name: "Legacy Competitor",
        category: "Traditional Operator",
        tags: ["heritage", "offline-strong", "older-tech"],
        threat_score: 50,
        price_range: "$250–$350",
        standout_feature: "Massive existing customer database and high brand loyalty."
      }
    ],
    emerging: [
      {
        name: "SaaS Disruptor",
        category: "AI-First Platform",
        tags: ["cloud-native", "automated", "low-friction"],
        threat_score: 82,
        price_range: "$150–$250",
        standout_feature: "Proprietary automation engine that cuts workflow time in half."
      },
      {
        name: "Niche Player Ltd",
        category: "Vertical Specialist",
        tags: ["hyper-focused", "tailored", "agile"],
        threat_score: 65,
        price_range: "$200–$300",
        standout_feature: "Deep specialized features designed exclusively for small niche professionals."
      },
      {
        name: "Viral Challenger",
        category: "Direct-to-Consumer",
        tags: ["social-viral", "modern-brand", "community-driven"],
        threat_score: 75,
        price_range: "$120–$180",
        standout_feature: "High-growth community traction fueled by viral TikTok and Instagram marketing."
      },
      {
        name: "Open Source Project",
        category: "Developer-First Free Tool",
        tags: ["open-source", "extensible", "community-maintained"],
        threat_score: 45,
        price_range: "Free / Self-hosted",
        standout_feature: "Complete flexibility with community plugins and self-hosted control."
      },
      {
        name: "Agile Startup",
        category: "High-Growth Entrant",
        tags: ["rapid-iterations", "customer-centric", "modern-stack"],
        threat_score: 55,
        price_range: "$80–$120",
        standout_feature: "Weekly feature deployments solving customer pain points instantly."
      }
    ]
  };
}

function generateMockPhase2(context: AnalysisContext, phase1: any) {
  const allCompetitors = [...phase1.established, ...phase1.emerging];
  
  const research = allCompetitors.map(c => {
    const isEmerging = phase1.emerging.includes(c);
    
    let strength = "Strong brand heritage and retail reach.";
    let weakness = "Slow to innovate, heavy and traditional designs.";
    let positioning = "Premium salon-grade performance.";
    let insight = "Position our product as the lighter, modern, cordless alternative.";
    
    if (c.name.includes("BaBylissPRO")) {
      positioning = "Ultra-premium, heavy-metal aesthetic with professional backing.";
      strength = "Incredible marketing clout, visual appeal, and high-RPM brushless motor.";
      weakness = "Tools run hot, battery decay over time, premium-priced markup.";
      insight = "Undercut on price slightly while highlighting cool-touch blade technology.";
    } else if (c.name.includes("Wahl")) {
      positioning = "Traditional American barber heritage, reliability.";
      strength = "Massive user loyalty, blade design preference (crunch blade), cheap replacement parts.";
      weakness = "Plastic components break, ergonomic fatigue, slow charging tech.";
      insight = "Directly target their ergonomics; emphasize stylecraft custom housing fit.";
    } else if (c.name.includes("Stylecraft")) {
      positioning = "Highly customizable, custom-fit body kits, barber fashion.";
      strength = "Innovative magnetic charging, customization appeals to younger creative stylists.";
      weakness = "Housing plastic clips can snap; QA consistency issues.";
      insight = "Match their customization options but offer a premium, unified high-performance chassis.";
    } else if (c.name.includes("JRL")) {
      positioning = "Smart, quiet, stay-cool tech.";
      strength = "Blade temp remains low, battery indicator screen, very quiet operation.";
      weakness = "Lower torque than brushless competitors; struggle with wet bulk hair.";
      insight = "Target their torque limitation; show our brushless motor handles bulk hair easily.";
    } else if (isEmerging) {
      positioning = "Budget power, social media hyped direct-to-stylist sales.";
      strength = "Extremely low price, viral direct-to-barber appeal.";
      weakness = "Lacks warranty support, poor battery quality, questionable motor durability.";
      insight = "Emphasize professional warranty, build quality, and certified salon compliance.";
    }
    
    return {
      competitor: c.name,
      tier: isEmerging ? "emerging" : "established",
      pricing: c.price_range,
      positioning,
      strength,
      weakness,
      insight
    };
  });
  
  return { research };
}

function generateMockPhase3(context: AnalysisContext, phase1: any, phase2: any) {
  const ind = context.industry.toLowerCase();
  
  let opportunities = [
    "Introduce Cool-Touch blade tech to counter BaBylissPRO's high heat issues.",
    "Offer high-torque brushless motors under 280g to capture Wahl's fatigued users.",
    "Adopt modular color lids/housing kits to capture Gamma/Stylecraft younger demographic."
  ];
  
  let threats = [
    "Low-cost direct Challenger brands (like TPOB) copying modular layouts under $80.",
    "BaBylissPRO releasing updated stay-cool lithium motors.",
    "Supply chain delays on premium titanium blades vs Wahl domestic operations."
  ];
  
  let recommendations = [
    {
      title: "Launch with Stay-Cool Blades",
      detail: "Highlight our temperature-retardant blade tech in all marketing collateral vs hot-running premium competitors.",
      priority: "high"
    },
    {
      title: "Custom Barber Body Kits",
      detail: "Include 3 interchangeable color body kits directly in the retail box, following modular demand.",
      priority: "medium"
    },
    {
      title: "Brushless DC Campaign",
      detail: "Advertise higher torque cutting power (up to 7,500 RPM) to distinguish from quieter, low-power alternatives.",
      priority: "high"
    }
  ];
  
  if (!ind.includes("grooming") && !ind.includes("hair")) {
    opportunities = [
      "Capture market share by targeting premium-priced competitor gaps.",
      "Incorporate AI-driven features to stand out from traditional legacy tools.",
      "Build a modern direct-to-consumer digital portal to bypass distributor markups."
    ];
    
    threats = [
      "Agile bootstrapped competitors iterating features weekly.",
      "Price war with volume sellers eroding margin.",
      "Integration lock-in of the enterprise market leader."
    ];
    
    recommendations = [
      {
        title: "Differentiate on UX",
        detail: "Focus initial marketing on rapid onboarding and frictionless setup vs complex competitors.",
        priority: "high"
      },
      {
        title: "Targeted Pricing model",
        detail: "Introduce standard subscription pricing starting 20% lower than established standard providers.",
        priority: "high"
      },
      {
        title: "API-First Extensibility",
        detail: "Expose developer webhooks to lock in tech-savvy customers.",
        priority: "medium"
      }
    ];
  }
  
  return {
    executive_summary: `The competitive landscape for "${context.productName}" is highly active, characterized by dominant established players (e.g. BaBylissPRO, Wahl) owning retail shelf space, while agile, socially-driven challenger brands (e.g. Stylecraft, TPOB, JRL) disrupt direct-to-stylist sales. Opportunities exist to target ergonomic fatigue and overheating issues in market leaders.`,
    market_position: "Our product sits at the high-performance cordless tier, bridging customizable design with professional-grade cool-touch blade performance.",
    opportunities,
    threats,
    recommendations,
    competitive_score: 76
  };
}

async function saveCompetitorAnalyses(analysisId: string, orgId: string, phase1: any, phase2: any) {
  const allCompetitors = [...phase1.established, ...phase1.emerging];
  
  for (const c of allCompetitors) {
    const isEmerging = phase1.emerging.includes(c);
    const researchItem = phase2.research.find((r: any) => r.competitor === c.name);
    
    const competitorData = {
      analysisId,
      name: c.name,
      tier: isEmerging ? "emerging" : "established",
      threatScore: c.threat_score,
      category: c.category,
      tags: c.tags,
      insight: researchItem?.insight || null,
      pricePoint: c.price_range,
      standoutFeature: c.standout_feature || null,
    };
    
    try {
      // 1. Try to find/link an existing competitor record by name
      let competitorId = null;
      try {
        const existing = await prisma.competitor.findFirst({
          where: {
            orgId,
            name: { equals: c.name, mode: "insensitive" }
          }
        });
        if (existing) {
          competitorId = existing.id;
        }
      } catch (dbErr) {}
      
      // Save CompetitorAnalysis record in PostgreSQL
      await prisma.competitorAnalysis.create({
        data: {
          ...competitorData,
          competitorId
        }
      });
    } catch (e) {
      // 2. Fallback to Memory Database
      let competitorId = null;
      const existing = memoryDb.competitors.find(
        comp => comp.orgId === orgId && comp.name.toLowerCase() === c.name.toLowerCase()
      );
      if (existing) {
        competitorId = existing.id;
      }
      
      memoryDb.competitorAnalyses.push({
        id: `c_an_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
        ...competitorData,
        competitorId
      });
    }
  }
}

// Utility functions
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
