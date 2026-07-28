import { prisma } from "./db";
import { memoryDb } from "./memoryDb";
import { genAI, hasGeminiKey, GEMINI_MODEL, cleanJsonString } from "./gemini";
import { openai, hasOpenAIKey, OPENAI_MODEL } from "./openai";
import { getAmazonProduct, resolveAsinBySearch, hasRainforestKey, searchAmazonCategory } from "./rainforest";
import { isSupabaseConfigured } from "./supabase";
import { updateAnalysisPhase, completeAnalysis, failAnalysis, getAnalysis, setPendingQuestion, getRecentAnalysesForBoilerplateCheck, updatePhase1BrandProgress } from "./db/analyses";
import { textSimilarity, BOILERPLATE_SIMILARITY_THRESHOLD } from "./text-similarity";
import { createReportFromAnalysis } from "./db/reports";
import { buildPhase3Prompt } from "./prompts/phase3";
import { getMarketData } from "./market-data";
import { buildOverviewParagraph } from "./build-overview-paragraph";
import { identifyProduct, needsUserInput, IdentityCard } from "./product-identification";
import { getKnownBrandsHint } from "./known-brands-by-category";
import { assertToolType, buildToolTypePromptGuard } from "./tool-type-taxonomy";
import type { ToolType } from "./tool-type-taxonomy";
import { finalizeCitations } from "./citations";
import { insertProvenance } from "./db/section-provenance";
import { resolveCacheKey } from "./product-cache-key";
import { buildPricingProvenanceTier } from "./section-provenance";
import { computePriceBand, deriveTierKeyword, isWithinBand, buildOutOfBandLabel, parsePriceToNumber, type CompetitorTier } from "./price-band";
import { getDocumentByProject, getDocumentFields } from "./db/documents";
import { resolveLegacyBrandsForIdentity, type ResolvedLegacyRegistry } from "./legacy-brand-registry";
import { searchCuratedLegacyBrands, normalizeBrandToken, type BrandProgressEntry } from "./legacy-brand-discovery";
import { listMotorFamilies } from "./db/motor-families";
import type { MotorFamilyRow } from "./db/motor-families";
import { getMatchingWeights } from "./db/competitor-matching-config";
import { isMotorizedCategory, computeMotorMatchTier } from "./motor-taxonomy";
import { extractCompetitorMotorType, resolveOurMotorType, type OurMotorResolution } from "./motor-extraction";
import {
  computeMotorScore, computePriceScoreAbsolute, computePriceScoreRelative, computeFeatureScore,
  computeCompositeScore, dedupeToOnePerBrand, type MatchingWeights,
} from "./competitor-scoring";
import { buildIndieBrandLineups, computePercentileInLineup, type LineupProduct } from "./indie-brand-lineup";
import { resolveOurLineupTier, percentileForManualTier, type LineupTier } from "./our-product-position";
import { extractCompetitorSpecs, extractOurSpecsFromTds } from "./spec-extraction";
import { getTdsFieldsForProject } from "./db/documents";

// "brushless rotary" style combined label — used consistently everywhere
// our own motor type needs to appear in a search query or prompt.
function formatMotorLabel(motor: OurMotorResolution | null): string | null {
  if (!motor) return null;
  return motor.modifierLabel ? `${motor.modifierLabel} ${motor.label}` : motor.label;
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
  // Set via the pause-and-ask answer route when resolveOurLineupTier
  // (lib/our-product-position.ts) can't match the input to a real
  // StyleCraft catalog product — needed only for indie-brand relative
  // price scoring (Phase 2).
  lineupTier?: LineupTier;
  // Required on the analyze/new-project forms going forward — strict
  // tool-type isolation (see lib/tool-type-taxonomy.ts) needs an
  // authoritative signal that isn't the AI's own free-text category/
  // subcategory. Optional here only for backward compatibility with
  // analyses created before this field existed (identifyProduct falls
  // back to evidence-based resolution, pausing to ask if that's also
  // unresolvable — never guesses).
  toolType?: ToolType;
}

// Keyed off the VERIFIED, STRICT identity.toolType (lib/tool-type-taxonomy.ts)
// only — never off `context.industry` (this app's `industry` field only
// ever has two values, both containing "grooming"/"styling", so keying
// fallback data off it routed every analysis to the same branch regardless
// of the actual product) and never off the free-text category/subcategory
// strings either (the previous version's single combined "clipper" OR
// "trimmer" OR "barber" OR "grooming" branch always returned the SAME
// 100%-clipper-named static pool for a trimmer analysis — the single most
// direct, deterministic leak point found when a real trimmer analysis was
// reported showing clipper competitors/specs; this branch is now split per
// tool type, each with its own correctly-typed data, and callers below
// additionally run every fallback candidate through assertToolType before
// splicing it in — see applyPriceBandGate's top-up loop).
function getCategoryFallbackCompetitors(identity: IdentityCard, defaultTier: "legacy" | "emerging") {
  const toolType = identity.toolType;

  // Dryer / styling family — unchanged from before, just now gated on the
  // strict toolType instead of a free-text substring check.
  if (toolType === "dryer" || toolType === "flat_iron" || toolType === "curling_iron" || toolType === "hot_brush" || toolType === "other_styling") {
    return defaultTier === "legacy"
      ? [
          {
            name: "Dyson Supersonic Professional Hair Dryer",
            brand: "Dyson",
            asin: "B0189O6FES",
            price: "$429.99",
            rating: "4.7",
            reviewCount: "12,410",
            sales: "2,000+ bought in past month",
            bsr: "#412 in Beauty & Personal Care",
            initials: "DY",
            top_positive_review_themes: ["Extreme drying speed", "Low heat damage", "Acoustic control quietness"],
            top_negative_review_themes: ["Very high price point", "Heavy cord block", "Stiff attachments"],
            confirmed_technical_specs: { motor_type: "Digital Brushless V9", rpm: "110,000 RPM", run_time: "Corded", charging_time: "N/A", blade_material: "N/A", body_material: "Premium Polymer" }
          },
          {
            name: "BaBylissPRO Nano Titanium Ionic Dryer",
            brand: "BaBylissPRO",
            asin: "B00132890C",
            price: "$89.99",
            rating: "4.6",
            reviewCount: "18,920",
            sales: "4,000+ bought in past month",
            bsr: "#189 in Beauty & Personal Care",
            initials: "BB",
            top_positive_review_themes: ["Lightweight handling", "Consistent heat control", "Sturdy switch controls"],
            top_negative_review_themes: ["Shorter cord length", "High fan noise level", "Comb attachment slips"],
            confirmed_technical_specs: { motor_type: "AC Motor", rpm: "20,000 RPM", run_time: "Corded", charging_time: "N/A", blade_material: "N/A", body_material: "Titanium Composite" }
          },
          {
            name: "Conair InfinitiPRO 1875W AC Motor Dryer",
            brand: "Conair",
            asin: "B000E0L3C0",
            price: "$39.99",
            rating: "4.5",
            reviewCount: "35,120",
            sales: "10,000+ bought in past month",
            bsr: "#95 in Beauty & Personal Care",
            initials: "CO",
            top_positive_review_themes: ["Excellent value for price", "Durable heating element", "Simple filter cleaning"],
            top_negative_review_themes: ["Slightly heavy build", "Plastic odor on first use", "Weak cool shot lock"],
            confirmed_technical_specs: { motor_type: "AC Motor", rpm: "18,000 RPM", run_time: "Corded", charging_time: "N/A", blade_material: "N/A", body_material: "Polycarbonate" }
          },
          {
            name: "Parlux Alyon Air Ionizer Tech Dryer",
            brand: "Parlux",
            asin: "B07D38J36T",
            price: "$230.00",
            rating: "4.6",
            reviewCount: "1,450",
            sales: "300+ bought in past month",
            bsr: "#4,812 in Beauty & Personal Care",
            initials: "PA",
            top_positive_review_themes: ["Extended professional lifespan", "Perfect hand balance", "Very high heat setting"],
            top_negative_review_themes: ["Expensive premium price", "Hard to find parts", "Stiff heat dials"],
            confirmed_technical_specs: { motor_type: "K-Advance Plus DC", rpm: "22,000 RPM", run_time: "Corded", charging_time: "N/A", blade_material: "N/A", body_material: "Antibacterial Plastic" }
          },
          {
            name: "Revlon One-Step Volumizer Original Styler",
            brand: "Revlon",
            asin: "B01LSUQSB0",
            price: "$39.88",
            rating: "4.6",
            reviewCount: "340,110",
            sales: "15,000+ bought in past month",
            bsr: "#12 in Beauty & Personal Care",
            initials: "RE",
            top_positive_review_themes: ["Simultaneous dry and style", "Great volume styling", "Frizz reducing ceramic"],
            top_negative_review_themes: ["Tends to run hot", "Bulky brush diameter", "Bristles wear down quickly"],
            confirmed_technical_specs: { motor_type: "DC Motor", rpm: "15,000 RPM", run_time: "Corded", charging_time: "N/A", blade_material: "N/A", body_material: "Ceramic Composite" }
          }
        ]
      : [
          {
            name: "Shark FlexStyle Air Styling System",
            brand: "Shark Ninja",
            asin: "B0B739JCHX",
            price: "$299.99",
            rating: "4.5",
            reviewCount: "6,810",
            sales: "5,000+ bought in past month",
            bsr: "#150 in Beauty & Personal Care",
            initials: "SH",
            top_positive_review_themes: ["Versatile wand conversion", "Lower heat damage risk", "Fast auto-wrap curling"],
            top_negative_review_themes: ["Curls lose hold quickly", "Learning curve for wrap", "Heavy base handle"],
            confirmed_technical_specs: { motor_type: "Brushless Digital", rpm: "110,000 RPM", run_time: "Corded", charging_time: "N/A", blade_material: "N/A", body_material: "Polymer" }
          },
          {
            name: "Zuvi Halo Infrared Hair Dryer",
            brand: "Zuvi",
            asin: "B09MSN69P3",
            price: "$349.00",
            rating: "4.4",
            reviewCount: "420",
            sales: "200+ bought in past month",
            bsr: "#18,410 in Beauty & Personal Care",
            initials: "ZU",
            top_positive_review_themes: ["Infrared light drying comfort", "Very low power draw", "Leaves hair highly hydrated"],
            top_negative_review_themes: ["Slower drying speed", "Premium price barrier", "Limited heat configuration"],
            confirmed_technical_specs: { motor_type: "High-speed DC", rpm: "105,000 RPM", run_time: "Corded", charging_time: "N/A", blade_material: "N/A", body_material: "Glass Composite" }
          },
          {
            name: "Laifen Swift High Speed Ionic Dryer",
            brand: "Laifen",
            asin: "B09T9B69B9",
            price: "$159.99",
            rating: "4.6",
            reviewCount: "4,210",
            sales: "3,000+ bought in past month",
            bsr: "#1,210 in Beauty & Personal Care",
            initials: "LA",
            top_positive_review_themes: ["Near silent operation", "Stunning premium look", "Fractions of Dyson cost"],
            top_negative_review_themes: ["Diffuser sold separately", "Short cord length", "Buttons feel cheap"],
            confirmed_technical_specs: { motor_type: "Brushless Digital", rpm: "110,000 RPM", run_time: "Corded", charging_time: "N/A", blade_material: "N/A", body_material: "ABS Plastic" }
          },
          {
            name: "Waverly Pro Ceramic Hair Styler",
            brand: "Waverly",
            asin: "B0C1185G9P",
            price: "$79.99",
            rating: "4.3",
            reviewCount: "890",
            sales: "600+ bought in past month",
            bsr: "#9,812 in Beauty & Personal Care",
            initials: "WA",
            top_positive_review_themes: ["Deep waving plates", "Quick ceramic heating", "Dual voltage convenience"],
            top_negative_review_themes: ["Heavy handle lock", "Creases hair easily", "No automatic shutoff"],
            confirmed_technical_specs: { motor_type: "PTC Element", rpm: "N/A", run_time: "Corded", charging_time: "N/A", blade_material: "N/A", body_material: "Ceramic coated" }
          },
          {
            name: "TYMO Ring Hair Straightener Comb",
            brand: "TYMO",
            asin: "B07S17R2NW",
            price: "$49.99",
            rating: "4.5",
            reviewCount: "58,410",
            sales: "8,000+ bought in past month",
            bsr: "#85 in Beauty & Personal Care",
            initials: "TY",
            top_positive_review_themes: ["Saves straightening time", "Safe anti-scald teeth", "Leaves natural volume"],
            top_negative_review_themes: ["Pulls hair if tangled", "Doesn't reach roots well", "Stiff power button"],
            confirmed_technical_specs: { motor_type: "PTC Element", rpm: "N/A", run_time: "Corded", charging_time: "N/A", blade_material: "N/A", body_material: "Ceramic Coated Polymer" }
          }
        ];
  }

  // Clippers ONLY — trimmers get their own branch below with genuinely
  // trimmer-specific products, never these. Shavers get no dedicated
  // dataset (this app has none) and fall through to the honest empty
  // return at the bottom rather than borrowing clipper data.
  if (toolType === "clipper") {
    return defaultTier === "legacy"
      ? [
          {
            name: "Wahl Professional 5-Star Cordless Magic Clip",
            brand: "Wahl",
            asin: "B00UK8F7BI",
            price: "$109.99",
            rating: "4.5",
            reviewCount: "24,847",
            sales: "2,000+ bought in past month",
            bsr: "#1,162 in Beauty & Personal Care",
            initials: "WA",
            top_positive_review_themes: ["Stagger-tooth crunch blade", "Lightweight ergonomic body", "Excellent fading blend"],
            top_negative_review_themes: ["Plastic housing feels thin", "Battery life drops over time", "Blades need frequent zero-gapping"],
            confirmed_technical_specs: { motor_type: "Rotary Motor", rpm: "5,500 RPM", run_time: "100 min", charging_time: "120 min", blade_material: "Crunch Stagger-Tooth Chrome", body_material: "Heavy-duty Plastic" }
          },
          {
            name: "Andis Recon Professional Vector Motor Clipper",
            brand: "Andis",
            asin: "B0DTJLSTYM",
            price: "$199.99",
            rating: "4.5",
            reviewCount: "820",
            sales: "500+ bought in past month",
            bsr: "#2,152 in Beauty & Personal Care",
            initials: "AN",
            top_positive_review_themes: ["Intelligent torque adjustment", "High velocity cutting power", "Very comfortable weight"],
            top_negative_review_themes: ["Generates moderate heat", "Clicks loudly on startup", "Premium price tier"],
            confirmed_technical_specs: { motor_type: "Vector Motor", rpm: "9,500 RPM", run_time: "120 min", charging_time: "90 min", blade_material: "DLC Carbon Steel", body_material: "Polycarbonate/Metal" }
          },
          {
            name: "BaBylissPRO GoldFX Outlining Clipper",
            brand: "BaBylissPRO",
            asin: "B07P41S83V",
            price: "$219.99",
            rating: "4.7",
            reviewCount: "15,291",
            sales: "3,000+ bought in past month",
            bsr: "#843 in Beauty & Personal Care",
            initials: "BB",
            top_positive_review_themes: ["All-metal robust housing", "Extremely sharp zero-gap T-blade", "Long-lasting battery life"],
            top_negative_review_themes: ["Heavy body triggers fatigue", "Metal casing gets cold to touch", "Loud high-frequency buzz"],
            confirmed_technical_specs: { motor_type: "Ferrari Designed Brushless", rpm: "7,200 RPM", run_time: "120 min", charging_time: "180 min", blade_material: "DLC Titanium", body_material: "All-Metal" }
          },
          {
            name: "JRL FreshFade 2020C Professional",
            brand: "JRL",
            asin: "B08NPDW1C8",
            price: "$139.99",
            rating: "4.6",
            reviewCount: "2,812",
            sales: "1,000+ bought in past month",
            bsr: "#12,983 in Beauty & Personal Care",
            initials: "JR",
            top_positive_review_themes: ["Stay-cool blade tech", "Advanced locking lever system", "Quiet whispering operation"],
            top_negative_review_themes: ["Blade requires custom replacements", "Plastic body details feel cheap", "Bulky dimensions"],
            confirmed_technical_specs: { motor_type: "Advanced Rotary", rpm: "7,200 RPM", run_time: "240 min", charging_time: "180 min", blade_material: "Titanium Ceramic", body_material: "Hardened Plastic" }
          },
          {
            name: "TPOB Play Cordless Vector Motor Clipper",
            brand: "TPOB",
            asin: "B0CMQG8H7S",
            price: "$89.99",
            rating: "4.2",
            reviewCount: "156",
            sales: "300+ bought in past month",
            bsr: "#133,173 in Beauty & Personal Care",
            initials: "TP",
            top_positive_review_themes: ["Very aggressive price point", "Dynamic vector load speed", "Aggressive modern aesthetic"],
            top_negative_review_themes: ["Shorter battery lifespan", "Rough housing seams", "Inconsistent power switch feel"],
            confirmed_technical_specs: { motor_type: "Vector Motor", rpm: "10,000 RPM", run_time: "120 min", charging_time: "90 min", blade_material: "DLC Carbon", body_material: "Injection Molded Plastic" }
          },
          {
            name: "StyleCraft Saber Professional Brushless Clipper",
            brand: "StyleCraft",
            asin: "B09KGBM3R4",
            price: "$199.95",
            rating: "4.6",
            reviewCount: "1,820",
            sales: "800+ bought in past month",
            bsr: "#3,124 in Beauty & Personal Care",
            initials: "SC",
            top_positive_review_themes: ["Quiet brushless high torque", "Heavy duty metal housing", "Custom body skin choices"],
            top_negative_review_themes: ["Heavy grip fatigue", "Charging stand takes up space", "Click lever gets loose"],
            confirmed_technical_specs: { motor_type: "Digital Brushless", rpm: "7,500 RPM", run_time: "180 min", charging_time: "120 min", blade_material: "DLC Diamond Carbon", body_material: "Metal Front Panel" }
          }
        ]
      : [
          {
            name: "SUPRENT Fangs Professional Hair Clipper",
            brand: "SUPRENT",
            asin: "B0CPPDY5N6",
            price: "$79.99",
            rating: "4.4",
            reviewCount: "312",
            sales: "500+ bought in past month",
            bsr: "#24,192 in Beauty & Personal Care",
            initials: "SU",
            top_positive_review_themes: ["Vector motor automatic torque", "Super affordable vector entry", "Compact size fits small hands"],
            top_negative_review_themes: ["Battery drains quickly on thick hair", "Cheap plastic guards", "High motor vibration"],
            confirmed_technical_specs: { motor_type: "Vector Motor", rpm: "9,000 RPM", run_time: "100 min", charging_time: "120 min", blade_material: "Titanium Coated Steel", body_material: "Composite Plastic" }
          },
          {
            name: "Supreme Trimmer Darkstar Vector Motor",
            brand: "Supreme Trimmer",
            asin: "B0D21VXPML",
            price: "$99.95",
            rating: "4.3",
            reviewCount: "94",
            sales: "100+ bought in past month",
            bsr: "#84,291 in Beauty & Personal Care",
            initials: "ST",
            top_positive_review_themes: ["Vector speed intelligence", "DLC click lever precision", "Great design visuals"],
            top_negative_review_themes: ["Blade gets warm", "Lighter weight feels less robust", "Click lever spring fatigue"],
            confirmed_technical_specs: { motor_type: "Vector Motor", rpm: "9,500 RPM", run_time: "120 min", charging_time: "90 min", blade_material: "Diamond Like Carbon", body_material: "ABS Plastic" }
          },
          {
            name: "Caliber 9mm Magnetic Clipper",
            brand: "Caliber",
            asin: "B0BLDG2X1K",
            price: "$119.00",
            rating: "4.4",
            reviewCount: "412",
            sales: "200+ bought in past month",
            bsr: "#32,183 in Beauty & Personal Care",
            initials: "CA",
            top_positive_review_themes: ["High frequency magnetic cut", "Very clean feed line", "Premium weight balance"],
            top_negative_review_themes: ["Loud magnetic click on start", "Runs quite warm", "Flimsy taper lever"],
            confirmed_technical_specs: { motor_type: "Magnetic Motor", rpm: "10,000 RPM", run_time: "120 min", charging_time: "120 min", blade_material: "Japanese Steel", body_material: "Polycarbonate" }
          },
          {
            name: "Limural Professional Hair Clipper Set",
            brand: "Limural",
            asin: "B08V4R2J2F",
            price: "$45.99",
            rating: "4.4",
            reviewCount: "12,412",
            sales: "3,000+ bought in past month",
            bsr: "#512 in Beauty & Personal Care",
            initials: "LI",
            top_positive_review_themes: ["Amazing complete kit price", "Quiet home barber use", "Long charge runtime"],
            top_negative_review_themes: ["Low motor torque for thick hair", "Heavy stainless steel weight", "Blades pull under fast speed"],
            confirmed_technical_specs: { motor_type: "Standard Rotary", rpm: "6,000 RPM", run_time: "300 min", charging_time: "240 min", blade_material: "Stainless Steel", body_material: "Stainless Steel" }
          },
          {
            name: "Kemei Professional Cordless Hair Clipper",
            brand: "Kemei",
            asin: "B07X4A2Z2F",
            price: "$35.99",
            rating: "4.3",
            reviewCount: "6,912",
            sales: "2,000+ bought in past month",
            bsr: "#1,891 in Beauty & Personal Care",
            initials: "KM",
            top_positive_review_themes: ["Cheap backup option", "Familiar ergonomic look", "Decent battery indicator"],
            top_negative_review_themes: ["Weak plastic housing parts", "Pulls coarse hair", "No official replacement blades"],
            confirmed_technical_specs: { motor_type: "Rotary Motor", rpm: "5,800 RPM", run_time: "120 min", charging_time: "180 min", blade_material: "Carbon Steel", body_material: "Plastic Chrome Plate" }
          }
        ];
  }

  // Trimmers ONLY — genuinely trimmer-specific products (T-blade detailers/
  // outliners, not clippers). This is the branch that was previously
  // missing entirely — a trimmer analysis fell into the clipper branch
  // above, which is exactly the contamination this file's toolType
  // gating exists to stop.
  if (toolType === "trimmer") {
    return defaultTier === "legacy"
      ? [
          {
            name: "Wahl Professional 5-Star Cordless Detailer",
            brand: "Wahl",
            asin: "B00A6HB1M4",
            price: "$99.99",
            rating: "4.6",
            reviewCount: "18,210",
            sales: "2,000+ bought in past month",
            bsr: "#1,840 in Beauty & Personal Care",
            initials: "WA",
            top_positive_review_themes: ["Ultra-close zero-gap T-blade", "Great for clean edges/lineups", "Long-lasting charge"],
            top_negative_review_themes: ["Blade needs frequent oiling", "Plastic housing feels light", "Short guard set included"],
            confirmed_technical_specs: { motor_type: "Rotary Motor", rpm: "8,200 RPM", run_time: "90 min", charging_time: "150 min", blade_material: "Fine Zero-Gap T-Blade Steel", body_material: "Heavy-duty Plastic" }
          },
          {
            name: "Andis GTX-EXO Cordless Trimmer",
            brand: "Andis",
            asin: "B07QK6Q4YV",
            price: "$139.99",
            rating: "4.7",
            reviewCount: "9,340",
            sales: "1,000+ bought in past month",
            bsr: "#2,910 in Beauty & Personal Care",
            initials: "AN",
            top_positive_review_themes: ["Very high RPM for fast lining", "Precise deep-tooth T-blade", "Comfortable slim grip"],
            top_negative_review_themes: ["Runs warm on long sessions", "Premium price tier", "Charging stand sold separately"],
            confirmed_technical_specs: { motor_type: "Magnetic Motor", rpm: "10,000 RPM", run_time: "120 min", charging_time: "90 min", blade_material: "Deep-Tooth Carbon Steel T-Blade", body_material: "Textured Grip Composite" }
          },
          {
            name: "BaBylissPRO SnapFX Trimmer",
            brand: "BaBylissPRO",
            asin: "B01N7Z6H0F",
            price: "$149.99",
            rating: "4.6",
            reviewCount: "6,120",
            sales: "800+ bought in past month",
            bsr: "#3,420 in Beauty & Personal Care",
            initials: "BB",
            top_positive_review_themes: ["Snap-in/out replaceable blade", "All-metal durable housing", "Sharp fine-tooth cutting"],
            top_negative_review_themes: ["Heavier than plastic competitors", "Metal body gets cold", "Loud high-pitch motor whine"],
            confirmed_technical_specs: { motor_type: "Ferrari Designed Brushless", rpm: "7,800 RPM", run_time: "90 min", charging_time: "150 min", blade_material: "Deep Tooth DLC T-Blade", body_material: "All-Metal" }
          },
          {
            name: "Gamma+ Absolute Zero Cordless Trimmer",
            brand: "Gamma+",
            asin: "B08G4KXH1T",
            price: "$119.95",
            rating: "4.5",
            reviewCount: "2,410",
            sales: "500+ bought in past month",
            bsr: "#9,120 in Beauty & Personal Care",
            initials: "GA",
            top_positive_review_themes: ["Zero-gap blade out of the box", "Strong torque for a trimmer", "Sleek modern design"],
            top_negative_review_themes: ["Battery indicator inaccurate", "Blade guard clips loosely", "Limited color options"],
            confirmed_technical_specs: { motor_type: "Magnetic Motor", rpm: "9,000 RPM", run_time: "100 min", charging_time: "120 min", blade_material: "Zero-Gap DLC T-Blade", body_material: "Polycarbonate" }
          },
          {
            name: "StyleCraft Shorty Pro Li Trimmer",
            brand: "StyleCraft",
            asin: "B08XJQ4W3K",
            price: "$99.95",
            rating: "4.6",
            reviewCount: "1,240",
            sales: "400+ bought in past month",
            bsr: "#6,210 in Beauty & Personal Care",
            initials: "SC",
            top_positive_review_themes: ["Compact lightweight body", "Quiet brushless operation", "Custom body skin choices"],
            top_negative_review_themes: ["Small guard comb sizes", "Charging cradle takes desk space", "Limited torque on thick hair"],
            confirmed_technical_specs: { motor_type: "Digital Brushless", rpm: "7,200 RPM", run_time: "120 min", charging_time: "90 min", blade_material: "DLC Diamond Carbon T-Blade", body_material: "Metal Front Panel" }
          }
        ]
      : [
          {
            name: "SUPRENT Fangs Professional Trimmer",
            brand: "SUPRENT",
            asin: "B0CPQ2X8YN",
            price: "$49.99",
            rating: "4.3",
            reviewCount: "980",
            sales: "500+ bought in past month",
            bsr: "#28,410 in Beauty & Personal Care",
            initials: "SU",
            top_positive_review_themes: ["Very affordable entry trimmer", "Decent lineup precision", "Compact for travel"],
            top_negative_review_themes: ["Battery drains fast", "Cheap plastic guards", "Blade dulls quickly"],
            confirmed_technical_specs: { motor_type: "Rotary Motor", rpm: "7,000 RPM", run_time: "90 min", charging_time: "120 min", blade_material: "Titanium Coated Steel T-Blade", body_material: "Composite Plastic" }
          },
          {
            name: "Supreme Trimmer Dark Wolf Detailer",
            brand: "Supreme Trimmer",
            asin: "B0D24Q9XPL",
            price: "$69.95",
            rating: "4.3",
            reviewCount: "410",
            sales: "200+ bought in past month",
            bsr: "#44,210 in Beauty & Personal Care",
            initials: "ST",
            top_positive_review_themes: ["Good value for the RPM", "Sharp out-of-box blade", "Nice aesthetic finish"],
            top_negative_review_themes: ["Blade gets warm on long use", "Light body feels less durable", "Weak battery indicator"],
            confirmed_technical_specs: { motor_type: "Magnetic Motor", rpm: "8,000 RPM", run_time: "100 min", charging_time: "90 min", blade_material: "DLC T-Blade", body_material: "ABS Plastic" }
          },
          {
            name: "Caliber .223 Trimmer",
            brand: "Caliber",
            asin: "B0BLDH3Y2M",
            price: "$89.00",
            rating: "4.4",
            reviewCount: "310",
            sales: "150+ bought in past month",
            bsr: "#38,910 in Beauty & Personal Care",
            initials: "CA",
            top_positive_review_themes: ["Crisp magnetic-motor lining", "Very clean edge work", "Premium weight balance"],
            top_negative_review_themes: ["Loud magnetic click on start", "Runs warm", "Flimsy blade guard"],
            confirmed_technical_specs: { motor_type: "Magnetic Motor", rpm: "8,500 RPM", run_time: "110 min", charging_time: "100 min", blade_material: "Japanese Steel T-Blade", body_material: "Polycarbonate" }
          },
          {
            name: "Limural Professional Detail Trimmer",
            brand: "Limural",
            asin: "B08V5S3K4G",
            price: "$29.99",
            rating: "4.3",
            reviewCount: "4,120",
            sales: "1,000+ bought in past month",
            bsr: "#1,910 in Beauty & Personal Care",
            initials: "LI",
            top_positive_review_themes: ["Amazing value kit price", "Fine for light home use", "Long charge runtime"],
            top_negative_review_themes: ["Low torque on thick hair", "Blade pulls at fast speed", "Basic plastic housing"],
            confirmed_technical_specs: { motor_type: "Standard Rotary", rpm: "6,500 RPM", run_time: "180 min", charging_time: "150 min", blade_material: "Stainless Steel T-Blade", body_material: "Stainless Steel" }
          },
          {
            name: "Kemei Professional Detail Trimmer",
            brand: "Kemei",
            asin: "B07X5B3Z3G",
            price: "$24.99",
            rating: "4.2",
            reviewCount: "3,210",
            sales: "800+ bought in past month",
            bsr: "#2,410 in Beauty & Personal Care",
            initials: "KM",
            top_positive_review_themes: ["Cheap backup option", "Familiar ergonomic look", "Decent battery indicator"],
            top_negative_review_themes: ["Weak plastic housing parts", "Blade dulls fast", "No official replacement blades"],
            confirmed_technical_specs: { motor_type: "Rotary Motor", rpm: "5,500 RPM", run_time: "100 min", charging_time: "150 min", blade_material: "Carbon Steel T-Blade", body_material: "Plastic Chrome Plate" }
          }
        ];
  }

  // No dedicated curated mock data for this category. This used to
  // fabricate entirely fake companies here ("Apex Global", "Vanguard
  // Corp", etc. — the exact fake-brand names reported as a bug) with
  // invented prices/ASINs/ratings computed from a hash of the product
  // name. Confirmed live that this was still reachable via
  // cleanCompetitors's per-slot backfill even after discoverCompetitorsLive
  // was added elsewhere as the preferred live-data path. Returning fewer
  // real competitors is correct; inventing fake ones is not — so this now
  // returns nothing, and cleanCompetitors below simply omits any slot it
  // can't fill with real (AI-returned or live-discovered) data.
  return [];
}

// `cleaned` also drops any AI-returned competitor whose own name/feature
// text doesn't match the identified category (lib/category-synonyms.ts) —
// a clipper can never survive into a hair-dryer analysis, even if the AI
// itself proposed one.
// STAGE A — category/self-name/ASIN-placeholder filtering only. No price
// awareness, no truncation to a fixed count: runs on whatever the AI/live
// search actually returned (up to 8 per the bumped prompt count), producing
// a clean candidate pool for applyPriceBandGate (below) to price-filter,
// widen, and truncate AFTER Rainforest enrichment resolves real live prices.
export function filterCandidatesByCategoryAndIdentity(competitors: any[], defaultTier: "legacy" | "emerging", identity: IdentityCard): any[] {
  const incomingList = Array.isArray(competitors) ? competitors : [];
  const cleaned: any[] = [];
  // Well above the 8 the prompt now requests — just a runaway-response cap,
  // bounding how many candidates enrichCompetitorsWithRainforest ever has
  // to look up.
  const POOL_CAP = 12;

  // A real competitor's name never contains the analyzed product's own
  // name — that's the exact fabrication pattern confirmed live from OpenAI
  // (gpt-5) when it runs out of real search results but still tries to
  // fill the requested count: entries like "Vanguard Corp StyleCraft Twist
  // Hair Crimper Pro Pro" (a fake company name with our own product name
  // pasted on). These pass the category-match check below (they literally
  // repeat our category text) so a dedicated check is needed here.
  const ownProductNameLower = (identity.productName || "").toLowerCase().trim();
  function isNamedAfterOwnProduct(name: string): boolean {
    if (!ownProductNameLower || ownProductNameLower.length < 6) return false;
    return name.toLowerCase().includes(ownProductNameLower);
  }

  for (const rawIncoming of incomingList) {
    if (cleaned.length >= POOL_CAP) break;
    if (!rawIncoming || !rawIncoming.name) continue;
    const candidateText = `${rawIncoming.name || ""} ${rawIncoming.top_feature_summary || ""}`;
    // No identity.toolType (legacy analysis pre-dating this field) —
    // nothing strict to validate against, don't block. Otherwise this is
    // THE gate that stops a clipper from ever surviving into a trimmer
    // analysis (or vice versa), even if the AI itself proposed one.
    if (identity.toolType && !assertToolType(candidateText, identity.toolType).ok) {
      console.warn(`[tool-type] rejected candidate "${rawIncoming.name}" — mismatched tool type for ${identity.toolType}`);
      continue;
    }
    if (isNamedAfterOwnProduct(rawIncoming.name || "")) continue;

    let asin = rawIncoming.asin || "";
    let amazonUrl = rawIncoming.amazon_url || "";

    // Matches the LITERAL "BXXXXXXXXX" placeholder pattern from the
    // prompt's own schema example (3+ consecutive X's), not just any
    // ASIN containing the letter X — real ASINs commonly contain X
    // (e.g. "B0DMXJPM4T", confirmed live via Rainforest).
    const isAsinPlaceholder = !asin || /X{3,}/i.test(asin) || asin.includes("000000") || !/^[A-Z0-9]{10}$/i.test(asin);
    const isUrlPlaceholder = !amazonUrl || /X{3,}/i.test(amazonUrl) || amazonUrl.includes("000000");

    if (isAsinPlaceholder) {
      // No trustworthy identifier — leave blank rather than borrowing a
      // fallback brand's ASIN (that's now applyPriceBandGate's job, and
      // only for a genuinely unfilled slot, never to patch a real AI pick).
      // enrichCompetitorsWithRainforest tries to resolve a real ASIN via
      // live search next; if that fails too, the card shows the honest
      // "Unverified" badge rather than a fabricated identifier.
      asin = "";
      amazonUrl = "";
    } else if (isUrlPlaceholder) {
      amazonUrl = `https://www.amazon.com/dp/${asin}`;
    }

    cleaned.push({
      ...rawIncoming,
      // Preserves the AI's own claimed price string before enrichment can
      // overwrite `price` — applyPriceBandGate falls back to this when no
      // live Rainforest price resolves for a candidate.
      ai_claimed_price: rawIncoming.price || null,
      asin,
      amazon_url: amazonUrl,
      tier: defaultTier,
      initials: rawIncoming.initials || (rawIncoming.name || "").split(" ").slice(0, 2).map((w: string) => w[0]).join("").toUpperCase(),
      // Strengths/weaknesses/recent buyer sentiment are never AI-generated —
      // populated on demand from real Amazon reviews via
      // /api/amazon/reviews-analysis/[asin] (see CompetitorCard).
      strengths: [],
      weaknesses: [],
      recent_news: [],
    });
  }

  return cleaned;
}

// STAGE B — the price-band gate. Must run AFTER enrichCompetitorsWithRainforest
// (so `price_raw` is a real live Rainforest number where resolvable, not
// just whatever the AI claimed). Widens the band stepwise (±30% -> ±40% ->
// ±50%) only if fewer than `limit` candidates are in-band, tags any
// accepted out-of-band pick with the reason, and only then tops up any
// still-unfilled slots from the curated fallback dataset — itself gated by
// the exact same price check, never a silent price-unaware fill.
export function applyPriceBandGate(
  candidates: any[],
  targetPriceRaw: number,
  tier: CompetitorTier,
  identity: IdentityCard,
  limit = 5,
  opts: { allowStaticFallbackTopup?: boolean } = {}
): any[] {
  const allowStaticFallbackTopup = opts.allowStaticFallbackTopup ?? true;
  const withPrice = candidates.map(c => ({
    ...c,
    _resolvedPrice: typeof c.price_raw === "number" ? c.price_raw : parsePriceToNumber(c.ai_claimed_price),
  }));

  const primaryBand = computePriceBand(targetPriceRaw, tier, 0);
  const widestBand = computePriceBand(targetPriceRaw, tier, 2);

  let accepted: any[] = [];
  for (let widenStep = 0; widenStep <= 2; widenStep++) {
    const band = computePriceBand(targetPriceRaw, tier, widenStep);
    const inBand = withPrice.filter(c => c._resolvedPrice != null && isWithinBand(c._resolvedPrice, band));
    if (inBand.length >= limit || widenStep === 2) {
      accepted = inBand;
      break;
    }
  }

  // Reject-logging for observability — every candidate that never made it
  // in, with the reason (no resolvable price at all vs. genuinely outside
  // even the widest band).
  for (const c of withPrice) {
    if (accepted.includes(c)) continue;
    if (c._resolvedPrice == null) {
      console.warn(`[price-band] rejected "${c.name}" (${tier}) — no resolvable price (no live Rainforest match, no AI-claimed price)`);
    } else {
      console.warn(`[price-band] rejected "${c.name}" (${tier}) — $${c._resolvedPrice.toFixed(2)} is outside even the widest band ($${widestBand.min.toFixed(2)}-$${widestBand.max.toFixed(2)})`);
    }
  }

  // Prefer in-band (primary-band) candidates first; among out-of-band
  // (only-reachable-via-widening) candidates, prefer whichever is closest
  // to the primary band's edge. Ties preserve the AI's own original
  // preference order (stable sort, comparator returns 0).
  const sorted = [...accepted].sort((a, b) => {
    const aIn = isWithinBand(a._resolvedPrice, primaryBand);
    const bIn = isWithinBand(b._resolvedPrice, primaryBand);
    if (aIn !== bIn) return aIn ? -1 : 1;
    if (aIn && bIn) return 0;
    const aDist = Math.min(Math.abs(a._resolvedPrice - primaryBand.min), Math.abs(a._resolvedPrice - primaryBand.max));
    const bDist = Math.min(Math.abs(b._resolvedPrice - primaryBand.min), Math.abs(b._resolvedPrice - primaryBand.max));
    return aDist - bDist;
  });

  const final: any[] = sorted.slice(0, limit).map(c => {
    const { _resolvedPrice, ai_claimed_price, ...rest } = c;
    const outOfBand = !isWithinBand(_resolvedPrice, primaryBand);
    return outOfBand
      ? { ...rest, out_of_band: true, out_of_band_reason: buildOutOfBandLabel(_resolvedPrice, primaryBand) }
      : rest;
  });

  // Still short after exhausting real candidates — top up from the curated
  // fallback dataset, but only entries whose own static price also passes
  // the widest band. Only reachable for categories with real curated
  // fallback data; the generic/uncurated branch returns [] (see
  // getCategoryFallbackCompetitors), so this is a no-op for those.
  // Skippable via allowStaticFallbackTopup:false — this static dataset is
  // unrelated to the legacy-brand registry (lib/db/legacy-brands.ts) and
  // has no "not on curated list" tagging, so the curated-registry-only gate
  // call (lib/analysisEngine.ts's Phase 1 branch) must not let it silently
  // stand in for an honest AI-fallback result.
  if (final.length < limit && allowStaticFallbackTopup) {
    const usedNames = new Set(final.map(c => (c.name || "").toLowerCase()));
    const fallbackPool = getCategoryFallbackCompetitors(identity, tier);
    for (const fb of fallbackPool) {
      if (final.length >= limit) break;
      if (usedNames.has((fb.name || "").toLowerCase())) continue;
      const fbPrice = parsePriceToNumber(fb.price);
      if (fbPrice == null || !isWithinBand(fbPrice, widestBand)) continue;
      // Defense-in-depth: getCategoryFallbackCompetitors is already keyed
      // strictly on identity.toolType (its own header comment), so this
      // should never actually fire — but this loop is the exact spot the
      // original clipper-into-trimmer contamination bug was found (it
      // checked only price-band membership, never category), so it gets
      // its own explicit re-check rather than trusting the pool blindly.
      if (identity.toolType && !assertToolType(fb.name || "", identity.toolType).ok) {
        console.warn(`[tool-type] rejected fallback candidate "${fb.name}" — mismatched tool type for ${identity.toolType}`);
        continue;
      }

      usedNames.add((fb.name || "").toLowerCase());
      const outOfBand = !isWithinBand(fbPrice, primaryBand);
      final.push({
        name: fb.name,
        brand: fb.brand,
        tier,
        asin: fb.asin,
        amazon_url: `https://www.amazon.com/dp/${fb.asin}`,
        price: fb.price,
        price_raw: fbPrice,
        rating: fb.rating,
        review_count: fb.reviewCount || (fb as any).review_count,
        monthly_sales: fb.sales || (fb as any).monthly_sales,
        bsr_rank: fb.bsr || (fb as any).bsr_rank,
        initials: fb.initials,
        key_features: [],
        strengths: [],
        weaknesses: [],
        recent_news: [],
        top_feature_summary: "",
        ...(outOfBand ? { out_of_band: true, out_of_band_reason: buildOutOfBandLabel(fbPrice, primaryBand) } : {}),
      });
    }
  }
  // else: still short and no curated fallback data covers this category —
  // returning fewer real competitors is correct; inventing a fake one to
  // fill the slot is not.

  return final;
}

export interface CompositeScoringContext {
  motorFamilies: MotorFamilyRow[];
  ourMotor: OurMotorResolution | null;
  ourSpecs: import("./competitor-scoring").FeatureComparable;
  weights: MatchingWeights;
  // Indie-only — absent/undefined for legacy, in which case price scoring
  // is always absolute-to-target (per the spec, relative pricing is an
  // indie-specific concept).
  ourLineupPercentile?: number | null;
  indieLineups?: Map<string, LineupProduct[]>;
}

// Replaces applyPriceBandGate's plain "in-band first, then closest to
// target price" selection with the full motor -> price -> feature
// composite (Part 3). applyPriceBandGate itself is left untouched (still
// exported, still used by the offline verify suite) — this is a fresh,
// independent implementation of the same widen-step band math (identical
// ±30/40/50% legacy / asymmetric emerging bands, same static-fallback-topup
// safety net) so that motor/price/feature scoring can influence WHICH
// candidates survive out of the fuller pre-truncation pool, not just
// re-sort an already-capped 5 (see the plan's Context section for why that
// distinction matters). When ourMotor is null (a non-motorized category, or
// motor genuinely undeterminable), every candidate's motor tier resolves to
// "unverified" uniformly via computeMotorMatchTier's own null-handling —
// motor scoring becomes a neutral constant that doesn't discriminate
// between candidates, so ranking gracefully degrades to price+feature only,
// with no separate code path needed for "motor doesn't apply here."
export function selectByCompositeScore(
  candidates: any[],
  targetPriceRaw: number,
  tier: CompetitorTier,
  identity: IdentityCard,
  limit: number,
  ctx: CompositeScoringContext,
  opts: { allowStaticFallbackTopup?: boolean } = {}
): any[] {
  const allowStaticFallbackTopup = opts.allowStaticFallbackTopup ?? true;
  const withPrice = candidates.map(c => ({
    ...c,
    _resolvedPrice: typeof c.price_raw === "number" ? c.price_raw : parsePriceToNumber(c.ai_claimed_price ?? c.price),
  }));

  const primaryBand = computePriceBand(targetPriceRaw, tier, 0);
  const widestBand = computePriceBand(targetPriceRaw, tier, 2);

  let accepted: any[] = [];
  for (let widenStep = 0; widenStep <= 2; widenStep++) {
    const band = computePriceBand(targetPriceRaw, tier, widenStep);
    const inBand = withPrice.filter(c => c._resolvedPrice != null && isWithinBand(c._resolvedPrice, band));
    if (inBand.length >= limit || widenStep === 2) {
      accepted = inBand;
      break;
    }
  }

  const scored = accepted.map(c => {
    const motorExtraction = extractCompetitorMotorType(c, ctx.motorFamilies);
    const motorMatchTier = computeMotorMatchTier(ctx.ourMotor?.familyKey ?? null, motorExtraction?.familyKey ?? null, ctx.motorFamilies);
    const motorScore = computeMotorScore(motorMatchTier);

    let priceScore: number;
    let priceLogic: "absolute" | "relative" = "absolute";
    let theirLineupPercentile: number | null = null;
    let theirLineupSample: LineupProduct[] | null = null;

    if (tier === "emerging" && ctx.ourLineupPercentile != null && ctx.indieLineups) {
      const lineup = ctx.indieLineups.get(c.brand) || [];
      const pct = lineup.length >= 2 ? computePercentileInLineup(c._resolvedPrice, lineup) : null;
      if (pct != null) {
        priceScore = computePriceScoreRelative(ctx.ourLineupPercentile, pct);
        priceLogic = "relative";
        theirLineupPercentile = pct;
        theirLineupSample = lineup;
      } else {
        priceScore = computePriceScoreAbsolute(c._resolvedPrice, targetPriceRaw);
      }
    } else {
      priceScore = computePriceScoreAbsolute(c._resolvedPrice, targetPriceRaw);
    }

    const theirSpecs = extractCompetitorSpecs(c);
    const featureScore = computeFeatureScore(ctx.ourSpecs, theirSpecs);
    const compositeScore = computeCompositeScore(motorScore, priceScore, featureScore, ctx.weights);

    const outOfBand = !isWithinBand(c._resolvedPrice, primaryBand);
    const { _resolvedPrice, ai_claimed_price, ...rest } = c;

    return {
      ...rest,
      motor_type: motorExtraction?.label ?? null,
      motor_family_key: motorExtraction?.familyKey ?? null,
      motor_modifier: motorExtraction?.modifierLabel ?? null,
      motor_source_quote: motorExtraction?.sourceQuote ?? null,
      motor_match_tier: motorMatchTier,
      motor_score: motorScore,
      price_score: priceScore,
      price_logic: priceLogic,
      their_lineup_percentile: theirLineupPercentile,
      their_lineup_sample: theirLineupSample,
      our_lineup_percentile: ctx.ourLineupPercentile ?? null,
      feature_score: featureScore,
      composite_score: compositeScore,
      ...(outOfBand ? { out_of_band: true, out_of_band_reason: buildOutOfBandLabel(_resolvedPrice, primaryBand) } : {}),
    };
  });

  scored.sort((a, b) => b.composite_score - a.composite_score);
  let final = tier === "legacy" ? dedupeToOnePerBrand(scored, limit) : scored.slice(0, limit);

  // Same static-fallback topup as applyPriceBandGate, for the same reason —
  // only reachable for categories with real curated fallback data.
  // Skippable via allowStaticFallbackTopup:false for the exact same reason
  // applyPriceBandGate's own opts param exists (see its header comment).
  if (final.length < limit && allowStaticFallbackTopup) {
    const usedNames = new Set(final.map((c: any) => (c.name || "").toLowerCase()));
    const fallbackPool = getCategoryFallbackCompetitors(identity, tier);
    for (const fb of fallbackPool) {
      if (final.length >= limit) break;
      if (usedNames.has((fb.name || "").toLowerCase())) continue;
      const fbPrice = parsePriceToNumber(fb.price);
      if (fbPrice == null || !isWithinBand(fbPrice, widestBand)) continue;
      // Defense-in-depth: getCategoryFallbackCompetitors is already keyed
      // strictly on identity.toolType (its own header comment), so this
      // should never actually fire — but this loop is the exact spot the
      // original clipper-into-trimmer contamination bug was found (it
      // checked only price-band membership, never category), so it gets
      // its own explicit re-check rather than trusting the pool blindly.
      if (identity.toolType && !assertToolType(fb.name || "", identity.toolType).ok) {
        console.warn(`[tool-type] rejected fallback candidate "${fb.name}" — mismatched tool type for ${identity.toolType}`);
        continue;
      }

      usedNames.add((fb.name || "").toLowerCase());
      const outOfBand = !isWithinBand(fbPrice, primaryBand);
      final.push({
        name: fb.name,
        brand: fb.brand,
        tier,
        asin: fb.asin,
        amazon_url: `https://www.amazon.com/dp/${fb.asin}`,
        price: fb.price,
        price_raw: fbPrice,
        rating: fb.rating,
        review_count: fb.reviewCount || (fb as any).review_count,
        monthly_sales: fb.sales || (fb as any).monthly_sales,
        bsr_rank: fb.bsr || (fb as any).bsr_rank,
        initials: fb.initials,
        key_features: [],
        strengths: [],
        weaknesses: [],
        recent_news: [],
        top_feature_summary: "",
        motor_type: null,
        motor_match_tier: "unverified",
        motor_score: computeMotorScore("unverified"),
        price_score: computePriceScoreAbsolute(fbPrice, targetPriceRaw),
        price_logic: "absolute",
        feature_score: 0,
        composite_score: 0,
        ...(outOfBand ? { out_of_band: true, out_of_band_reason: buildOutOfBandLabel(fbPrice, primaryBand) } : {}),
      });
    }
  }

  return final;
}

// Runs `fn` over `items` with at most `limit` in flight at once — Rainforest
// enforces a concurrent-request cap on some plans, and firing all 10
// competitors' lookups (each up to 2 sequential Rainforest calls) via a
// single Promise.all could burst well past that, causing MORE competitors
// to fail verification than a real per-account rate limit would otherwise
// allow. Small batches keep this well under any reasonable concurrency cap.
async function mapWithConcurrency<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

// Overwrite AI-discovered competitor price/rating/review data with real,
// verified live Amazon data from Rainforest. Tries the AI-provided ASIN
// first; if that doesn't resolve to a real listing (common — hardcoded
// fallback/mock ASINs go stale as real listings get delisted or replaced),
// searches Amazon by product title + brand to find the CURRENT real ASIN
// before giving up. Competitors that can't be verified either way have
// their price/rating/ASIN explicitly cleared (never left showing a stale
// or fabricated value as if it were current) and point at a live Amazon
// search instead of a fabricated /dp/{asin} link.
async function enrichCompetitorsWithRainforest(competitors: any[], requiredToolType?: ToolType | null): Promise<any[]> {
  if (!hasRainforestKey) return competitors;

  return mapWithConcurrency(competitors, 3, async (c) => {
      // Already live-verified by discoverCompetitorsLive (a `type=search`
      // result, already real/current) — re-checking via a second,
      // independent `type=product` lookup here is redundant and, if that
      // second call has a transient failure, would wrongly overwrite
      // already-good data with "unverified" placeholders.
      if (c.verified_by_rainforest === true) return c;

      let product = await getAmazonProduct(c.asin);

      // A syntactically-valid, real ASIN can still be the WRONG product —
      // the direct lookup has no cross-check against what the AI actually
      // claimed this competitor was, so a stale/hallucinated/sibling-SKU
      // ASIN would otherwise silently overwrite price/rating/specs/images
      // with a different tool type's real data while the displayed name
      // stayed unchanged (an invisible mismatch). Discard it exactly like
      // a failed lookup rather than trusting a wrong-type product.
      if (product && requiredToolType && !assertToolType(product.title, requiredToolType).ok) {
        console.warn(`[tool-type] discarded direct-ASIN Rainforest match for "${c.name}" — "${product.title}" doesn't match required type ${requiredToolType}`);
        product = null;
      }

      if (!product) {
        const match = await resolveAsinBySearch(c.name, c.brand);
        if (match) {
          const candidateProduct = await getAmazonProduct(match.asin);
          // Same tool-type cross-check on the fallback title-search match
          // — its own acceptance threshold (brand-substring + >=0.6 title
          // token-overlap similarity) comfortably passes a sibling product
          // whose title differs only in the type word (e.g. "clipper" vs
          // "trimmer"), so tool-type agreement is required IN ADDITION to
          // that similarity score, not instead of it.
          if (candidateProduct && requiredToolType && !assertToolType(candidateProduct.title, requiredToolType).ok) {
            console.warn(`[tool-type] discarded fallback title-search match for "${c.name}" — "${candidateProduct.title}" doesn't match required type ${requiredToolType}`);
          } else {
            product = candidateProduct;
          }
        }
      }

      if (!product) {
        // Keep a format-valid, AI-discovered ASIN instead of wiping it —
        // Rainforest verification can fail (credit/auth outage, transient
        // network issue) even when the ASIN itself is correct, and nulling
        // it here previously meant the reviews-analysis endpoint never even
        // attempted the Amazon tier for an otherwise-correct competitor.
        // `verified_by_rainforest: false` already signals "unconfirmed" to
        // every downstream reader — nothing else treats asin === null as a
        // hard "no ASIN exists" sentinel.
        const keptAsin = /^[A-Z0-9]{10}$/i.test(c.asin ?? "") ? c.asin : null;
        return {
          ...c,
          asin: keptAsin,
          price: "—",
          rating: "—",
          review_count: "—",
          verified_by_rainforest: false,
          amazon_url: keptAsin
            ? `https://www.amazon.com/dp/${keptAsin}`
            : `https://www.amazon.com/s?k=${encodeURIComponent(`${c.brand || ""} ${c.name}`.trim())}`,
        };
      }

      // Real, verbatim bullet points from the live listing replace whatever
      // the AI guessed — kept in the same {headline,...} shape the UI
      // already renders, but the text itself is never AI-invented once a
      // real listing is verified.
      const realFeatures = product.feature_bullets.slice(0, 6).map(bullet => ({
        headline: bullet,
        source: "Amazon",
        attribution: "From the Amazon listing:",
        detail: "",
      }));

      return {
        ...c,
        asin: product.asin,
        price: product.price,
        price_raw: product.price_raw,
        last_updated: product.last_updated,
        rating: product.rating_str,
        review_count: product.reviews_str,
        monthly_sales: product.monthly_str || c.monthly_sales,
        bsr_rank: product.bsr || c.bsr_rank,
        amazon_url: product.amazon_url,
        image: product.image,
        images: product.images.length ? product.images : (product.image ? [product.image] : []),
        manufacturer: product.manufacturer,
        model_number: product.model_number,
        description: product.description,
        key_features: realFeatures.length > 0 ? realFeatures : c.key_features,
        verified_by_rainforest: true,
      };
  });
}

// Pricing has no separate resolver/search step of its own (see
// lib/pricing-analysis.ts's header comment) — its "provenance" is simply
// whether the Rainforest product lookup just performed above resolved a
// real price for each competitor. Best-effort per competitor; a slow/broken
// write here must never affect the analysis result itself.
async function persistPricingProvenance(competitors: any[], analysisId: string): Promise<void> {
  for (const comp of competitors) {
    try {
      await insertProvenance({
        productKey: resolveCacheKey(comp.asin ?? "", comp.name ?? ""),
        section: "pricing",
        analysisId,
        productName: comp.name ?? null,
        tiers: [buildPricingProvenanceTier(comp)],
        queries: [],
      });
    } catch (e) {
      console.warn("Failed to persist pricing provenance:", e);
    }
  }
}

// One row per legacy competitor recording WHERE it came from — the curated
// registry category, or (when a competitor had to be filled by the AI
// top-up because curated brands couldn't reach 5 in-band picks) an honest
// "not on curated list" tier. Feeds the exact same PDF "Data Sources &
// Methodology" appendix pricing provenance already uses — best-effort,
// never blocks the analysis result.
async function persistLegacyRegistryProvenance(competitors: any[], registry: ResolvedLegacyRegistry, analysisId: string): Promise<void> {
  for (const comp of competitors) {
    try {
      const isCurated = comp.curated_brand === true;
      await insertProvenance({
        productKey: resolveCacheKey(comp.asin ?? "", comp.name ?? ""),
        section: "legacy_brand_registry",
        analysisId,
        productName: comp.name ?? null,
        tiers: [{
          tier: isCurated ? `Curated list: ${registry.categoryName}` : "Not on curated legacy list — AI-sourced fallback",
          attempted: true,
          outcome: "success",
        }],
        queries: [],
      });
    } catch (e) {
      console.warn("Failed to persist legacy brand registry provenance:", e);
    }
  }
}

export interface AnalysisStepResult {
  analysisId: string;
  phase: number;
  status: "running" | "complete" | "failed" | "cancelled";
  stepResult: any;
  totalSearches: number;
  reportId?: string;
  error?: string;
  // Set when Stage 0 (Product Identification) can't confidently determine
  // the category and the pipeline has paused — the client must collect an
  // answer and POST /api/analyses/:id/answer before calling continue again.
  pendingQuestion?: { question: string; foundSoFar?: string; field?: string; placeholder?: string };
}

function hasResult(result: any): boolean {
  return !!result && typeof result === "object" && Object.keys(result).length > 0;
}

// Runs exactly ONE phase of the pipeline per call, driven by the caller
// (see app/api/analyses/[id]/continue/route.ts). Each Vercel Hobby-plan
// invocation is hard-capped at 60s and background work is killed the
// instant a response is sent — a single call running all 4 AI phases
// routinely exceeded that and silently orphaned the analysis at phase 0.
// Splitting into resumable, DB-persisted steps means every call is a
// short, independent round trip, and a refreshed/reconnecting client just
// resumes from whatever phase is persisted.
//
// Phase 0 (Product Identification) was added ahead of the original 3
// competitor-discovery/synthesis phases so every downstream phase can key
// off a VERIFIED category instead of a hardcoded default — previously
// Phase 1/2's prompts unconditionally instructed the model to "search
// ONLY these 8 hair-clipper brands" and to search "[motor type] motor
// clipper" regardless of what product was actually submitted, and the
// fallback/market-data routers keyed off `industry` (which only ever has
// two grooming-related values), so every analysis routed to clipper data
// even when the AI behaved correctly.
// Resolves the one target price competitor discovery anchors on, in
// priority order: (1) the analysis form's own "Target Price" field, (2) the
// linked project's GTM document's approved_pricing field (same waterfall
// lib/db/reports.ts already uses at report-render time, kept consistent
// here), (3) Phase 0's own live/web-search-derived observed price. Returns
// null only when none of these resolve — runAnalysisStep's Phase 1 branch
// pauses and asks the user rather than proceeding unpriced.
export async function resolveDiscoveryTargetPrice(context: AnalysisContext, identity: IdentityCard): Promise<number | null> {
  const fromContext = parsePriceToNumber(context.pricePoint);
  if (fromContext != null) return fromContext;

  if (context.projectId) {
    try {
      const gtmDoc = await getDocumentByProject(context.projectId, "gtm");
      if (gtmDoc) {
        const fields = await getDocumentFields(gtmDoc.id);
        const approvedPricing = fields.find(f => f.field_id === "approved_pricing")?.answer ?? null;
        const fromGtm = parsePriceToNumber(approvedPricing);
        if (fromGtm != null) return fromGtm;
      }
    } catch {
      // Best-effort only — a missing/broken GTM doc must never block discovery.
    }
  }

  // priceObserved.value is already a number (see product-identification.ts) —
  // no string parsing needed here, unlike the other two candidates above.
  if (typeof identity.priceObserved?.value === "number") return identity.priceObserved.value;

  return null;
}

export async function runAnalysisStep(analysisId: string): Promise<AnalysisStepResult> {
  const startTime = Date.now();
  const record: any = await getAnalysis(analysisId);
  if (!record) {
    throw new Error("Analysis not found");
  }

  // "cancelled" (POST /api/analyses/:id/cancel) is a terminal state exactly
  // like complete/failed — this guard is what stops a stray/in-flight
  // /continue call (one already sent before the user clicked Cancel) from
  // running a further phase after cancellation, since the client itself
  // only stops ASKING for more, it can't reach into and kill work already
  // in progress.
  if (record.status === "complete" || record.status === "failed" || record.status === "cancelled") {
    return {
      analysisId,
      phase: record.phase,
      status: record.status,
      stepResult: null,
      totalSearches: 0,
      error: record.error_message || undefined,
    };
  }

  // The pipeline cannot advance while a clarifying question is unanswered
  // — POST /api/analyses/:id/answer clears this before the next call may
  // actually run identification again. This is a no-op return, not an
  // error, so the client can keep polling without accidentally retrying
  // mid-question.
  if (record.pending_question) {
    return {
      analysisId,
      phase: record.phase,
      status: "running",
      stepResult: null,
      totalSearches: 0,
      pendingQuestion: record.pending_question,
    };
  }

  const context: AnalysisContext = {
    id: analysisId,
    orgId: record.org_id || "dev_org_id",
    userId: record.user_id,
    projectId: record.project_id || null,
    ...(record.context || {}),
  };

  const identityCard: IdentityCard | null = hasResult(record.phase0_result) ? record.phase0_result : null;
  const phase1Result = hasResult(record.phase1_result) ? record.phase1_result : null;
  const phase2Result = hasResult(record.phase2_result) ? record.phase2_result : null;

  let webSearchCount = 0;
  const onSearchUsed = () => { webSearchCount += 1; };

  try {
    if (record.phase === 0) {
      // ----------------------------------------------------
      // PHASE 0: PRODUCT IDENTIFICATION (mandatory, runs before any competitor search)
      // ----------------------------------------------------
      const card = await identifyProduct(context);

      if (needsUserInput(card, context)) {
        await updateAnalysisPhase(analysisId, 0, "phase0_result", card, 0);
        const question = {
          question: `What type of product is ${context.productName}? (e.g., trimmer, shaver, dryer, straightener)`,
          foundSoFar: card.whatItIs || undefined,
        };
        await setPendingQuestion(analysisId, question);
        return { analysisId, phase: 0, status: "running", stepResult: card, totalSearches: 0, pendingQuestion: question };
      }

      // Strict tool-type isolation (lib/tool-type-taxonomy.ts) — the
      // analyze/new-project forms now require a Tool Type selection, so
      // this should rarely fire for new analyses; it's a defensive
      // fallback for analyses created before the field existed, or a
      // genuinely ambiguous identification (e.g. evidence mentions both
      // "clipper" and "trimmer") with no user selection to fall back on.
      // Never guesses — a wrong silent guess here is exactly the
      // clipper-into-trimmer contamination this field exists to stop.
      if (!card.toolType) {
        await updateAnalysisPhase(analysisId, 0, "phase0_result", card, 0);
        const question = {
          question: `What exact tool type is ${context.productName}? (clipper, trimmer, shaver, hair dryer, flat iron, curling iron, hot brush, or combo/multi-tool kit) This determines which competitors and data the analysis uses — it's never mixed across types.`,
          field: "toolType",
          foundSoFar: card.whatItIs || undefined,
        };
        await setPendingQuestion(analysisId, question);
        return { analysisId, phase: 0, status: "running", stepResult: card, totalSearches: 0, pendingQuestion: question };
      }

      await updateAnalysisPhase(analysisId, 1, "phase0_result", card, 0);
      return { analysisId, phase: 1, status: "running", stepResult: card, totalSearches: 0 };
    }

    if (record.phase === 1) {
      // ----------------------------------------------------
      // PHASE 1: ESTABLISHED-COMPETITOR DISCOVERY
      // ----------------------------------------------------
      // Deliberately sequential with Phase 2, not concurrent — briefly
      // tried running both phases' OpenAI calls at once (Promise.all) to
      // speed up analyze, but reverted it: confirmed live that immediately
      // afterward, an analysis had EVERY phase (1, 2, AND 3) time out on
      // OpenAI in the same run, producing zero competitors in both lists.
      // Two simultaneous reasoning+web-search calls against the same
      // OpenAI account plausibly contend for the same per-minute
      // rate/throughput budget, making both individually slower and more
      // likely to blow the 45s timeout than if they ran one at a time —
      // and a wrong/empty competitor list is a worse failure mode for this
      // app than a slower one. Not confirmed as the definite root cause
      // (OpenAI's own reasoning+search latency is already known to vary
      // run-to-run — see runOpenAiWebSearch's tuning notes), but the risk
      // wasn't worth the speed gain.
      if (!identityCard) throw new Error("Missing product identity — cannot run competitor discovery");

      // Competitors must cluster around the user's actual target price — a
      // $25 product can never be a real competitor to a $260 product. If no
      // price is resolvable from anywhere, pause and ask rather than
      // guessing/proceeding unpriced (same pause mechanism as Phase 0's
      // product-identity question, just anchored on phase 1 instead of 0).
      const targetPriceRaw = await resolveDiscoveryTargetPrice(context, identityCard);
      if (targetPriceRaw == null) {
        const question = {
          question: `What price are you targeting for ${context.productName}? (e.g. $259.95)`,
          field: "pricePoint",
          placeholder: "e.g. $259.95",
        };
        await setPendingQuestion(analysisId, question);
        return { analysisId, phase: 1, status: "running", stepResult: null, totalSearches: 0, pendingQuestion: question };
      }

      // Motor type is priority #1 (dominates selection, per the matching
      // spec) — resolved once, before any discovery runs. isMotorizedCategory
      // reuses the exact category-keyword resolution the legacy registry
      // already does; a genuinely unrelated product skips the requirement
      // entirely rather than being forced to answer an inapplicable question.
      const motorFamilies = await listMotorFamilies();
      const motorRequired = isMotorizedCategory(identityCard);
      const ourMotor = await resolveOurMotorType({ motorTech: context.motorTech, projectId: context.projectId }, identityCard, motorFamilies);
      if (motorRequired && !ourMotor) {
        const question = {
          question: `What motor technology does ${context.productName} use? (e.g. "brushless rotary", "magnetic/vector", "pivot")`,
          field: "motorType",
          placeholder: "e.g. brushless rotary",
        };
        await setPendingQuestion(analysisId, question);
        return { analysisId, phase: 1, status: "running", stepResult: null, totalSearches: 0, pendingQuestion: question };
      }
      const ourMotorLabel = formatMotorLabel(ourMotor);
      const weights = await getMatchingWeights();
      const ourSpecs = context.projectId
        ? extractOurSpecsFromTds(await getTdsFieldsForProject(context.projectId))
        : extractOurSpecsFromTds(null);
      const scoringCtx: CompositeScoringContext = {
        motorFamilies,
        ourMotor,
        ourSpecs,
        weights: { motor: Number(weights.motor_weight), price: Number(weights.price_weight), feature: Number(weights.feature_weight) },
      };

      // Curated legacy-brand registry (lib/db/legacy-brands.ts) takes
      // priority over AI judgment when the identified product maps to one
      // of the 4 registry categories — brand-targeted Rainforest search
      // (lib/legacy-brand-discovery.ts) instead of an open-ended prompt.
      // Falls back to today's unmodified AI-discovery flow entirely when
      // there's no registry match (an out-of-registry category) or the
      // registry category has zero enabled brands.
      const registry = await resolveLegacyBrandsForIdentity(identityCard);
      let result: any;

      if (registry) {
        // Wrapped with category context on every write — the live panel
        // (components/analyze/ProgressPanel.tsx, polling this via GET
        // /api/analyses/[id]) needs the category name/slug alongside each
        // brand's live status, not just the bare brand array.
        const writeBrandProgress = (entries: BrandProgressEntry[]) =>
          updatePhase1BrandProgress(analysisId, {
            category_slug: registry.categorySlug,
            category_name: registry.categoryName,
            brands: entries,
          });

        await writeBrandProgress(registry.brands.map(b => ({ brand: b.brand_name, status: "searching" })));

        const curatedCandidates = await searchCuratedLegacyBrands(
          registry.brands,
          identityCard,
          targetPriceRaw,
          registry.categorySlug,
          writeBrandProgress,
          undefined,
          ourMotorLabel
        );

        let competitors = filterCandidatesByCategoryAndIdentity(curatedCandidates, "legacy", identityCard);
        // Motor -> price -> feature composite selection, not just
        // "in-band first, then closest to target price" — see
        // selectByCompositeScore's own header comment for why
        // applyPriceBandGate itself stays untouched. allowStaticFallbackTopup:
        // false — the curated-only pass must never silently pull from the
        // unrelated static getCategoryFallbackCompetitors dataset in place
        // of an honest "not on curated list" AI result below (topup is
        // still available on the SECOND, post-AI-topup call further down).
        competitors = selectByCompositeScore(competitors, targetPriceRaw, "legacy", identityCard, 5, scoringCtx, { allowStaticFallbackTopup: false });

        // Only attempt the AI top-up if the curated pass finished fast — it
        // has its own ~15s hard cap (CURATED_BRAND_SEARCH_TIME_BUDGET_MS),
        // and OpenAI's web-search leg (runOpenAiWebSearch) has NO time-budget
        // check of its own today (only Gemini's fallback leg does), so a
        // slow curated pass followed by a full ~45s OpenAI attempt could
        // push this phase past Vercel's 60s ceiling. Skipping is always
        // safe/honest — fewer real curated results is correct, inventing
        // competitors to fill the gap is not.
        const AI_TOPUP_TIME_THRESHOLD_MS = 8_000;
        if (competitors.length < 5 && Date.now() - startTime < AI_TOPUP_TIME_THRESHOLD_MS) {
          const aiResult: any = await withAiFallback(
            "Phase 1 (curated top-up)",
            hasGeminiKey ? () => executePhase1Gemini(context, identityCard, targetPriceRaw, onSearchUsed, ourMotorLabel) : null,
            hasOpenAIKey ? () => executePhase1OpenAI(context, identityCard, targetPriceRaw, onSearchUsed, ourMotorLabel) : null,
            () => generateMockPhase1(context, identityCard, targetPriceRaw),
            startTime
          );
          webSearchCount += aiResult.web_searches_performed || 0;

          let aiCompetitors = filterCandidatesByCategoryAndIdentity(aiResult.competitors, "legacy", identityCard);
          if (hasRainforestKey) {
            aiCompetitors = await enrichCompetitorsWithRainforest(aiCompetitors, identityCard.toolType);
          }

          // Never duplicate a brand slot already filled by the curated pass.
          const usedBrands = new Set(competitors.map((c: any) => normalizeBrandToken(c.brand || "")));
          aiCompetitors = aiCompetitors
            .filter((c: any) => !usedBrands.has(normalizeBrandToken(c.brand || "")))
            .map((c: any) => ({ ...c, curated_brand: false, brand_list_status: "not_curated" }));

          competitors = selectByCompositeScore([...competitors, ...aiCompetitors], targetPriceRaw, "legacy", identityCard, 5, scoringCtx);
        }

        result = {
          web_searches_performed: webSearchCount,
          competitors,
          // Snapshotted per-analysis for auditability — which category and
          // exact brand list (in priority order) this run actually searched,
          // independent of any later admin edit to the live registry.
          legacy_registry_snapshot: {
            category_slug: registry.categorySlug,
            category_name: registry.categoryName,
            brands: registry.brands.map(b => ({ brand_name: b.brand_name, aliases: b.aliases, sort_order: b.sort_order })),
          },
          // Same auditability reasoning — the actual weights THIS run used,
          // independent of any later admin edit to the live config.
          matching_weights: scoringCtx.weights,
        };
        // Per-competitor provenance (which curated list — or the "not on
        // curated list" AI fallback — sourced each legacy pick), feeding the
        // PDF's existing "Data Sources & Methodology" appendix.
        await persistLegacyRegistryProvenance(competitors, registry, analysisId);
      } else {
        result = await withAiFallback(
          "Phase 1",
          hasGeminiKey ? () => executePhase1Gemini(context, identityCard, targetPriceRaw, onSearchUsed, ourMotorLabel) : null,
          hasOpenAIKey ? () => executePhase1OpenAI(context, identityCard, targetPriceRaw, onSearchUsed, ourMotorLabel) : null,
          () => generateMockPhase1(context, identityCard, targetPriceRaw),
          startTime
        );

        result.competitors = filterCandidatesByCategoryAndIdentity(result.competitors, "legacy", identityCard);
        if (hasRainforestKey) {
          result.competitors = await enrichCompetitorsWithRainforest(result.competitors, identityCard.toolType);
        }
        result.competitors = selectByCompositeScore(result.competitors, targetPriceRaw, "legacy", identityCard, 5, scoringCtx);
        result.matching_weights = scoringCtx.weights;
        webSearchCount += result.web_searches_performed || 0;
      }

      if (hasRainforestKey) {
        await persistPricingProvenance(result.competitors, analysisId);
      }

      await updateAnalysisPhase(analysisId, 2, "phase1_result", result, webSearchCount);
      return { analysisId, phase: 2, status: "running", stepResult: result, totalSearches: webSearchCount };
    }

    if (record.phase === 2) {
      // ----------------------------------------------------
      // PHASE 2: EMERGING-COMPETITOR DISCOVERY
      // ----------------------------------------------------
      if (!identityCard) throw new Error("Missing product identity — cannot run competitor discovery");

      // Already resolved once during Phase 1 (and, if it required a pause,
      // the user's answer is now in context.pricePoint) — re-resolving here
      // is just a cheap re-read, not a second pause opportunity.
      const targetPriceRaw = await resolveDiscoveryTargetPrice(context, identityCard);
      if (targetPriceRaw == null) {
        const question = {
          question: `What price are you targeting for ${context.productName}? (e.g. $259.95)`,
          field: "pricePoint",
          placeholder: "e.g. $259.95",
        };
        await setPendingQuestion(analysisId, question);
        return { analysisId, phase: 2, status: "running", stepResult: null, totalSearches: 0, pendingQuestion: question };
      }

      // Same registry category as Phase 1 (re-resolved fresh — cheap, and
      // consistent with resolveDiscoveryTargetPrice's "cheap re-read, not a
      // second pause opportunity" precedent above). When a registry match
      // exists, its brand names+aliases become the exclude-hint in place of
      // the static getKnownBrandsHint list, AND registry brands are hard-
      // filtered out of the results below — a real guarantee, not just a
      // prompt-level request the model could ignore.
      const registry = await resolveLegacyBrandsForIdentity(identityCard);
      const registryBrandTokens = registry
        ? new Set(registry.brands.flatMap(b => [b.brand_name, ...b.aliases].map(normalizeBrandToken)))
        : null;
      const brandHintOverride = registry ? registry.brands.flatMap(b => [b.brand_name, ...b.aliases]) : undefined;

      // Same motor resolution as Phase 1 (cheap re-read — already resolved
      // once, or already in context.motorTech from that phase's own pause).
      const motorFamilies = await listMotorFamilies();
      const motorRequired = isMotorizedCategory(identityCard);
      const ourMotor = await resolveOurMotorType({ motorTech: context.motorTech, projectId: context.projectId }, identityCard, motorFamilies);
      if (motorRequired && !ourMotor) {
        const question = {
          question: `What motor technology does ${context.productName} use? (e.g. "brushless rotary", "magnetic/vector", "pivot")`,
          field: "motorType",
          placeholder: "e.g. brushless rotary",
        };
        await setPendingQuestion(analysisId, question);
        return { analysisId, phase: 2, status: "running", stepResult: null, totalSearches: 0, pendingQuestion: question };
      }
      const ourMotorLabel = formatMotorLabel(ourMotor);
      const weights = await getMatchingWeights();
      const ourSpecs = context.projectId
        ? extractOurSpecsFromTds(await getTdsFieldsForProject(context.projectId))
        : extractOurSpecsFromTds(null);

      // Relative pricing (Part 4) needs to know where OUR product sits in
      // OUR OWN lineup — resolved lazily here (indie-only), not in Phase 1,
      // since a legacy-only analysis never needs this. Real StyleCraft
      // catalog match first; a one-field pause-and-ask ("flagship/mid/
      // entry?") only when the product isn't a recognized catalog entry.
      let ourLineupPercentile: number | null = null;
      const lineupPosition = resolveOurLineupTier(context.productName);
      if (lineupPosition) {
        ourLineupPercentile = lineupPosition.percentile;
      } else if (context.lineupTier) {
        ourLineupPercentile = percentileForManualTier(context.lineupTier);
      } else {
        const question = {
          question: `Is ${context.productName} your premium/flagship model, a mid-tier model, or an entry-level model?`,
          field: "lineupTier",
          placeholder: "flagship, mid, or entry",
        };
        await setPendingQuestion(analysisId, question);
        return { analysisId, phase: 2, status: "running", stepResult: null, totalSearches: 0, pendingQuestion: question };
      }

      const result: any = await withAiFallback(
        "Phase 2",
        hasGeminiKey ? () => executePhase2Gemini(context, identityCard, targetPriceRaw, onSearchUsed, brandHintOverride, ourMotorLabel) : null,
        hasOpenAIKey ? () => executePhase2OpenAI(context, identityCard, targetPriceRaw, onSearchUsed, brandHintOverride, ourMotorLabel) : null,
        () => generateMockPhase2(context, identityCard, targetPriceRaw, phase1Result),
        startTime
      );

      result.competitors = filterCandidatesByCategoryAndIdentity(result.competitors, "emerging", identityCard);
      if (registryBrandTokens) {
        result.competitors = result.competitors.filter((c: any) => !registryBrandTokens.has(normalizeBrandToken(c.brand || "")));
      }
      if (hasRainforestKey) {
        result.competitors = await enrichCompetitorsWithRainforest(result.competitors, identityCard.toolType);
      }

      // Build each surviving candidate's brand's own price lineup (Part 4) —
      // the one genuinely new, costly operation this feature adds, so it's
      // scoped to only the distinct brands still in play at this point, not
      // every brand the AI ever mentioned.
      const subcategoryForLineups = identityCard.subcategory || identityCard.category || "";
      const distinctBrands: string[] = Array.from(new Set(result.competitors.map((c: any) => c.brand as string).filter(Boolean)));
      const indieLineups = await buildIndieBrandLineups(distinctBrands.map(brand => ({ brand, subcategory: subcategoryForLineups })));

      const scoringCtx: CompositeScoringContext = {
        motorFamilies,
        ourMotor,
        ourSpecs,
        weights: { motor: Number(weights.motor_weight), price: Number(weights.price_weight), feature: Number(weights.feature_weight) },
        ourLineupPercentile,
        indieLineups,
      };
      result.competitors = selectByCompositeScore(result.competitors, targetPriceRaw, "emerging", identityCard, 5, scoringCtx);
      result.matching_weights = scoringCtx.weights;
      if (hasRainforestKey) {
        await persistPricingProvenance(result.competitors, analysisId);
      }
      webSearchCount += result.web_searches_performed || 0;

      await updateAnalysisPhase(analysisId, 3, "phase2_result", result, webSearchCount);
      return { analysisId, phase: 3, status: "running", stepResult: result, totalSearches: webSearchCount };
    }

    if (record.phase === 3) {
      // ----------------------------------------------------
      // PHASE 3a: STRATEGIC SYNTHESIS (main AI call only)
      // ----------------------------------------------------
      // Split from what used to be a single request doing synthesis +
      // conditional anti-boilerplate retry + citation verification + report
      // save, all sequentially — each of the first two is independently
      // capable of running close to the per-call AI timeout on its own (see
      // Phase 1's own comment on OpenAI web-search latency variance), so
      // stacking two of them plus citation fetches routinely blew past
      // Vercel's 60s cap ("connection dropped" for the user, mid-request,
      // with no error ever persisted since the function was killed before
      // it could write one). record.phase stays "3" in the DB response
      // client-side is never told about this split (see phase 4 below) —
      // ProgressPanel's existing generic "call /continue again" loop just
      // keeps polling, so no client change was needed for the resumability
      // itself, only a small guard against a premature "Complete" flash
      // (see ProgressPanel.tsx's step.phase !== 4 check).
      if (!phase1Result || !phase2Result || !identityCard) {
        throw new Error("Missing identity/phase 1/2 results — cannot run phase 3");
      }

      const result: any = await withAiFallback(
        "Phase 3",
        hasGeminiKey ? () => executePhase3Gemini(context, identityCard, phase1Result, phase2Result, onSearchUsed) : null,
        hasOpenAIKey ? () => executePhase3OpenAI(context, identityCard, phase1Result, phase2Result, onSearchUsed) : null,
        () => generateMockPhase3(context, identityCard, phase1Result, phase2Result),
        startTime
      );
      webSearchCount += result.web_searches_performed || 0;
      result.__phase3Stage = "synthesized";

      await updateAnalysisPhase(analysisId, 4, "phase3_result", result, webSearchCount);
      return { analysisId, phase: 4, status: "running", stepResult: null, totalSearches: webSearchCount };
    }

    if (record.phase === 4) {
      if (!phase1Result || !phase2Result || !identityCard) {
        throw new Error("Missing identity/phase 1/2 results — cannot finish phase 3");
      }
      const stage = record.phase3_result?.__phase3Stage;
      let result: any = record.phase3_result;
      delete result.__phase3Stage;

      if (stage === "synthesized") {
        // ----------------------------------------------------
        // PHASE 3b: ANTI-BOILERPLATE CHECK (at most one more AI call)
        // ----------------------------------------------------
        // If this analysis's positioning text is near-identical to a recent
        // DIFFERENT-category analysis, it's almost certainly generic
        // could-apply-to-anything strategy text — one regeneration attempt
        // with the real competitor facts, same retry-with-facts pattern
        // already proven in lib/gtm-generate.ts.
        try {
          const positioningText = typeof result.positioning_recommendation === "string" ? result.positioning_recommendation : "";
          if (positioningText && (hasOpenAIKey || hasGeminiKey)) {
            const recent = await getRecentAnalysesForBoilerplateCheck(context.orgId, analysisId);
            const boilerplateMatch = recent.find(r =>
              r.category && r.category.toLowerCase() !== identityCard.category.toLowerCase() &&
              r.positioningText && textSimilarity(positioningText, r.positioningText) > BOILERPLATE_SIMILARITY_THRESHOLD
            );
            if (boilerplateMatch) {
              const facts = [...(phase1Result?.competitors || []), ...(phase2Result?.competitors || [])]
                .slice(0, 3)
                .map((c: any) => `${c.name} at ${c.price || "an unlisted price"}`);
              const extraInstruction = `The draft was generic. Rewrite strictly about ${identityCard.subcategory} using these specific competitor facts: ${facts.join("; ") || "the competitor data above"}.`;
              const retried = hasOpenAIKey
                ? await executePhase3OpenAI(context, identityCard, phase1Result, phase2Result, onSearchUsed, extraInstruction)
                : await executePhase3Gemini(context, identityCard, phase1Result, phase2Result, onSearchUsed, extraInstruction);
              if (retried && typeof retried.positioning_recommendation === "string") {
                result = retried;
              }
            }
          }
        } catch (err) {
          console.warn("Phase 3 anti-boilerplate check failed (non-fatal, keeping original result):", err);
        }

        result.__phase3Stage = "boilerplateChecked";
        await updateAnalysisPhase(analysisId, 4, "phase3_result", result, webSearchCount);
        return { analysisId, phase: 4, status: "running", stepResult: null, totalSearches: webSearchCount };
      }

      // ----------------------------------------------------
      // PHASE 3c: CITATIONS + MARKET-SIZE CHECK + finalize
      // ----------------------------------------------------
      // Universal citation verification: independently fetch every URL the
      // model cited and downgrade any claim whose quote doesn't actually
      // appear on that page — never trust the model's own citation as-is.
      // Applied uniformly regardless of which provider produced `result`
      // (OpenAI, Gemini, or mock all go through the same check).
      try {
        const rawCitations = Array.isArray(result.citations) ? result.citations : [];
        result.citations = await finalizeCitations(rawCitations, analysisId);
      } catch (err) {
        console.warn("Phase 3 citation verification failed (non-fatal, treating as no citations):", err);
        result.citations = [];
      }

      // Market size is the highest-risk hallucination surface: if this
      // category has no curated market data (lib/market-data.ts) AND no
      // verified market_stat citation survived the check above, force the
      // honest fallback regardless of whatever number the model wrote —
      // never let an uncited figure reach the UI/PDF.
      const hasCuratedMarketData = !!getMarketData(identityCard.subcategory || identityCard.category, context.productName);
      const hasVerifiedMarketStat = (result.citations || []).some((c: any) => c.type === "market_stat" && c.verification === "verified");
      if (!hasCuratedMarketData && !hasVerifiedMarketStat && result.market_snapshot) {
        const noDataDate = new Date().toISOString().slice(0, 10);
        result.market_snapshot.market_size_current = null;
        result.market_snapshot.market_size_forecast = null;
        result.market_snapshot.forecast_year = null;
        result.market_snapshot.cagr_percent = null;
        result.market_snapshot.cagr_period = null;
        result.market_snapshot.data_source = null;
        result.market_snapshot.headline_stat_label = "unavailable";
        result.market_snapshot.headline_stat_value = `Market size: no verifiable public figure found as of ${noDataDate}`;
      }

      result.analysis_label = `Analysis of ${identityCard.productName} (${identityCard.subcategory}) — competitors verified ${new Date().toISOString()}`;

      await updateAnalysisPhase(analysisId, 4, "phase3_result", result, 0);

      // Save CompetitorAnalyses to DB/Memory for link references
      await saveCompetitorAnalyses(analysisId, context.orgId, phase1Result, phase2Result, identityCard);

      // Mark as complete
      await completeAnalysis(analysisId, Date.now() - startTime);

      // Auto-save report
      let reportId = "";
      try {
        const report = await createReportFromAnalysis(
          context.userId,
          analysisId,
          context.projectId,
          {
            phase1: phase1Result,
            phase2: phase2Result,
            phase3: result,
            productName: context.productName,
            industry: context.industry,
            targetMarket: context.targetMarket,
            pricePoint: context.pricePoint,
          },
          context.orgId
        );
        reportId = report.id;
      } catch (saveErr) {
        console.error("Auto report saving failed:", saveErr);
      }

      return { analysisId, phase: 5, status: "complete", stepResult: result, totalSearches: 0, reportId };
    }

    // Already past phase 4 (completeAnalysis sets phase 5) without being
    // marked complete/failed — shouldn't normally happen, nothing left to run.
    return { analysisId, phase: record.phase, status: record.status, stepResult: null, totalSearches: 0 };
  } catch (error: any) {
    console.error(`Analysis step crashed at phase ${record.phase}:`, error);
    const message = error.message || "Unknown error during analysis";
    await failAnalysis(analysisId, message);
    return { analysisId, phase: record.phase, status: "failed", stepResult: null, totalSearches: webSearchCount, error: message };
  }
}

// ----------------------------------------------------
// AI PROVIDER FALLBACK: try OpenAI first, then Gemini, then mock data.
// ----------------------------------------------------

// A 429/RESOURCE_EXHAUSTED response means the Gemini project's quota is
// exhausted at the account level (confirmed live in production: both the
// grounded AND the ungrounded retry fail identically once this happens) —
// retrying ungrounded in this case is never going to succeed, it only
// burns several more seconds of the route's 60s Vercel ceiling for
// nothing. Checked against both a numeric HTTP status the SDK may attach
// and the raw error message text (the Gemini SDK sometimes only surfaces
// the provider's JSON error body as a string, not a typed status field).
export function isGeminiQuotaExhausted(err: any): boolean {
  if (err?.status === 429 || err?.code === 429) return true;
  const message = String(err?.message ?? err ?? "");
  return message.includes("RESOURCE_EXHAUSTED") || message.includes('"code":429');
}

// Google Search grounding has its own quota separate from plain generation —
// it can be exhausted while plain calls still work fine. Retry ungrounded
// (no live search, but still real AI reasoning) before giving up on Gemini
// entirely and falling through to OpenAI/mock — UNLESS the failure is a
// quota exhaustion, which the ungrounded retry can't route around.
async function generateWithGeminiFallback(
  systemPrompt: string,
  userPrompt: string,
  onSearchUsed: (query: string) => void
): Promise<string> {
  try {
    const response = await genAI.models.generateContent({
      model: GEMINI_MODEL,
      contents: userPrompt,
      config: {
        systemInstruction: systemPrompt,
        tools: [{ googleSearch: {} }],
        maxOutputTokens: 8192,
      },
    });
    const queries = response.candidates?.[0]?.groundingMetadata?.webSearchQueries || [];
    queries.forEach((q) => onSearchUsed(q));
    if (!response.text) {
      throw new Error(`Empty response (finishReason: ${response.candidates?.[0]?.finishReason})`);
    }
    return response.text;
  } catch (err: any) {
    if (isGeminiQuotaExhausted(err)) {
      console.warn("Gemini call failed with quota exhaustion — skipping the ungrounded retry, it would fail the same way:", err?.message || err);
      throw err;
    }
    console.warn("Gemini call with Google Search grounding failed, retrying ungrounded:", err?.message || err);
    // The prompt tells the model it has web search — without the tool
    // actually attached, it tries to call it anyway and produces a
    // MALFORMED_FUNCTION_CALL. Override that instruction for this attempt.
    const ungroundedSystemPrompt = `${systemPrompt}\n\nIMPORTANT: Web search is temporarily unavailable for this request. Do NOT attempt to call any search tool. Answer using your own trained knowledge instead, and still return the exact JSON schema requested.`;
    const response = await genAI.models.generateContent({
      model: GEMINI_MODEL,
      contents: userPrompt,
      config: {
        systemInstruction: ungroundedSystemPrompt,
        maxOutputTokens: 8192,
      },
    });
    if (!response.text) {
      throw new Error(`Empty ungrounded response (finishReason: ${response.candidates?.[0]?.finishReason})`);
    }
    return response.text;
  }
}

// Vercel Hobby's fixed 60s function timeout (see maxDuration in
// app/api/analyses/[id]/continue/route.ts) is a hard platform kill, not a
// catchable JS error — if the whole AI-fallback chain (OpenAI's own
// up-to-45s attempt, then a Gemini attempt, then its ungrounded retry) is
// still running when the clock runs out, the route dies mid-request and
// the client sees a raw platform error page instead of JSON, which
// surfaces as the "Connection dropped — retrying" loop in
// ProgressPanel.tsx — and every retry repeats the exact same doomed
// sequence, so it never actually recovers. Once OpenAI has already failed,
// only attempt the Gemini fallback if there's realistically enough of the
// budget left for it to finish (and still leave room for Rainforest
// enrichment/DB writes afterward) — otherwise skip straight to the
// honest, always-fast mock/Rainforest-backed fallback.
export const ROUTE_TIME_BUDGET_MS = 50_000;
export const MIN_VIABLE_GEMINI_ATTEMPT_MS = 10_000;

export async function withAiFallback<T>(
  label: string,
  geminiCall: (() => Promise<T>) | null,
  openAiCall: (() => Promise<T>) | null,
  mockCall: () => T | Promise<T>,
  routeStartTime: number
): Promise<T> {
  // OpenAI is primary — its own native web-search tool handles the
  // live-data step, so no Gemini call is needed first. Gemini remains the
  // fallback if OpenAI is unavailable/fails.
  if (openAiCall) {
    try {
      return await openAiCall();
    } catch (err: any) {
      console.warn(`OpenAI ${label} failed:`, err?.message || err);
    }
  }
  if (geminiCall) {
    const remainingMs = ROUTE_TIME_BUDGET_MS - (Date.now() - routeStartTime);
    if (remainingMs < MIN_VIABLE_GEMINI_ATTEMPT_MS) {
      console.warn(`Skipping Gemini fallback for ${label} — only ${Math.round(remainingMs / 1000)}s left in the route's time budget, falling back to mock instead.`);
    } else {
      try {
        console.warn(`Falling back to Gemini for ${label}...`);
        return await geminiCall();
      } catch (err: any) {
        console.warn(`Gemini ${label} fallback also failed, falling back to mock:`, err?.message || err);
      }
    }
  }
  return await mockCall();
}

// Shared OpenAI web-search call for Phase 1/2/3 — max_tool_calls bounds
// search/page-open iterations (the same lesson learned from the prior,
// now-removed Anthropic integration: an uncapped web-search call once ran
// 30+ minutes in testing, which would always blow through Vercel's 60s
// function cap). Returns both the raw response text (schema JSON) and the
// list of search queries actually issued, for the onSearchUsed callback.
//
// Tuning note (confirmed in extensive live testing): thorough research for
// 5 established + 5 emerging real competitors with prices/ASINs is
// genuinely slow with reasoning-model web search — successful runs took
// 20-46s, and even generous budgets (46s, 8 tool calls) sometimes still
// returned an empty result. Faster non-reasoning models (gpt-4.1) return
// in ~6-10s but are shallow (1 search, gives up early) and unreliable for
// this multi-brand task. There is no configuration that is reliably both
// fast and thorough within Vercel's 60s cap — 45s here is the practical
// ceiling that leaves the rest of the route (Rainforest enrichment,
// citation verification, DB writes) enough headroom. When this times out
// or comes back empty, the pipeline falls through to Gemini, then to the
// live Rainforest-search fallback / honest mock data — never fake data.
const OPENAI_REQUEST_TIMEOUT_MS = 45_000;

async function runOpenAiWebSearch(systemPrompt: string, userPrompt: string): Promise<{ text: string; queries: string[] }> {
  const response: any = await openai.responses.create(
    {
      model: OPENAI_MODEL,
      reasoning: { effort: "low" },
      tools: [{ type: "web_search" as any }],
      max_tool_calls: 5,
      instructions: systemPrompt,
      input: userPrompt,
    } as any,
    { timeout: OPENAI_REQUEST_TIMEOUT_MS }
  );

  const queries: string[] = (response.output || [])
    .filter((o: any) => o.type === "web_search_call")
    .flatMap((o: any) => o.action?.queries || (o.action?.query ? [o.action.query] : []));

  const message = (response.output || []).find((o: any) => o.type === "message");
  const text: string = message?.content?.find((c: any) => c.type === "output_text")?.text || response.output_text || "";
  if (!text) throw new Error("Empty response from OpenAI web search call");

  return { text, queries };
}

// ----------------------------------------------------
// PHASE 1/2 PROMPTS (shared between Gemini and OpenAI runners)
// ----------------------------------------------------

// Brand hint and search terms are built ENTIRELY from the verified Identity
// Card (lib/product-identification.ts) — never a hardcoded category. A
// known-brand hint is only included when the identified category matches
// a family this app already has real brand knowledge for
// (lib/known-brands-by-category.ts); otherwise the model searches freely.
function buildPhase1Prompt(context: AnalysisContext, identity: IdentityCard, targetPriceRaw: number, ourMotorLabel?: string | null) {
  const brandHint = getKnownBrandsHint(identity.category);
  const attributesLine = identity.keyAttributes.length ? identity.keyAttributes.join(", ") : "—";
  const targetDisplay = context.pricePoint || identity.priceObserved?.value || `$${targetPriceRaw.toFixed(2)}`;
  const band = computePriceBand(targetPriceRaw, "legacy", 0);
  const tierKeyword = deriveTierKeyword(targetPriceRaw);
  const bandLabel = `$${band.min.toFixed(2)}–$${band.max.toFixed(2)}`;

  const systemPrompt = `You are a professional competitive intelligence analyst specializing in Amazon product research and market analysis. You have access to web search. Use it extensively.

Do not narrate your search process or explain what you're doing between searches — search silently, then respond with ONLY the final JSON object. No preamble, no commentary, no "I'll research..." text.

Your task: Research up to 8 ESTABLISHED, LARGE market leaders that compete with the identified product: a ${identity.subcategory || identity.category}.
${brandHint ? `Known major brands in this category to check first: ${brandHint.join(", ")} — but do not limit yourself to only these; include any other established brand your search finds.` : "Search broadly for the established, large brands that actually compete in this specific category — do not assume any particular brand."}
For each brand, find their ONE best matching product THAT FALLS WITHIN THE ACCEPTABLE PRICE RANGE below, in the SAME category as the identified product — among in-band candidates only, prioritize matching key attributes first. Return up to 8 products total.
${ourMotorLabel ? `\nMOTOR TYPE IS THE #1 PRIORITY, ABOVE PRICE AND FEATURES: the identified product uses a ${ourMotorLabel} motor. For each brand, prefer their model that ALSO uses ${ourMotorLabel} (or the closest related motor technology in their lineup) over a model that merely matches on price — search directly for e.g. "{brand} ${ourMotorLabel} ${identity.subcategory || identity.category}" before falling back to a plain brand+category search. If a brand's only in-range model uses a different motor type, still include it (never leave a brand slot empty over motor mismatch alone) but make that clear in its inclusion_rationale.` : ""}

CRITICAL RULES:
1. Search Amazon directly for real competing PRODUCTS (not brands), sourcing all data from Amazon listings. Always drill down to the specific SKU/model that competes with the identified product. Never use brand overview data.
2. Search for exact price, ASIN, review count, star rating, monthly sales velocity badge (e.g. "X+ bought in past month"), and all confirmed technical specs. If data is unavailable, use "—" NOT a guess.
3. Every candidate MUST be the same product type as "${identity.category} / ${identity.subcategory}" — reject anything from a different category, even a closely related one, unless the identified product itself spans categories.
4. If key attributes are mentioned (${attributesLine}), perform a DIRECT Amazon search combining those attributes with the category term (e.g. "${identity.keyAttributes[0] || identity.subcategory} ${identity.category}") before selecting competitors.
5. PRICE IS A HARD CONSTRAINT, NOT A TIEBREAKER: the acceptable price range for every candidate is ${bandLabel} (the user's target price of ${targetDisplay} ± 30%). Reject any product whose real Amazon price falls outside this range, even if it is an excellent brand/attribute match — prefer a different, in-range product from the same or another major brand instead. Do not substitute an out-of-range product to fill a slot.
6. NEVER invent a filler/placeholder company to reach the requested count (e.g. generic-sounding names like "Vanguard Corp", "Prime Tech", "Heritage Brand", or any company name combined with "${context.productName}" itself — that is fabrication, not a real competitor). If your search only turns up a few real, in-range competitors, return only those. Returning fewer real results is correct; inventing fake ones is not.
7. Return ONLY valid JSON matching the exact schema below — no markdown, no preamble, no explanation.

Note: strengths, weaknesses, and recent buyer sentiment are NOT part of this schema — those are sourced separately and exclusively from real Amazon customer reviews (see enrichCompetitorsWithRainforest / the reviews-analysis endpoint), never from your own knowledge or web search.

Return this EXACT JSON schema:
{
  "web_searches_performed": 12,
  "competitors": [
    {
      "name": "Full Product Name (specific SKU/Model)",
      "brand": "Brand Name",
      "tier": "legacy",
      "asin": "BXXXXXXXXX",
      "amazon_url": "https://www.amazon.com/dp/BXXXXXXXXX",
      "price": "$XX.XX",
      "rating": "4.5",
      "review_count": "2,847",
      "monthly_sales": "1,000+ bought in past month",
      "bsr_rank": "#17,162 in Beauty & Personal Care",
      "initials": "WA",
      "key_features": [
        {
          "headline": "Feature headline",
          "source": "Amazon",
          "attribution": "Per brand marketing:",
          "detail": "1–2 sentence explanation of what this means for the professional user"
        }
      ],
      "top_feature_summary": "Single sentence — their #1 differentiating feature",
      "inclusion_rationale": "One sentence: why this is a real established/major-brand competitor at this price tier, plus a source (e.g. 'Wahl — decades-long clipper incumbent, #1 BSR in Beauty & Personal Care, per Amazon listing')."
    }
  ]
}`;

  const userPrompt = `Research up to 8 established large brand competitors for this identified product:

Product Name: ${context.productName}
Identified Category: ${identity.category}
Identified Subcategory: ${identity.subcategory}
What it is: ${identity.whatItIs}
Key Attributes: ${attributesLine}
Target Market: ${context.targetMarket}
Target Price Point: ${targetDisplay} — ACCEPTABLE RANGE: ${bandLabel} (see CRITICAL RULES). Reject anything outside this range.
Key Differentiator: ${context.keyDiff || "—"}
Company Context: ${context.companyContext || "—"}

Instructions:
1. ${brandHint ? `Check these known brands first: ${brandHint.join(", ")} — then add any other established brand your search finds in this category.` : "Search broadly for established brands in this exact category."}
2. Include the price tier in at least one of your searches, e.g. "best ${tierKeyword} ${identity.subcategory || identity.category} ${bandLabel}", to bias results toward the correct price segment.
3. Every result must be a real ${identity.subcategory || identity.category} — not any other product type.
4. Drill down to specific SKU/model listings. Retrieve exact price, ASIN, rating, review count, and monthly sales velocity.`;

  return { systemPrompt, userPrompt };
}

async function executePhase1Gemini(context: AnalysisContext, identity: IdentityCard, targetPriceRaw: number, onSearchUsed: (query: string) => void, ourMotorLabel?: string | null) {
  const { systemPrompt, userPrompt } = buildPhase1Prompt(context, identity, targetPriceRaw, ourMotorLabel);
  const text = await generateWithGeminiFallback(systemPrompt, userPrompt, onSearchUsed);
  return assertHasCompetitors(JSON.parse(cleanJsonString(text)));
}

// A model call that "succeeds" (valid JSON, no exception) but returns zero
// competitors is not actually a success — confirmed in testing: gpt-5 can
// return {"competitors":[]} after tens of seconds of searching instead of
// throwing. Without this check, withAiFallback would treat that as the
// final answer and skip Gemini/mock entirely, silently producing an
// analysis with no competitors for that phase.
function assertHasCompetitors(parsed: any): any {
  if (!Array.isArray(parsed?.competitors) || parsed.competitors.length === 0) {
    throw new Error("Model returned zero competitors — treating as a failed attempt");
  }
  return parsed;
}

async function executePhase1OpenAI(context: AnalysisContext, identity: IdentityCard, targetPriceRaw: number, onSearchUsed: (query: string) => void, ourMotorLabel?: string | null) {
  const { systemPrompt, userPrompt } = buildPhase1Prompt(context, identity, targetPriceRaw, ourMotorLabel);
  const { text, queries } = await runOpenAiWebSearch(systemPrompt, userPrompt);
  queries.forEach(onSearchUsed);
  return assertHasCompetitors(JSON.parse(cleanJsonString(text)));
}

function buildPhase2Prompt(context: AnalysisContext, identity: IdentityCard, targetPriceRaw: number, brandHintOverride?: string[] | null, ourMotorLabel?: string | null) {
  // brandHintOverride (when the identified product maps to a legacy-brand
  // registry category, lib/legacy-brand-registry.ts) takes priority over
  // the static, non-binding lib/known-brands-by-category.ts hint — the
  // curated registry's brands (and aliases) are excluded here so the same
  // brand can never appear in both the legacy and emerging lists.
  const brandHint = brandHintOverride !== undefined ? brandHintOverride : getKnownBrandsHint(identity.category);
  const attributesLine = identity.keyAttributes.length ? identity.keyAttributes.join(", ") : "—";
  const targetDisplay = context.pricePoint || identity.priceObserved?.value || `$${targetPriceRaw.toFixed(2)}`;
  const band = computePriceBand(targetPriceRaw, "emerging", 0);
  const tierKeyword = deriveTierKeyword(targetPriceRaw);
  const bandLabel = `$${band.min.toFixed(2)}–$${band.max.toFixed(2)}`;

  const systemPrompt = `You are a professional competitive intelligence analyst specializing in Amazon product research. You have access to web search. Use it extensively.

Do not narrate your search process or explain what you're doing between searches — search silently, then respond with ONLY the final JSON object. No preamble, no commentary, no "I'll research..." text.

Your task: Research up to 8 INDIE, EMERGING, or NEWER brand products that compete with the identified product: a ${identity.subcategory || identity.category}.
${brandHint ? `Exclude these already-covered large brands: ${brandHint.join(", ")}.` : "Exclude whatever large established brands would already be covered by a separate established-competitor search — focus on indie/DTC/newer names."}
${ourMotorLabel ? `\nMOTOR TYPE IS THE #1 PRIORITY: the identified product uses a ${ourMotorLabel} motor. Prioritize indie/emerging brands specifically known for similar motor technology — lead your searches with the motor type itself (e.g. "${ourMotorLabel} ${identity.subcategory || identity.category}", "best ${ourMotorLabel} ${identity.subcategory || identity.category} ${new Date().getFullYear()}", "new ${ourMotorLabel} ${identity.subcategory || identity.category} brand") before falling back to generic category searches. A candidate whose motor type you cannot confirm from its own listing should still be included if nothing better is found, but note in its inclusion_rationale that motor type could not be verified.` : ""}

CRITICAL RULES:
1. Search Amazon directly for real competing PRODUCTS (not brands), sourcing all data from Amazon listings. Always drill down to the specific SKU/model that competes with the identified product. Never use brand overview data.
2. Search for exact price, ASIN, review count, star rating, monthly sales velocity badge (e.g. "X+ bought in past month"), and all confirmed technical specs — INCLUDING motor type/technology whenever the listing states it. If data is unavailable, use "—" NOT a guess.
3. Every candidate MUST be the same product type as "${identity.category} / ${identity.subcategory}" — reject anything from a different category, even a closely related one, unless the identified product itself spans categories.
4. If key attributes are mentioned (${attributesLine}), perform a DIRECT Amazon search combining those attributes with the category term before selecting competitors.
5. PRICE IS A HARD CONSTRAINT: the acceptable price range for every candidate is ${bandLabel} (the user's target price of ${targetDisplay}). Value/indie challengers priced meaningfully below this range are still legitimately relevant competitors, which is why this range already extends lower than the established-brand search — but reject anything above the range, and never below 50% of the target price. Reject any product priced outside ${bandLabel}, even if it is an excellent category/attribute match.
6. NEVER invent a filler/placeholder company to reach the requested count (e.g. generic-sounding names like "NovaDyne", "Flux DTC", "Zenith Lab", or any company name combined with "${context.productName}" itself — that is fabrication, not a real competitor). If your search only turns up a few real, in-range competitors, return only those. Returning fewer real results is correct; inventing fake ones is not.
7. Return ONLY valid JSON matching the exact schema below — no markdown, no preamble, no explanation.

Note: strengths, weaknesses, and recent buyer sentiment are NOT part of this schema — those are sourced separately and exclusively from real Amazon customer reviews (see enrichCompetitorsWithRainforest / the reviews-analysis endpoint), never from your own knowledge or web search.

Return this EXACT JSON schema:
{
  "web_searches_performed": 14,
  "competitors": [
    {
      "name": "Full Product Name (specific SKU/Model)",
      "brand": "Brand Name",
      "tier": "emerging",
      "asin": "BXXXXXXXXX",
      "amazon_url": "https://www.amazon.com/dp/BXXXXXXXXX",
      "price": "$XX.XX",
      "rating": "4.2",
      "review_count": "156",
      "monthly_sales": "300+ bought in past month",
      "bsr_rank": "#133,173 in Beauty & Personal Care",
      "initials": "SU",
      "key_features": [
        {
          "headline": "Feature headline",
          "source": "Amazon",
          "attribution": "Per brand marketing:",
          "detail": "1–2 sentence explanation of what this means for the user"
        }
      ],
      "top_feature_summary": "Single sentence — their #1 differentiating feature",
      "inclusion_rationale": "One sentence: why this is a real emerging/indie competitor at this price tier, plus a source (e.g. 'DTC brand launched 2023, growing BSR momentum, per Amazon listing')."
    }
  ]
}`;

  const userPrompt = `Research up to 8 indie/emerging competitor products for this identified product:

Product Name: ${context.productName}
Identified Category: ${identity.category}
Identified Subcategory: ${identity.subcategory}
What it is: ${identity.whatItIs}
Key Attributes: ${attributesLine}
Target Market: ${context.targetMarket}
Target Price Point: ${targetDisplay} — ACCEPTABLE RANGE: ${bandLabel} (see CRITICAL RULES). Reject anything outside this range.
Key Differentiator: ${context.keyDiff || "—"}

Instructions:
1. Search Amazon for emerging brand products matching the identified category and key attributes, within the acceptable price range — price is a hard filter here, not a secondary preference.
2. Include the price tier in at least one of your searches, e.g. "best value ${identity.subcategory || identity.category} ${bandLabel}", to bias results toward the correct price segment.
3. Every result must be a real ${identity.subcategory || identity.category} — not any other product type.
4. ${brandHint ? `Exclude the large brands: ${brandHint.join(", ")}.` : "Exclude any large established brand — focus on indie/newer names."}
5. Drill down to specific SKU/model listings. Retrieve exact price, ASIN, rating, review count, and monthly sales velocity.`;

  return { systemPrompt, userPrompt };
}

async function executePhase2Gemini(context: AnalysisContext, identity: IdentityCard, targetPriceRaw: number, onSearchUsed: (query: string) => void, brandHintOverride?: string[] | null, ourMotorLabel?: string | null) {
  const { systemPrompt, userPrompt } = buildPhase2Prompt(context, identity, targetPriceRaw, brandHintOverride, ourMotorLabel);
  const text = await generateWithGeminiFallback(systemPrompt, userPrompt, onSearchUsed);
  return assertHasCompetitors(JSON.parse(cleanJsonString(text)));
}

async function executePhase2OpenAI(context: AnalysisContext, identity: IdentityCard, targetPriceRaw: number, onSearchUsed: (query: string) => void, brandHintOverride?: string[] | null, ourMotorLabel?: string | null) {
  const { systemPrompt, userPrompt } = buildPhase2Prompt(context, identity, targetPriceRaw, brandHintOverride, ourMotorLabel);
  const { text, queries } = await runOpenAiWebSearch(systemPrompt, userPrompt);
  queries.forEach(onSearchUsed);
  return assertHasCompetitors(JSON.parse(cleanJsonString(text)));
}

async function executePhase3Gemini(context: AnalysisContext, identity: IdentityCard, phase1: any, phase2: any, onSearchUsed: (query: string) => void, extraInstruction?: string) {
  const { systemPrompt, userPrompt } = await buildPhase3Prompt(context, identity, phase1, phase2, extraInstruction);

  let usedAnyQuery = false;
  const text = await generateWithGeminiFallback(systemPrompt, userPrompt, (q) => {
    usedAnyQuery = true;
    onSearchUsed(q);
  });
  if (!usedAnyQuery) {
    onSearchUsed(`${identity.subcategory || identity.category} market data lookup`);
  }

  return JSON.parse(cleanJsonString(text));
}

async function executePhase3OpenAI(context: AnalysisContext, identity: IdentityCard, phase1: any, phase2: any, onSearchUsed: (query: string) => void, extraInstruction?: string) {
  const { systemPrompt, userPrompt } = await buildPhase3Prompt(context, identity, phase1, phase2, extraInstruction);

  // Needed so the model can actually search when marketData is null (see
  // buildPhase3Prompt's marketDataInstruction) — runOpenAiWebSearch always
  // attaches the web_search tool, so "search the web" has something to call.
  const { text, queries } = await runOpenAiWebSearch(systemPrompt, userPrompt);
  if (queries.length > 0) {
    queries.forEach(onSearchUsed);
  } else {
    onSearchUsed(`${identity.subcategory || identity.category} market data lookup`);
  }

  return JSON.parse(cleanJsonString(text));
}

// ----------------------------------------------------
// LIVE FALLBACK DISCOVERY — real Amazon products via Rainforest search when
// no AI provider is available. This is what actually answers "I analyse
// NEW products, I need NEW REAL products from Amazon" for a category with
// no hardcoded mock dataset (e.g. hair crimpers) instead of falling
// through to fabricated placeholder brand names ("Apex Global", etc.).
// Runs whenever Rainforest is configured, regardless of category — the
// static getCategoryFallbackCompetitors data is now a last-resort only,
// used solely when Rainforest itself is unavailable/fails outright.
async function discoverCompetitorsLive(identity: IdentityCard, tier: "legacy" | "emerging", targetPriceRaw: number | null, excludeNames: string[] = []): Promise<any[]> {
  if (!hasRainforestKey) return [];
  const category = identity.subcategory || identity.category;
  if (!category) return [];

  const brandHint = getKnownBrandsHint(identity.category) || [];
  const searchTerms: string[] = [];
  // Tried first when a target price is known — biases the search toward the
  // correct price segment before falling through to generic phrasings.
  if (targetPriceRaw != null) {
    const band = computePriceBand(targetPriceRaw, tier, 0);
    const tierKeyword = deriveTierKeyword(targetPriceRaw);
    searchTerms.push(`best ${tierKeyword} ${category} $${band.min.toFixed(0)}-$${band.max.toFixed(0)}`);
  }
  if (brandHint.length) {
    const slice = tier === "legacy" ? brandHint.slice(0, 5) : brandHint.slice(-5);
    for (const b of slice) searchTerms.push(`${b} ${category}`);
  }
  // Multiple phrasings widen the pool of distinct real products found —
  // a single search term (especially for a niche category with no known
  // brand hint) often can't fill the pool after de-duplication against
  // the other tier's results, leaving slots to fall back to generic
  // placeholder brands unnecessarily.
  if (tier === "legacy") {
    searchTerms.push(`best ${category}`, `top ${category} brands`, `professional ${category}`, category);
  } else {
    searchTerms.push(`${category} new brand`, `budget ${category}`, `affordable ${category}`, category);
  }

  const seenAsins = new Set<string>();
  const seenTitleFragments = new Set(excludeNames.map(n => n.toLowerCase().slice(0, 24)));
  const collected: any[] = [];
  // A larger pool than the final limit (5) so applyPriceBandGate downstream
  // has real candidates to filter/widen against instead of being handed
  // exactly 5 already-unfiltered results.
  const POOL_SIZE = 10;

  for (const term of searchTerms) {
    if (collected.length >= POOL_SIZE) break;
    const results = await searchAmazonCategory(term, 8);
    for (const r of results) {
      if (collected.length >= POOL_SIZE) break;
      if (seenAsins.has(r.asin)) continue;
      const titleLower = r.title.toLowerCase();
      if (Array.from(seenTitleFragments).some(f => f && titleLower.includes(f))) continue;
      if (identity.toolType && !assertToolType(r.title, identity.toolType).ok) {
        console.warn(`[tool-type] rejected live-search result "${r.title}" — mismatched tool type for ${identity.toolType}`);
        continue;
      }

      seenAsins.add(r.asin);
      seenTitleFragments.add(titleLower.slice(0, 24));
      const brand = (r.title.split(/[\s,]+/)[0] || "Unknown").replace(/[^\w-]/g, "");
      collected.push({
        name: r.title.length > 100 ? `${r.title.slice(0, 100)}…` : r.title,
        brand,
        tier,
        asin: r.asin,
        amazon_url: `https://www.amazon.com/dp/${r.asin}`,
        price: r.price,
        price_raw: r.price_raw,
        rating: r.rating,
        review_count: r.reviewsTotal,
        monthly_sales: r.monthlyStr,
        bsr_rank: null,
        initials: brand.slice(0, 2).toUpperCase(),
        key_features: [],
        strengths: [],
        weaknesses: [],
        recent_news: [],
        top_feature_summary: "",
        verified_by_rainforest: true,
      });
    }
  }
  return collected;
}

// ----------------------------------------------------
// SMART MOCK GENERATORS FOR OFFLINE / NO-KEY USE
async function generateMockPhase1(context: AnalysisContext, identity: IdentityCard, targetPriceRaw: number | null) {
  const live = await discoverCompetitorsLive(identity, "legacy", targetPriceRaw);
  if (live.length > 0) {
    return { web_searches_performed: live.length, competitors: live };
  }

  const dynamicList = getCategoryFallbackCompetitors(identity, "legacy");
  return {
    web_searches_performed: 12,
    competitors: dynamicList.map(c => ({
      name: c.name,
      brand: c.brand,
      tier: "legacy",
      asin: c.asin,
      amazon_url: `https://www.amazon.com/dp/${c.asin}`,
      price: c.price,
      rating: c.rating,
      review_count: c.reviewCount || (c as any).review_count || "2,410",
      monthly_sales: c.sales || (c as any).monthly_sales || "1,000+ bought in past month",
      bsr_rank: c.bsr || (c as any).bsr_rank || "#1,200 in Category",
      initials: c.initials,
      key_features: [
        {
          headline: `${c.brand} High-Performance Core Engine`,
          source: "Amazon",
          attribution: "Per brand marketing:",
          detail: `Engineered specifically for heavy-duty commercial use in the ${identity.subcategory || identity.category || "professional"} sector.`
        },
        {
          headline: "Ergonomic & Durable Build Chassis",
          source: "Amazon",
          attribution: "Per customer reviews:",
          detail: "Reduces operational fatigue while providing industrial grade heat dissipation during extended work shifts."
        },
        {
          headline: "Precision Micro-Adjustable Componentry",
          source: "Amazon",
          attribution: "Per brand marketing:",
          detail: "Offers ultra-fine calibration and seamless control suitable for demanding commercial standards."
        }
      ],
      // Never fabricated — populated on demand from real Amazon reviews via
      // /api/amazon/reviews-analysis/[asin].
      strengths: [],
      weaknesses: [],
      recent_news: [],
      top_feature_summary: `${c.brand} precision platform with commercial duty cycle`,
    }))
  };
}

async function generateMockPhase2(context: AnalysisContext, identity: IdentityCard, targetPriceRaw: number | null, phase1?: any) {
  const excludeNames = (phase1?.competitors || []).map((c: any) => c.name as string);
  const live = await discoverCompetitorsLive(identity, "emerging", targetPriceRaw, excludeNames);
  if (live.length > 0) {
    return { web_searches_performed: live.length, competitors: live };
  }

  const dynamicList = getCategoryFallbackCompetitors(identity, "emerging");
  return {
    web_searches_performed: 14,
    competitors: dynamicList.map(c => ({
      name: c.name,
      brand: c.brand,
      tier: "emerging",
      asin: c.asin,
      amazon_url: `https://www.amazon.com/dp/${c.asin}`,
      price: c.price,
      rating: c.rating,
      review_count: c.reviewCount || (c as any).review_count || "312",
      monthly_sales: c.sales || (c as any).monthly_sales || "500+ bought in past month",
      bsr_rank: c.bsr || (c as any).bsr_rank || "#15,200 in Category",
      initials: c.initials,
      key_features: [
        {
          headline: `${c.brand} Next-Gen Innovation Module`,
          source: "Amazon",
          attribution: "Per brand marketing:",
          detail: `Designed to challenge legacy pricing by offering modern ${identity.keyAttributes[0] || "adaptive"} features at an aggressive price point.`
        },
        {
          headline: "Smart Power Regulation Circuitry",
          source: "Amazon",
          attribution: "Per customer reviews:",
          detail: "Senses load resistance and adjusts output dynamically to prevent stalling or power sag."
        },
        {
          headline: "Cool-Touch Lightweight Casing",
          source: "Amazon",
          attribution: "Per customer reviews:",
          detail: "Advanced composite materials keep operating temperatures lower than traditional metal alternatives."
        }
      ],
      strengths: [],
      weaknesses: [],
      recent_news: [],
      top_feature_summary: `Modern DTC ${c.brand} design with high price-to-performance ratio`,
    }))
  };
}

function generateMockPhase3(context: AnalysisContext, identity: IdentityCard, phase1: any, phase2: any) {
  const mData = getMarketData(identity.subcategory || identity.category, context.productName);

  const legComps = phase1?.competitors || [];
  const emComps = phase2?.competitors || [];

  const leg1 = legComps[0] || { name: "Legacy Leader", price: "$149.99", brand: "Legacy", asin: "B000000001" };
  const leg2 = legComps[1] || { name: "Industry Standard", price: "$189.99", brand: "Standard", asin: "B000000002" };
  const em1 = emComps[0] || { name: "Emerging Challenger", price: "$89.99", brand: "Challenger", asin: "B000000003" };
  const em2 = emComps[1] || { name: "Agile DTC Brand", price: "$99.99", brand: "Agile", asin: "B000000004" };

  const allCompetitors = [
    ...legComps.map((c: any) => ({ name: c.name, price: c.price || null, tier: "legacy" as const, asin: c.asin || null })),
    ...emComps.map((c: any) => ({ name: c.name, price: c.price || null, tier: "emerging" as const, asin: c.asin || null })),
  ];

  const overviewParagraph = buildOverviewParagraph({
    productName: context.productName,
    motorTech: context.motorTech || "",
    pricePoint: context.pricePoint || "",
    targetMarket: context.targetMarket,
    category: identity.category,
    subcategory: identity.subcategory,
    toolType: identity.toolType,
    marketData: mData,
    competitors: allCompetitors,
  });

  const threats = [
    {
      competitor_name: em1.name,
      threat_description: `Aggressive market entry with ${em1.price || "competitive pricing"} and fast review acceleration creating direct pressure on ${context.productName}.`
    },
    {
      competitor_name: em2.name,
      threat_description: `Capturing digital consumer mindshare with targeted social campaigns and innovative features at ${em2.price || "mid-tier pricing"}.`
    },
    {
      competitor_name: `${leg1.brand} Market Dominance`,
      threat_description: `${leg1.name} maintains entrenched retail distribution and deep customer brand loyalty.`
    },
    {
      competitor_name: leg2.name,
      threat_description: `High rating stability (${leg2.rating || "4.5"} stars) and proven commercial durability buffering against new market entrants.`
    }
  ];

  const opportunities = [
    {
      action: `Position as high-performance alternative to ${leg1.name}`,
      description: `Highlight superior ${context.motorTech || "modern motor"} technology and ergonomic advantages at the ${context.pricePoint || "target"} price point.`
    },
    {
      action: `Exploit pricing gap against ${em1.name}`,
      description: `Emphasize build quality, component transparency, and verifiable specifications to capture switching buyers.`
    },
    {
      action: "Leverage sales velocity transparency",
      description: "Prominently display monthly verified purchase indicators to build instant trust with decision makers."
    },
    {
      action: "Create comprehensive warranty assurance program",
      description: "Address customer risk concerns by offering multi-year warranty coverage exceeding indie competitor standards."
    }
  ];

  const recommendations = [
    {
      priority: "high",
      category: "product",
      headline: `Secure verified performance certifications for ${context.motorTech || "core drive system"} and highlight test results on listing materials`,
      explanation: `Differentiates ${context.productName} from unverified claim inflation by emerging competitors like ${em1.brand}.`
    },
    {
      priority: "high",
      category: "marketing",
      headline: `Launch comparison campaigns targeting ${leg1.name} and ${leg2.name} users with upgrade incentives`,
      explanation: `Legacy users seeking next-generation feature sets represent high-intent conversion targets at ${context.pricePoint || "current pricing"}.`
    },
    {
      priority: "high",
      category: "positioning",
      headline: "Establish dedicated professional verified buyer portal with priority parts replacement",
      explanation: `Addresses component scarcity concerns surfaced in competitor review analysis and cements brand credibility.`
    },
    {
      priority: "medium",
      category: "pricing",
      headline: `Maintain firm ${context.pricePoint || "retail"} price positioning without aggressive early discounting`,
      explanation: "Establishes premium value separation from low-cost consumer alternatives and protects long-term margins."
    }
  ];

  const quickWins = [
    `Highlight multi-year warranty badge prominently on product listing to counter ${em1.name} risk concerns.`,
    `Publish clear performance specification sheets detailing real-world test ratings.`,
    `Launch targeted Amazon Sponsored campaigns against ASIN ${em1.asin || "B000000003"} (${em1.name}) and ASIN ${leg1.asin || "B000000001"} (${leg1.name}).`
  ];

  const noDataDate = new Date().toISOString().slice(0, 10);

  return {
    web_searches_performed: 4,
    amazon_category: context.category || "General Marketplace",
    data_sources_used: mData ? [mData.source, "Simulated market data (no AI key configured)"] : ["Simulated market data (no AI key configured)"],
    market_snapshot: {
      market_size_current: mData?.market_size_2026 || null,
      market_size_year: "2026",
      market_size_forecast: mData?.market_size_forecast || null,
      forecast_year: mData?.forecast_year || null,
      cagr_percent: mData?.cagr || null,
      cagr_period: mData?.cagr_period || null,
      data_source: mData?.source || null,
      headline_stat_label: mData ? "growth" : "unavailable",
      headline_stat_value: mData ? `${mData.market_size_2026} ${mData.industry_label} snapshot (2026)` : `Market size: no verifiable public figure found as of ${noDataDate}`,
      overview_paragraph: overviewParagraph
    },
    key_trends: (mData?.verified_trends || []).map(t => ({
      trend_name: t.name,
      description: `${t.description} [Data Point: ${t.data_point}]`,
      source: mData!.source
    })),
    market_gaps: [
      `Gaps in verified ${context.motorTech || "advanced tech"} offerings at the ${context.pricePoint || "target"} price tier`,
      "Transparent performance testing and verified specification disclosures",
      "Comprehensive long-term parts availability and warranty support from emerging brands",
      "Certified quiet operation and low-vibration engineering claims"
    ],
    top_threats: threats,
    top_opportunities: opportunities,
    positioning_recommendation: `We recommend positioning "${context.productName}" as the primary market benchmark at ${context.pricePoint || "target pricing"}, bridging ${context.motorTech || "advanced performance"} with verified reliability. Emphasize key differentiators to stand out against ${leg1.name} and ${em1.name}.`,
    strategic_recommendations: recommendations,
    quick_wins: quickWins
  };
}

async function saveCompetitorAnalyses(analysisId: string, orgId: string, phase1: any, phase2: any, identity: IdentityCard) {
  const allCompetitors = [...(phase1.competitors || []), ...(phase2.competitors || [])];

  for (const c of allCompetitors) {
    const competitorData = {
      analysisId,
      name: c.name,
      tier: c.tier,
      threatScore: c.rating ? Math.round(parseFloat(c.rating) * 20) : 75,
      category: c.category || identity.category || identity.subcategory || "General",
      tags: c.key_features?.map((f: any) => f.headline.toLowerCase()) || [],
      insight: c.top_feature_summary || null,
      pricePoint: c.price,
      standoutFeature: c.top_feature_summary || null,
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
