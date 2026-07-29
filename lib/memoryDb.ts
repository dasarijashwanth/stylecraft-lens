// In-memory fallback database for development when PostgreSQL is not connected
//
// Also autosaves to a local JSON snapshot so dev-server restarts (dependency
// changes, cache clears, crashes) don't silently wipe unsaved data. This is a
// dev convenience, not a substitute for a real database in production.
import fs from "fs";
import path from "path";
import { FAQ_SEED_DATA } from "./faq-seed-data";

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
  toolType?: string | null;
  companyContext?: string | null;
  motorTech?: string | null;
  keyDiff?: string | null;
  pricePoint?: string | null;
  productUrl?: string | null;
  asin?: string | null;
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
  status: "PENDING" | "RUNNING" | "COMPLETE" | "FAILED" | "CANCELLED";
  phase: number;
  context?: any;
  phase0Result?: any;
  phase1Result: any;
  phase2Result: any;
  phase3Result: any;
  pendingQuestion?: { question: string; foundSoFar?: string } | null;
  phase1BrandProgress?: any[] | null;
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
  product_knowledge?: any;
  driveUrl?: string | null;
  driveFileId?: string | null;
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
  driveFileId?: string;
  createdAt: Date;
}

export interface MockDocument {
  id: string;
  projectId: string;
  docType: string;
  status: string;
  driveUrl?: string | null;
  driveFileId?: string | null;
  snapshotId?: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface MockDocumentField {
  id: string;
  documentId: string;
  fieldId: string;
  section: string;
  question: string;
  answer: string | null;
  // The AI/derivation-generated value, preserved across manual edits to
  // `answer` — see supabase_schema.sql's ai_answer column comment.
  aiAnswer: string | null;
  source: string | null;
  sourceDetail: any;
  flagged: boolean;
  owner: string | null;
  notes: string | null;
  updatedBy: string | null;
  updatedAt: Date;
}

export interface MockDocumentFieldHistory {
  id: string;
  documentFieldId: string;
  answer: string | null;
  changedBy: string | null;
  changedAt: Date;
}

export interface MockProductSnapshot {
  id: string;
  projectId: string;
  sourceUrl: string | null;
  asin: string | null;
  rawData: any;
  capturedAt: Date;
}

export interface MockSectionProvenance {
  id: string;
  productKey: string;
  section: string;
  analysisId: string | null;
  productName: string | null;
  tiers: any[];
  queries: any[];
  resolvedAt: Date;
}

export interface MockProjectGenerationState {
  projectId: string;
  phase: string;
  status: string;
  errorMessage: string | null;
  updatedAt: Date;
}

export interface MockDeckTemplate {
  id: string;
  name: string;
  // Dev-without-Supabase fallback: the .pptx itself as base64, same
  // fallback trick used elsewhere in this codebase (e.g. the artwork
  // route) when a real Storage bucket isn't configured.
  fileBase64: string;
  fileName: string | null;
  fileSizeBytes: number | null;
  slideCount: number;
  placeholderMap: any; // DeckPlaceholderMap, see lib/deck-types.ts
  isActive: boolean;
  uploadedBy: string | null;
  uploadedAt: Date;
  updatedAt: Date;
}

export interface MockProjectDeck {
  id: string;
  projectId: string;
  templateId: string | null;
  status: string; // pending | generating | complete | failed
  fileBase64: string | null;
  fileName: string | null;
  fileSizeBytes: number | null;
  placeholderValues: any;
  slidesRemoved: number[];
  errorMessage: string | null;
  gtmSnapshotAt: string | null;
  generatedAt: Date | null;
  driveUrl: string | null;
  driveFileId: string | null;
  createdAt: Date;
}

export interface MockBrandCategory {
  id: string;
  slug: string;
  name: string;
  productTypes: string[];
  audience: string | null; // 'professional' | 'retail'
  createdAt: Date;
}

export interface MockLegacyBrand {
  id: string;
  categoryId: string;
  brandName: string;
  aliases: string[];
  // Brand's own official website domain(s) — see lib/db/legacy-brands.ts's
  // LegacyBrandRow.official_domains for the full rationale.
  officialDomains: string[];
  enabled: boolean;
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface MockMotorFamily {
  id: string;
  familyKey: string;
  label: string;
  domain: string; // 'clipper_trimmer_shaver' | 'beauty'
  aliases: string[];
  modifier: boolean;
  adjacentFamilies: string[];
  enabled: boolean;
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface MockCompetitorMatchingConfig {
  motorWeight: number;
  priceWeight: number;
  featureWeight: number;
  updatedAt: Date;
}

export interface MockFaq {
  id: string;
  category: string;
  question: string;
  answer: string;
  sortOrder: number;
  enabled: boolean;
  feature?: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface MockFeatureFlag {
  flagName: string;
  enabled: boolean;
  updatedAt: Date;
}

export interface MockFaqVote {
  id: string;
  faqId: string;
  vote: "up" | "down";
  createdAt: Date;
}

export interface MockFaqSearchMiss {
  id: string;
  term: string;
  createdAt: Date;
}

export interface MockMotorTechMiss {
  id: string;
  term: string;
  createdAt: Date;
}

export interface MockSupportMessage {
  id: string;
  userId: string;
  name: string;
  email: string;
  topic: string;
  message: string;
  context: Record<string, any> | null;
  screenshotUrl: string | null;
  emailStatus: "pending" | "sent" | "failed";
  emailError: string | null;
  ackEmailStatus: "pending" | "sent" | "failed";
  adminNotificationRead: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface MockAuthEvent {
  id: string;
  eventType: string;
  email: string | null;
  userId: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  detail: string | null;
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
  documents: MockDocument[] = [];
  documentFields: MockDocumentField[] = [];
  documentFieldHistory: MockDocumentFieldHistory[] = [];
  productSnapshots: MockProductSnapshot[] = [];
  // Deliberately excluded from saveSnapshot/loadSnapshot/reviveDates below —
  // same precedent as productSnapshots itself: doesn't survive a local
  // dev-server restart without Supabase configured, which is expected.
  sectionProvenance: MockSectionProvenance[] = [];
  projectGenerationState: MockProjectGenerationState[] = [];
  // Same non-persisted-across-restart precedent as productSnapshots above —
  // fine at dev scale, Supabase is the real store in production.
  deckTemplates: MockDeckTemplate[] = [];
  projectDecks: MockProjectDeck[] = [];
  // Unlike deckTemplates/projectDecks (an empty admin-fills-it-in feature),
  // this registry must be non-empty in local dev without Supabase too —
  // real default behavior mirroring the seeded supabase_schema.sql rows.
  // seedBrandRegistryDefaults() runs unconditionally below (not gated on
  // loadSnapshot() like seed()), since these arrays are never part of the
  // snapshot file and would otherwise silently stay empty across every
  // restart that finds an existing snapshot on disk.
  brandCategories: MockBrandCategory[] = [];
  legacyBrands: MockLegacyBrand[] = [];
  // Same always-seeded (not snapshot-gated) precedent as brandCategories/
  // legacyBrands above — real default competitor-matching config, not an
  // empty admin table.
  motorFamilies: MockMotorFamily[] = [];
  // Real usage data (an analysis' free-text Motor Technology that didn't
  // match any taxonomy family) — same non-seeded, non-persisted-across-
  // restart precedent as faqSearchMisses just below.
  motorTechSearchMisses: MockMotorTechMiss[] = [];
  competitorMatchingConfig: MockCompetitorMatchingConfig = { motorWeight: 0.45, priceWeight: 0.35, featureWeight: 0.2, updatedAt: new Date() };
  // Same always-seeded precedent — real default Help content, not an
  // empty admin table. Votes/search-misses start empty (real usage data).
  faqs: MockFaq[] = [];
  faqVotes: MockFaqVote[] = [];
  faqSearchMisses: MockFaqSearchMiss[] = [];
  // Always-seeded (same precedent as motorFamilies/competitorMatchingConfig
  // above) — real default flag state, not an empty admin table.
  featureFlags: MockFeatureFlag[] = [
    { flagName: "tds_enabled", enabled: true, updatedAt: new Date() },
    { flagName: "buyer_sentiment_enabled", enabled: false, updatedAt: new Date() },
    { flagName: "news_updates_enabled", enabled: false, updatedAt: new Date() },
  ];
  // Real usage data (Contact Support submissions) — same non-seeded,
  // non-persisted-across-restart precedent as faqVotes/faqSearchMisses.
  supportMessages: MockSupportMessage[] = [];
  // Auth audit log / login-rate-limit tracking — same non-seeded precedent.
  authEvents: MockAuthEvent[] = [];

  constructor() {
    if (IS_SERVERLESS || !this.loadSnapshot()) {
      this.seed();
    }
    this.seedBrandRegistryDefaults();
    this.seedMotorFamilyDefaults();
    this.seedFaqDefaults();
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

  // Mirrors supabase_schema.sql's seed INSERTs exactly (same 4 categories,
  // same brands/aliases/sort_order) — called unconditionally (see
  // constructor) so local dev without Supabase always has real default
  // behavior, not an empty registry. No-op if already seeded (e.g. called
  // twice via a hot reload sharing the global instance).
  seedBrandRegistryDefaults() {
    if (this.brandCategories.length > 0) return;

    const now = new Date();
    const categoryDefs: { slug: string; name: string; productTypes: string[]; audience: string }[] = [
      { slug: "legacy_professional_clippers", name: "Legacy Professional Clippers, Trimmers, and Shavers", productTypes: ["clipper", "trimmer", "shaver"], audience: "professional" },
      { slug: "legacy_retail_clippers", name: "Legacy Retail Clippers, Trimmers, and Shavers", productTypes: ["clipper", "trimmer", "shaver"], audience: "retail" },
      { slug: "professional_beauty", name: "Professional Beauty", productTypes: ["dryer", "iron", "styler", "brush"], audience: "professional" },
      { slug: "retail_beauty", name: "Retail Beauty", productTypes: ["dryer", "iron", "styler", "brush"], audience: "retail" },
    ];

    // Official domain(s) per brand — seeded best-effort from the brand's
    // own known site(s), searched FIRST by lib/brand-site-discovery.ts
    // before falling through to Amazon. Runtime discovery attempts are
    // what actually verify these are live (see the admin "Domain health"
    // panel) — a wrong/stale seed here just means that one brand's
    // brand-site attempts come up empty, never breaks anything.
    const brandDefs: Record<string, { name: string; aliases: string[]; officialDomains: string[] }[]> = {
      legacy_professional_clippers: [
        { name: "Wahl", aliases: [], officialDomains: ["wahlpro.com", "wahl.com"] },
        { name: "Andis", aliases: [], officialDomains: ["andis.com"] },
        { name: "Oster", aliases: [], officialDomains: ["osterpro.com"] },
        { name: "BaByliss", aliases: ["BaBylissPRO", "Babyliss Pro"], officialDomains: ["babylisspro.com"] },
        { name: "TPOB", aliases: ["The Profession Of Barbering"], officialDomains: ["tpobshop.com"] },
        { name: "Cocco", aliases: [], officialDomains: ["coccohaircutting.com"] },
        { name: "JRL", aliases: [], officialDomains: ["jrlprofessional.com"] },
      ],
      legacy_retail_clippers: [
        { name: "Wahl", aliases: [], officialDomains: ["wahlpro.com", "wahl.com"] },
        { name: "Andis", aliases: [], officialDomains: ["andis.com"] },
        { name: "Oster", aliases: [], officialDomains: ["osterpro.com"] },
        { name: "Panasonic", aliases: [], officialDomains: ["panasonic.com"] },
        { name: "Conair", aliases: [], officialDomains: ["conair.com"] },
        { name: "Manscaped", aliases: [], officialDomains: ["manscaped.com"] },
        { name: "Remington", aliases: [], officialDomains: ["remingtonproducts.com"] },
      ],
      professional_beauty: [
        { name: "BaByliss", aliases: ["BaBylissPRO", "Babyliss Pro"], officialDomains: ["babylisspro.com"] },
        { name: "GHD", aliases: [], officialDomains: ["ghdhair.com"] },
        { name: "Paul Mitchell", aliases: [], officialDomains: ["paulmitchell.com"] },
        { name: "Bio Ionic", aliases: [], officialDomains: ["bioionic.com"] },
        { name: "Dyson", aliases: [], officialDomains: ["dyson.com"] },
        { name: "Shark", aliases: [], officialDomains: ["sharkbeauty.com"] },
        { name: "Amika", aliases: [], officialDomains: ["loveamika.com"] },
        { name: "Olivia Garden", aliases: [], officialDomains: ["oliviagarden.com"] },
        { name: "T3", aliases: [], officialDomains: ["t3micro.com"] },
      ],
      retail_beauty: [
        { name: "Conair", aliases: [], officialDomains: ["conair.com"] },
        { name: "Revlon", aliases: [], officialDomains: ["revlonhairtools.com"] },
        { name: "L'Oreal", aliases: ["L'Oréal", "LOreal", "L Oreal"], officialDomains: [] },
        { name: "Hot Tools", aliases: ["Hot Tools Professional"], officialDomains: ["hottools.com"] },
        { name: "Drybar", aliases: [], officialDomains: ["thedrybar.com"] },
        { name: "Dyson", aliases: [], officialDomains: ["dyson.com"] },
        { name: "Shark", aliases: [], officialDomains: ["sharkbeauty.com"] },
      ],
    };

    for (const cat of categoryDefs) {
      const categoryId = `bcat_${cat.slug}`;
      this.brandCategories.push({
        id: categoryId,
        slug: cat.slug,
        name: cat.name,
        productTypes: cat.productTypes,
        audience: cat.audience,
        createdAt: now,
      });
      brandDefs[cat.slug].forEach((b, i) => {
        this.legacyBrands.push({
          id: `lbrand_${cat.slug}_${i}`,
          categoryId,
          brandName: b.name,
          aliases: b.aliases,
          officialDomains: b.officialDomains,
          enabled: true,
          sortOrder: i,
          createdAt: now,
          updatedAt: now,
        });
      });
    }
  }

  // Mirrors supabase_schema.sql's motor_families seed INSERT exactly.
  seedMotorFamilyDefaults() {
    if (this.motorFamilies.length > 0) return;
    const now = new Date();
    const defs: { key: string; label: string; domain: string; aliases: string[]; modifier?: boolean; adjacent?: string[] }[] = [
      { key: "rotary", label: "Rotary", domain: "clipper_trimmer_shaver", aliases: ["rotary motor"] },
      { key: "magnetic_vector", label: "Magnetic / Vector", domain: "clipper_trimmer_shaver", aliases: ["electromagnetic", "vector", "magnetic"], adjacent: ["pivot", "linear"] },
      { key: "pivot", label: "Pivot", domain: "clipper_trimmer_shaver", aliases: ["pivot motor"], adjacent: ["magnetic_vector"] },
      { key: "linear", label: "Linear", domain: "clipper_trimmer_shaver", aliases: ["linear magnetic"], adjacent: ["magnetic_vector"] },
      { key: "ac_motor", label: "AC Motor", domain: "beauty", aliases: ["ac motor"] },
      { key: "dc_motor", label: "DC Motor", domain: "beauty", aliases: ["dc motor"] },
      { key: "brushless_digital", label: "Brushless Digital", domain: "beauty", aliases: ["brushless digital motor", "digital motor"] },
      { key: "brushless", label: "Brushless (modifier)", domain: "clipper_trimmer_shaver", aliases: ["brushless dc", "bldc", "brushless"], modifier: true },
    ];
    defs.forEach((d, i) => {
      this.motorFamilies.push({
        id: `mfam_${d.key}`,
        familyKey: d.key,
        label: d.label,
        domain: d.domain,
        aliases: d.aliases,
        modifier: d.modifier ?? false,
        adjacentFamilies: d.adjacent ?? [],
        enabled: true,
        sortOrder: i,
        createdAt: now,
        updatedAt: now,
      });
    });
  }

  // Mirrors scripts/seed-faqs.ts's upsert logic, from the same shared
  // lib/faq-seed-data.ts source — sort_order is assigned per-category, in
  // the array's own listed order.
  seedFaqDefaults() {
    if (this.faqs.length > 0) return;
    const now = new Date();
    const countByCategory = new Map<string, number>();
    for (const entry of FAQ_SEED_DATA) {
      const sortOrder = countByCategory.get(entry.category) ?? 0;
      countByCategory.set(entry.category, sortOrder + 1);
      this.faqs.push({
        id: `faq_${this.faqs.length}`,
        category: entry.category,
        question: entry.question,
        answer: entry.answer,
        sortOrder,
        enabled: true,
        feature: entry.feature ?? null,
        createdAt: now,
        updatedAt: now,
      });
    }
  }
}

// Global registry for development hot reloads
const globalForMemDb = globalThis as unknown as {
  memoryDb: MemoryDatabase | undefined;
};

export const memoryDb = globalForMemDb.memoryDb ?? new MemoryDatabase();
if (process.env.NODE_ENV !== "production") globalForMemDb.memoryDb = memoryDb;
export default memoryDb;
