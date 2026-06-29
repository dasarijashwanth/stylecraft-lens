// In-memory fallback database for development when PostgreSQL is not connected

export interface MockCompetitor {
  id: string;
  orgId: string;
  name: string;
  website: string | null;
  description: string | null;
  status: "ACTIVE" | "MONITORING" | "ARCHIVED";
  tags: string[];
  logoUrl: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface MockProject {
  id: string;
  orgId: string;
  userId: string;
  name: string;
  industry: string;
  targetMarket: string;
  productName: string;
  description: string;
  category?: string | null;
  companyContext?: string | null;
  motorTech?: string | null;
  keyDiff?: string | null;
  pricePoint?: string | null;
  savedDefaults?: any;
  latestAnalysisId?: string | null;
  latestReportId?: string | null;
  lastUsedAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface MockAnalysis {
  id: string;
  orgId: string;
  userId: string;
  projectId: string | null;
  status: "PENDING" | "RUNNING" | "COMPLETE" | "FAILED";
  phase: number;
  phase1Result: any;
  phase2Result: any;
  phase3Result: any;
  errorMessage: string | null;
  durationMs: number | null;
  createdAt: Date;
  completedAt: Date | null;
}

export interface MockCompetitorAnalysis {
  id: string;
  analysisId: string;
  competitorId: string | null;
  name: string;
  tier: string;
  threatScore: number;
  category: string;
  tags: string[];
  insight: string | null;
  pricePoint: string | null;
  standoutFeature: string | null;
}

export interface MockReport {
  id: string;
  orgId: string;
  projectId: string | null;
  title: string;
  content: any; // TipTap JSON
  status: "DRAFT" | "IN_REVIEW" | "READY" | "EXPORTED";
  fileUrl: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface MockArtwork {
  id: string;
  projectId: string;
  fileUrl: string;
  fileName: string;
  purpose: string;
  aiSuggestions: any;
  createdAt: Date;
}

export interface MockOutput {
  id: string;
  projectId: string;
  outputType: string;
  content: any;
  html?: string;
  driveUrl?: string;
  createdAt: Date;
}

export interface MockNote {
  id: string;
  competitorId: string;
  content: string;
  createdAt: Date;
}

class MemoryDatabase {
  competitors: MockCompetitor[] = [];
  projects: MockProject[] = [];
  analyses: MockAnalysis[] = [];
  competitorAnalyses: MockCompetitorAnalysis[] = [];
  reports: MockReport[] = [];
  notes: MockNote[] = [];
  artwork: MockArtwork[] = [];
  outputs: MockOutput[] = [];

  constructor() {
    this.seed();
  }

  seed() {
    // Seed initial competitors
    this.competitors = [
      {
        id: "comp_1",
        orgId: "dev_org_id",
        name: "Wahl Professional",
        website: "https://www.wahlpro.com",
        description: "Leading manufacturer of professional clippers, trimmers, and grooming accessories.",
        status: "ACTIVE",
        tags: ["luxury", "corded", "professional"],
        logoUrl: "https://www.google.com/s2/favicons?sz=64&domain=wahlpro.com",
        createdAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000),
        updatedAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000),
      },
      {
        id: "comp_2",
        orgId: "dev_org_id",
        name: "BaBylissPRO",
        website: "https://babylisspro.com",
        description: "Premium hair care and grooming tools utilizing advanced motor technology.",
        status: "ACTIVE",
        tags: ["professional", "cordless", "brushless"],
        logoUrl: "https://www.google.com/s2/favicons?sz=64&domain=babylisspro.com",
        createdAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000),
        updatedAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000),
      },
      {
        id: "comp_3",
        orgId: "dev_org_id",
        name: "Dyson Hair Care",
        website: "https://www.dyson.com",
        description: "High-end consumer and professional styling tools with specialized high-velocity motors.",
        status: "MONITORING",
        tags: ["luxury", "technology", "consumer"],
        logoUrl: "https://www.google.com/s2/favicons?sz=64&domain=dyson.com",
        createdAt: new Date(Date.now() - 20 * 24 * 60 * 60 * 1000),
        updatedAt: new Date(Date.now() - 20 * 24 * 60 * 60 * 1000),
      }
    ];

    // Seed default project
    this.projects = [
      {
        id: "proj_1",
        orgId: "dev_org_id",
        userId: "dev_user_id",
        name: "Apex Clipper launch",
        industry: "grooming",
        targetMarket: "both",
        productName: "Apex Cordless Clipper",
        description: "A premium cordless hair clipper with a brushless motor and titanium blades for barber and consumer use.",
        category: "Hair Clippers & Trimmers",
        companyContext: "Stylecraft Professional Tools division",
        motorTech: "Brushless DC",
        keyDiff: "Interchangeable custom bodies and 4-hour battery life",
        pricePoint: "$180",
        createdAt: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000),
        updatedAt: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000),
      }
    ];

    // Seed default notes
    this.notes = [
      {
        id: "note_1",
        competitorId: "comp_1",
        content: "Strong brand presence in barbershops. Heavy retail distribution.",
        createdAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000),
      },
      {
        id: "note_2",
        competitorId: "comp_2",
        content: "Their FX3 line is gaining traction. Priced at $210, competitive.",
        createdAt: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000),
      }
    ];
  }
}

// Global registry for development hot reloads
const globalForMemDb = globalThis as unknown as {
  memoryDb: MemoryDatabase | undefined;
};

export const memoryDb = globalForMemDb.memoryDb ?? new MemoryDatabase();
if (process.env.NODE_ENV !== "production") globalForMemDb.memoryDb = memoryDb;
export default memoryDb;
