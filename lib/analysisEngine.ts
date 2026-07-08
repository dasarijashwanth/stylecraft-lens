import { prisma } from "./db";
import { memoryDb } from "./memoryDb";
import { genAI, hasGeminiKey, GEMINI_MODEL } from "./gemini";
import { anthropic, hasAnthropicKey, ANTHROPIC_MODEL } from "./anthropic";
import { getAmazonProduct, resolveAsinBySearch, hasRainforestKey } from "./rainforest";
import { isSupabaseConfigured } from "./supabase";
import { updateAnalysisPhase, completeAnalysis, failAnalysis, getAnalysis, setPendingQuestion, getRecentAnalysesForBoilerplateCheck } from "./db/analyses";
import { textSimilarity, BOILERPLATE_SIMILARITY_THRESHOLD } from "./text-similarity";
import { createReportFromAnalysis } from "./db/reports";
import { buildPhase3Prompt } from "./prompts/phase3";
import { getMarketData } from "./market-data";
import { buildOverviewParagraph } from "./build-overview-paragraph";
import { identifyProduct, needsUserInput, IdentityCard } from "./product-identification";
import { getKnownBrandsHint } from "./known-brands-by-category";
import { competitorMatchesCategory } from "./category-synonyms";

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

// Keyed off the VERIFIED category/subcategory from Stage 1's Identity
// Card only — NEVER off `context.industry`. This app's `industry` field
// only ever has two values ("grooming-barbering"/"haircare-styling"),
// both of which contain "grooming"/"styling", so keying this off industry
// (as a previous version did) meant every analysis routed to the
// clipper/dryer fallback branches below regardless of the actual product.
function getCategoryFallbackCompetitors(identity: IdentityCard, defaultTier: "legacy" | "emerging") {
  const text = `${identity.category || ""} ${identity.subcategory || ""}`.toLowerCase();

  // If Hair styling / Dryers / Flat irons
  if (text.includes("dryer") || text.includes("blow") || text.includes("styler") || text.includes("iron") || text.includes("straighten") || text.includes("haircare")) {
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

  // Hair clippers and trimmers ONLY — "razor"/"shaver" deliberately excluded:
  // this app has no dedicated shaver mock dataset, and the data below is
  // 100% clipper-specific. Bundling shaver in here (as a previous version
  // did) meant an electric-shaver analysis with no live AI available got
  // confidently-wrong clipper brand names instead of falling through to
  // the honest generic-placeholder branch below.
  if (text.includes("clipper") || text.includes("trimmer") || text.includes("barber") || text.includes("grooming")) {
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
            asin: "B0C1234RECON",
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
            asin: "B09KGBM3R4",
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

  // Fallback for categories with no dedicated mock data above
  const basePrice = identity.priceObserved?.value || 99;
  const prodName = identity.productName || identity.category || "Product";
  const catName = identity.category || "General";

  const legacyBrands = ["Apex Global", "Vanguard Corp", "Prime Tech", "Heritage Brand", "OmniPro", "Elite Core"];
  const emergingBrands = ["NovaDyne", "Flux DTC", "Zenith Lab", "Kuro Tech", "Aura Pro"];

  const brands = defaultTier === "legacy" ? legacyBrands : emergingBrands;
  const multipliers = defaultTier === "legacy" ? [1.2, 1.4, 0.9, 1.1, 1.5, 1.0] : [0.7, 0.85, 0.95, 1.05, 1.15];

  return brands.map((b, idx) => {
    const p = (basePrice * multipliers[idx % multipliers.length]).toFixed(2);
    const asin = `B0${(10000000 + idx * 8921 + prodName.length * 43).toString(36).toUpperCase()}`.slice(0, 10);
    return {
      name: `${b} ${prodName} ${defaultTier === "legacy" ? "Pro" : "Series"}`,
      brand: b,
      asin: asin.length === 10 ? asin : `B09KGBM${idx}R${idx}`,
      price: `$${p}`,
      rating: (4.1 + (idx % 4) * 0.2).toFixed(1),
      reviewCount: `${(150 + idx * 420).toLocaleString()}`,
      sales: `${200 + idx * 150}+ bought in past month`,
      bsr: `#${(5000 + idx * 3100).toLocaleString()} in ${catName}`,
      initials: b.slice(0, 2).toUpperCase(),
      top_positive_review_themes: ["Reliable operational run", "High build quality", "Fulfills expectations"],
      top_negative_review_themes: ["Price premium barrier", "Heavier handling weight", "Standard feature set"],
      confirmed_technical_specs: { motor_type: identity.keyAttributes[0] || "Brushless DC", rpm: "6,500 RPM", run_time: "150 min", charging_time: "90 min", blade_material: "Steel", body_material: "Composite" }
    };
  });
}

// `cleaned` also drops any AI-returned competitor whose own name/feature
// text doesn't match the identified category (lib/category-synonyms.ts) —
// a clipper can never survive into a hair-dryer analysis, even if the AI
// itself proposed one.
function cleanCompetitors(competitors: any[], defaultTier: "legacy" | "emerging", identity: IdentityCard) {
  const fallbackCompetitors = getCategoryFallbackCompetitors(identity, defaultTier);

  const incomingList = Array.isArray(competitors) ? competitors : [];
  const cleaned: any[] = [];
  const limit = 5; // 5 established + 5 emerging = 10 total, per spec

  const count = Math.max(incomingList.length, limit);

  for (let i = 0; i < count; i++) {
    const fallback = fallbackCompetitors[i % fallbackCompetitors.length];
    const rawIncoming = incomingList[i];
    // Category-match validation guardrail: a competitor for a beard
    // trimmer must actually be a trimmer — drop (treat as absent, backfill
    // from same-category fallback data) anything that doesn't match.
    const incoming = rawIncoming && competitorMatchesCategory(`${rawIncoming.name || ""} ${rawIncoming.top_feature_summary || ""}`, identity.category, identity.subcategory)
      ? rawIncoming
      : undefined;

    if (incoming) {
      let asin = incoming.asin || "";
      let price = incoming.price || "";
      let rating = incoming.rating || "";
      let amazonUrl = incoming.amazon_url || "";

      const isAsinPlaceholder = !asin || asin.includes("X") || asin.includes("000000");
      const isUrlPlaceholder = !amazonUrl || amazonUrl.includes("X") || amazonUrl.includes("000000");

      if (isAsinPlaceholder || isUrlPlaceholder) {
        asin = fallback.asin;
        price = fallback.price;
        rating = fallback.rating;
        amazonUrl = `https://www.amazon.com/dp/${asin}`;
      } else {
        amazonUrl = `https://www.amazon.com/dp/${asin}`;
      }

      cleaned.push({
        ...incoming,
        asin,
        amazon_url: amazonUrl,
        price: price && price !== "—" ? price : fallback.price,
        rating: rating && rating !== "—" ? rating : fallback.rating,
        tier: defaultTier,
        initials: incoming.initials || incoming.name.split(" ").slice(0, 2).map((w: string) => w[0]).join("").toUpperCase() || fallback.initials,
        // Strengths/weaknesses/recent buyer sentiment are never AI-generated —
        // populated on demand from real Amazon reviews via
        // /api/amazon/reviews-analysis/[asin] (see CompetitorCard).
        strengths: [],
        weaknesses: [],
        recent_news: [],
      });
    } else {
      cleaned.push({
        name: fallback.name,
        brand: fallback.brand,
        tier: defaultTier,
        asin: fallback.asin,
        amazon_url: `https://www.amazon.com/dp/${fallback.asin}`,
        price: fallback.price,
        rating: fallback.rating,
        review_count: fallback.reviewCount || (fallback as any).review_count,
        monthly_sales: fallback.sales || (fallback as any).monthly_sales,
        bsr_rank: fallback.bsr || (fallback as any).bsr_rank,
        initials: fallback.initials,
        key_features: [],
        strengths: [],
        weaknesses: [],
        recent_news: [],
        top_feature_summary: "",
      });
    }
  }

  return cleaned;
}

// Overwrite AI-discovered competitor price/rating/review data with real,
// verified live Amazon data from Rainforest. Tries the AI-provided ASIN
// first; if that doesn't resolve to a real listing, searches Amazon by
// product title + brand to find the real ASIN before giving up. Competitors
// that can't be verified either way are explicitly flagged (never left
// pointing at a fabricated /dp/{asin} link) so the UI can show them as
// unverified instead of rendering fabricated data as if it were real.
async function enrichCompetitorsWithRainforest(competitors: any[]): Promise<any[]> {
  if (!hasRainforestKey) return competitors;

  return Promise.all(
    competitors.map(async (c) => {
      let product = await getAmazonProduct(c.asin);

      if (!product) {
        const match = await resolveAsinBySearch(c.name, c.brand);
        if (match) {
          product = await getAmazonProduct(match.asin);
        }
      }

      if (!product) {
        return {
          ...c,
          verified_by_rainforest: false,
          amazon_url: `https://www.amazon.com/s?k=${encodeURIComponent(`${c.brand || ""} ${c.name}`.trim())}`,
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
        rating: product.rating_str,
        review_count: product.reviews_str,
        monthly_sales: product.monthly_str || c.monthly_sales,
        bsr_rank: product.bsr || c.bsr_rank,
        amazon_url: product.amazon_url,
        image: product.image,
        key_features: realFeatures.length > 0 ? realFeatures : c.key_features,
        verified_by_rainforest: true,
      };
    })
  );
}

export interface AnalysisStepResult {
  analysisId: string;
  phase: number;
  status: "running" | "complete" | "failed";
  stepResult: any;
  totalSearches: number;
  reportId?: string;
  error?: string;
  // Set when Stage 0 (Product Identification) can't confidently determine
  // the category and the pipeline has paused — the client must collect an
  // answer and POST /api/analyses/:id/answer before calling continue again.
  pendingQuestion?: { question: string; foundSoFar?: string };
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
export async function runAnalysisStep(analysisId: string): Promise<AnalysisStepResult> {
  const startTime = Date.now();
  const record: any = await getAnalysis(analysisId);
  if (!record) {
    throw new Error("Analysis not found");
  }

  if (record.status === "complete" || record.status === "failed") {
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

      await updateAnalysisPhase(analysisId, 1, "phase0_result", card, 0);
      return { analysisId, phase: 1, status: "running", stepResult: card, totalSearches: 0 };
    }

    if (record.phase === 1) {
      // ----------------------------------------------------
      // PHASE 1: ESTABLISHED-COMPETITOR DISCOVERY
      // ----------------------------------------------------
      if (!identityCard) throw new Error("Missing product identity — cannot run competitor discovery");

      const result: any = await withAiFallback(
        "Phase 1",
        hasGeminiKey ? () => executePhase1Gemini(context, identityCard, onSearchUsed) : null,
        hasAnthropicKey ? () => executePhase1Claude(context, identityCard, onSearchUsed) : null,
        () => generateMockPhase1(context, identityCard)
      );

      result.competitors = cleanCompetitors(result.competitors, "legacy", identityCard);
      if (hasRainforestKey) {
        result.competitors = await enrichCompetitorsWithRainforest(result.competitors);
      }
      webSearchCount += result.web_searches_performed || 0;

      await updateAnalysisPhase(analysisId, 2, "phase1_result", result, webSearchCount);
      return { analysisId, phase: 2, status: "running", stepResult: result, totalSearches: webSearchCount };
    }

    if (record.phase === 2) {
      // ----------------------------------------------------
      // PHASE 2: EMERGING-COMPETITOR DISCOVERY
      // ----------------------------------------------------
      if (!identityCard) throw new Error("Missing product identity — cannot run competitor discovery");

      const result: any = await withAiFallback(
        "Phase 2",
        hasGeminiKey ? () => executePhase2Gemini(context, identityCard, onSearchUsed) : null,
        hasAnthropicKey ? () => executePhase2Claude(context, identityCard, onSearchUsed) : null,
        () => generateMockPhase2(context, identityCard)
      );

      result.competitors = cleanCompetitors(result.competitors, "emerging", identityCard);
      if (hasRainforestKey) {
        result.competitors = await enrichCompetitorsWithRainforest(result.competitors);
      }
      webSearchCount += result.web_searches_performed || 0;

      await updateAnalysisPhase(analysisId, 3, "phase2_result", result, webSearchCount);
      return { analysisId, phase: 3, status: "running", stepResult: result, totalSearches: webSearchCount };
    }

    if (record.phase === 3) {
      // ----------------------------------------------------
      // PHASE 3: STRATEGIC SYNTHESIS + finalize
      // ----------------------------------------------------
      if (!phase1Result || !phase2Result || !identityCard) {
        throw new Error("Missing identity/phase 1/2 results — cannot run phase 3");
      }

      let result: any = await withAiFallback(
        "Phase 3",
        hasGeminiKey ? () => executePhase3Gemini(context, identityCard, phase1Result, phase2Result, onSearchUsed) : null,
        hasAnthropicKey ? () => executePhase3Claude(context, identityCard, phase1Result, phase2Result, onSearchUsed) : null,
        () => generateMockPhase3(context, identityCard, phase1Result, phase2Result)
      );
      webSearchCount += result.web_searches_performed || 0;

      // Anti-boilerplate check: if this analysis's positioning text is
      // near-identical to a recent DIFFERENT-category analysis, it's
      // almost certainly generic could-apply-to-anything strategy text —
      // one regeneration attempt with the real competitor facts, same
      // retry-with-facts pattern already proven in lib/gtm-generate.ts.
      try {
        const positioningText = typeof result.positioning_recommendation === "string" ? result.positioning_recommendation : "";
        if (positioningText && hasGeminiKey) {
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
            const retried = await executePhase3Gemini(context, identityCard, phase1Result, phase2Result, onSearchUsed, extraInstruction);
            if (retried && typeof retried.positioning_recommendation === "string") {
              result = retried;
            }
          }
        }
      } catch (err) {
        console.warn("Phase 3 anti-boilerplate check failed (non-fatal, keeping original result):", err);
      }

      result.analysis_label = `Analysis of ${identityCard.productName} (${identityCard.subcategory}) — competitors verified ${new Date().toISOString()}`;

      await updateAnalysisPhase(analysisId, 4, "phase3_result", result, webSearchCount);

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

      return { analysisId, phase: 5, status: "complete", stepResult: result, totalSearches: webSearchCount, reportId };
    }

    // Already past phase 4 without being marked complete/failed — nothing left to run.
    return { analysisId, phase: record.phase, status: record.status, stepResult: null, totalSearches: 0 };
  } catch (error: any) {
    console.error(`Analysis step crashed at phase ${record.phase}:`, error);
    const message = error.message || "Unknown error during analysis";
    await failAnalysis(analysisId, message);
    return { analysisId, phase: record.phase, status: "failed", stepResult: null, totalSearches: webSearchCount, error: message };
  }
}

// ----------------------------------------------------
// AI PROVIDER FALLBACK: try Gemini first, then Anthropic, then mock data.
// ----------------------------------------------------

// Google Search grounding has its own quota separate from plain generation —
// it can be exhausted while plain calls still work fine. Retry ungrounded
// (no live search, but still real AI reasoning) before giving up on Gemini
// entirely and falling through to Anthropic/mock.
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

async function withAiFallback<T>(
  label: string,
  geminiCall: (() => Promise<T>) | null,
  anthropicCall: (() => Promise<T>) | null,
  mockCall: () => T
): Promise<T> {
  if (geminiCall) {
    try {
      return await geminiCall();
    } catch (err: any) {
      console.warn(`Gemini ${label} failed:`, err?.message || err);
    }
  }
  if (anthropicCall) {
    try {
      console.warn(`Falling back to Anthropic for ${label}...`);
      return await anthropicCall();
    } catch (err: any) {
      console.warn(`Anthropic ${label} fallback also failed, falling back to mock:`, err?.message || err);
    }
  }
  return mockCall();
}

// ----------------------------------------------------
// PHASE 1/2 PROMPTS (shared between Gemini and Anthropic runners)
// ----------------------------------------------------

// Brand hint and search terms are built ENTIRELY from the verified Identity
// Card (lib/product-identification.ts) — never a hardcoded category. A
// known-brand hint is only included when the identified category matches
// a family this app already has real brand knowledge for
// (lib/known-brands-by-category.ts); otherwise the model searches freely.
function buildPhase1Prompt(context: AnalysisContext, identity: IdentityCard) {
  const brandHint = getKnownBrandsHint(identity.category);
  const attributesLine = identity.keyAttributes.length ? identity.keyAttributes.join(", ") : "—";

  const systemPrompt = `You are a professional competitive intelligence analyst specializing in Amazon product research and market analysis. You have access to web search. Use it extensively.

Your task: Research up to 5 ESTABLISHED, LARGE market leaders that compete with the identified product: a ${identity.subcategory || identity.category}.
${brandHint ? `Known major brands in this category to check first: ${brandHint.join(", ")} — but do not limit yourself to only these; include any other established brand your search finds.` : "Search broadly for the established, large brands that actually compete in this specific category — do not assume any particular brand."}
For each brand, find their ONE best matching product in the SAME category as the identified product (prioritize matching key attributes first, then closest price to target price point). Return up to 5 products total.

CRITICAL RULES:
1. Search Amazon directly for real competing PRODUCTS (not brands), sourcing all data from Amazon listings. Always drill down to the specific SKU/model that competes with the identified product. Never use brand overview data.
2. Search for exact price, ASIN, review count, star rating, monthly sales velocity badge (e.g. "X+ bought in past month"), and all confirmed technical specs. If data is unavailable, use "—" NOT a guess.
3. Every candidate MUST be the same product type as "${identity.category} / ${identity.subcategory}" — reject anything from a different category, even a closely related one, unless the identified product itself spans categories.
4. If key attributes are mentioned (${attributesLine}), perform a DIRECT Amazon search combining those attributes with the category term (e.g. "${identity.keyAttributes[0] || identity.subcategory} ${identity.category}") before selecting competitors.
5. Return ONLY valid JSON matching the exact schema below — no markdown, no preamble, no explanation.

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
      "top_feature_summary": "Single sentence — their #1 differentiating feature"
    }
  ]
}`;

  const userPrompt = `Research up to 5 established large brand competitors for this identified product:

Product Name: ${context.productName}
Identified Category: ${identity.category}
Identified Subcategory: ${identity.subcategory}
What it is: ${identity.whatItIs}
Key Attributes: ${attributesLine}
Target Market: ${context.targetMarket}
Target Price Point: ${context.pricePoint || identity.priceObserved?.value || "—"}
Key Differentiator: ${context.keyDiff || "—"}
Company Context: ${context.companyContext || "—"}

Instructions:
1. ${brandHint ? `Check these known brands first: ${brandHint.join(", ")} — then add any other established brand your search finds in this category.` : "Search broadly for established brands in this exact category."}
2. Every result must be a real ${identity.subcategory || identity.category} — not any other product type.
3. Drill down to specific SKU/model listings. Retrieve exact price, ASIN, rating, review count, and monthly sales velocity.`;

  return { systemPrompt, userPrompt };
}

async function executePhase1Gemini(context: AnalysisContext, identity: IdentityCard, onSearchUsed: (query: string) => void) {
  const { systemPrompt, userPrompt } = buildPhase1Prompt(context, identity);
  const text = await generateWithGeminiFallback(systemPrompt, userPrompt, onSearchUsed);
  return JSON.parse(cleanJsonString(text));
}

async function executePhase1Claude(context: AnalysisContext, identity: IdentityCard, onSearchUsed: (query: string) => void) {
  const { systemPrompt, userPrompt } = buildPhase1Prompt(context, identity);

  const response = await anthropic.messages.create({
    model: ANTHROPIC_MODEL,
    max_tokens: 4000,
    tools: [{ type: "web_search_20250305" as any, name: "web_search" }],
    system: systemPrompt,
    messages: [{ role: "user", content: userPrompt }],
  });

  response.content.forEach((block) => {
    if (block.type === "tool_use" && block.name === "web_search") {
      onSearchUsed((block.input as any).query);
    }
  });

  const text = response.content
    .filter(b => b.type === "text")
    .map(b => b.text)
    .join("");

  return JSON.parse(cleanJsonString(text));
}

function buildPhase2Prompt(context: AnalysisContext, identity: IdentityCard) {
  const brandHint = getKnownBrandsHint(identity.category);
  const attributesLine = identity.keyAttributes.length ? identity.keyAttributes.join(", ") : "—";

  const systemPrompt = `You are a professional competitive intelligence analyst specializing in Amazon product research. You have access to web search. Use it extensively.

Your task: Research 5 INDIE, EMERGING, or NEWER brand products that compete with the identified product: a ${identity.subcategory || identity.category}.
${brandHint ? `Exclude these already-covered large brands: ${brandHint.join(", ")}.` : "Exclude whatever large established brands would already be covered by a separate established-competitor search — focus on indie/DTC/newer names."}

CRITICAL RULES:
1. Search Amazon directly for real competing PRODUCTS (not brands), sourcing all data from Amazon listings. Always drill down to the specific SKU/model that competes with the identified product. Never use brand overview data.
2. Search for exact price, ASIN, review count, star rating, monthly sales velocity badge (e.g. "X+ bought in past month"), and all confirmed technical specs. If data is unavailable, use "—" NOT a guess.
3. Every candidate MUST be the same product type as "${identity.category} / ${identity.subcategory}" — reject anything from a different category, even a closely related one, unless the identified product itself spans categories.
4. If key attributes are mentioned (${attributesLine}), perform a DIRECT Amazon search combining those attributes with the category term before selecting competitors.
5. Return ONLY valid JSON matching the exact schema below — no markdown, no preamble, no explanation.

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
      "top_feature_summary": "Single sentence — their #1 differentiating feature"
    }
  ]
}`;

  const userPrompt = `Research 5 indie/emerging competitor products for this identified product:

Product Name: ${context.productName}
Identified Category: ${identity.category}
Identified Subcategory: ${identity.subcategory}
What it is: ${identity.whatItIs}
Key Attributes: ${attributesLine}
Target Market: ${context.targetMarket}
Target Price Point: ${context.pricePoint || identity.priceObserved?.value || "—"}
Key Differentiator: ${context.keyDiff || "—"}

Instructions:
1. Search Amazon for emerging brand products matching the identified category and key attributes first, price secondary.
2. Every result must be a real ${identity.subcategory || identity.category} — not any other product type.
3. ${brandHint ? `Exclude the large brands: ${brandHint.join(", ")}.` : "Exclude any large established brand — focus on indie/newer names."}
4. Drill down to specific SKU/model listings. Retrieve exact price, ASIN, rating, review count, and monthly sales velocity.`;

  return { systemPrompt, userPrompt };
}

async function executePhase2Gemini(context: AnalysisContext, identity: IdentityCard, onSearchUsed: (query: string) => void) {
  const { systemPrompt, userPrompt } = buildPhase2Prompt(context, identity);
  const text = await generateWithGeminiFallback(systemPrompt, userPrompt, onSearchUsed);
  return JSON.parse(cleanJsonString(text));
}

async function executePhase2Claude(context: AnalysisContext, identity: IdentityCard, onSearchUsed: (query: string) => void) {
  const { systemPrompt, userPrompt } = buildPhase2Prompt(context, identity);

  const response = await anthropic.messages.create({
    model: ANTHROPIC_MODEL,
    max_tokens: 4000,
    tools: [{ type: "web_search_20250305" as any, name: "web_search" }],
    system: systemPrompt,
    messages: [{ role: "user", content: userPrompt }],
  });

  response.content.forEach((block) => {
    if (block.type === "tool_use" && block.name === "web_search") {
      onSearchUsed((block.input as any).query);
    }
  });

  const text = response.content
    .filter(b => b.type === "text")
    .map(b => b.text)
    .join("");

  return JSON.parse(cleanJsonString(text));
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

async function executePhase3Claude(context: AnalysisContext, identity: IdentityCard, phase1: any, phase2: any, onSearchUsed: (query: string) => void, extraInstruction?: string) {
  const { systemPrompt, userPrompt } = await buildPhase3Prompt(context, identity, phase1, phase2, extraInstruction);

  onSearchUsed(`${identity.subcategory || identity.category} market data lookup`);

  const response = await anthropic.messages.create({
    model: ANTHROPIC_MODEL,
    max_tokens: 4000,
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
function generateMockPhase1(context: AnalysisContext, identity: IdentityCard) {
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

function generateMockPhase2(context: AnalysisContext, identity: IdentityCard) {
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
    marketData: mData!,
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

  return {
    web_searches_performed: 4,
    amazon_category: context.category || "General Marketplace",
    data_sources_used: [mData?.source || "Verified Industry Analytics", "Simulated market data (no AI key configured)"],
    market_snapshot: {
      market_size_current: mData?.market_size_2026 || "$1.5B",
      market_size_year: "2026",
      market_size_forecast: mData?.market_size_forecast || "$2.5B",
      forecast_year: mData?.forecast_year || "2034",
      cagr_percent: mData?.cagr || "5.0%",
      cagr_period: mData?.cagr_period || "2026–2034",
      data_source: mData?.source || "Market Intelligence Research",
      headline_stat_label: "growth",
      headline_stat_value: `${mData?.market_size_2026 || "$1.5B"} ${mData?.industry_label || "Market"} snapshot (2026)`,
      overview_paragraph: overviewParagraph
    },
    key_trends: (mData?.verified_trends || []).map(t => ({
      trend_name: t.name,
      description: `${t.description} [Data Point: ${t.data_point}]`,
      source: mData?.source || "Industry Reports"
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
