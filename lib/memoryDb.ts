// In-memory fallback database for development when PostgreSQL is not connected
//
// Also autosaves to a local JSON snapshot so dev-server restarts (dependency
// changes, cache clears, crashes) don't silently wipe unsaved data. This is a
// dev convenience, not a substitute for a real database in production.
import fs from "fs";
import path from "path";

const SNAPSHOT_PATH = path.join(process.cwd(), ".local-data", "memdb-snapshot.json");
const AUTOSAVE_INTERVAL_MS = 3000;

// Vercel (and other serverless platforms) mount a read-only filesystem and
// recycle warm containers unpredictably — a setInterval here would fail on
// every write AND leak a recurring timer into every container that imports
// this module for the life of that container. This snapshot is a local-dev
// convenience only; production persistence goes through Supabase.
const IS_SERVERLESS = !!process.env.VERCEL || !!process.env.AWS_LAMBDA_FUNCTION_NAME;

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
  context?: any;
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
  userId?: string;
  projectId: string | null;
  analysisId?: string | null;
  title: string;
  content: any; // TipTap JSON / full section bundle
  status: string;
  fileUrl: string | null;
  // Report section data (kept snake_case to match the Supabase column
  // contract that the UI and lib/project-context.ts read directly)
  competitive_analysis?: any;
  pricing_analysis?: any;
  go_to_market?: any;
  content_form?: any;
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

// Snapshot JSON turns Date fields into ISO strings — convert the known
// Date-typed fields back so downstream code (.getTime(), .toLocaleDateString())
// keeps working after a reload.
function reviveDateFields(items: any[] | undefined, fields: string[]): any[] {
  return (items ?? []).map((item: any) => {
    const copy: any = { ...item };
    for (const field of fields) {
      if (copy[field] != null) copy[field] = new Date(copy[field]);
    }
    return copy;
  });
}

function reviveDates(data: any): any {
  return {
    competitors: reviveDateFields(data.competitors, ["createdAt", "updatedAt"]),
    projects: reviveDateFields(data.projects, ["createdAt", "updatedAt", "lastUsedAt"]),
    analyses: reviveDateFields(data.analyses, ["createdAt", "completedAt"]),
    competitorAnalyses: data.competitorAnalyses ?? [],
    reports: reviveDateFields(data.reports, ["createdAt", "updatedAt"]),
    notes: reviveDateFields(data.notes, ["createdAt"]),
    artwork: reviveDateFields(data.artwork, ["createdAt"]),
    outputs: reviveDateFields(data.outputs, ["createdAt"]),
  };
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
    if (IS_SERVERLESS || !this.loadSnapshot()) {
      this.seed();
    }
    if (!IS_SERVERLESS) this.startAutosave();
  }

  private loadSnapshot(): boolean {
    if (IS_SERVERLESS) return false;
    try {
      if (!fs.existsSync(SNAPSHOT_PATH)) return false;
      const raw = fs.readFileSync(SNAPSHOT_PATH, "utf-8");
      const data = reviveDates(JSON.parse(raw));
      this.competitors = data.competitors ?? [];
      this.projects = data.projects ?? [];
      this.analyses = data.analyses ?? [];
      this.competitorAnalyses = data.competitorAnalyses ?? [];
      this.reports = data.reports ?? [];
      this.notes = data.notes ?? [];
      this.artwork = data.artwork ?? [];
      this.outputs = data.outputs ?? [];
      return true;
    } catch (e) {
      console.warn("Failed to load memoryDb snapshot, seeding fresh:", e);
      return false;
    }
  }

  saveSnapshot() {
    if (IS_SERVERLESS) return;
    try {
      fs.mkdirSync(path.dirname(SNAPSHOT_PATH), { recursive: true });
      const data = {
        competitors: this.competitors,
        projects: this.projects,
        analyses: this.analyses,
        competitorAnalyses: this.competitorAnalyses,
        reports: this.reports,
        notes: this.notes,
        artwork: this.artwork,
        outputs: this.outputs,
      };
      fs.writeFileSync(SNAPSHOT_PATH, JSON.stringify(data));
    } catch (e) {
      console.warn("Failed to save memoryDb snapshot:", e);
    }
  }

  private startAutosave() {
    const g = globalThis as unknown as { __memDbAutosaveStarted?: boolean };
    if (g.__memDbAutosaveStarted) return;
    g.__memDbAutosaveStarted = true;

    setInterval(() => this.saveSnapshot(), AUTOSAVE_INTERVAL_MS);
    const flushAndExit = () => {
      this.saveSnapshot();
      process.exit(0);
    };
    process.on("exit", () => this.saveSnapshot());
    process.on("SIGINT", flushAndExit);
    process.on("SIGTERM", flushAndExit);
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

    // No default mock projects
    this.projects = [];

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
