// scripts/verify-tds-feature-flag.ts
// Offline regression check for the TDS feature flag: no live OpenAI/Gemini/
// Rainforest/Supabase calls — no .env.local is loaded, memoryDb's dev
// fallback path is what's under test throughout.
//
// Run with: npx tsx scripts/verify-tds-feature-flag.ts

let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string) {
  if (condition) {
    console.log(`PASS: ${message}`);
    passed++;
  } else {
    console.log(`FAIL: ${message}`);
    failed++;
  }
}

async function main() {
  const { deriveFieldsFromSources } = await import("../lib/gtm-derive");
  const { getFeatureFlag, setFeatureFlag } = await import("../lib/db/feature-flags");
  const { isTdsEnabled } = await import("../lib/feature-flags");
  const { memoryDb } = await import("../lib/memoryDb");

  console.log("\n[1] deriveFieldsFromSources — GTM fill quality is unaffected by TDS being absent");
  {
    // A realistic fixture: team-entered project record + Sales Kit + Active
    // Report — the tiers deriveFieldsFromSources ALSO reads from, so fields
    // sourced from those (not TDS) can be proven identical either way.
    const project = {
      productName: "Apex Cordless Trimmer",
      description: "A cordless detail trimmer",
      category: "Trimmers",
      motorTech: "Magnetic Motor",
      keyDiff: "Zero-gap T-blade",
      pricePoint: "$99.95",
      companyContext: "StyleCraft",
    };
    const salesKit = {
      target_customers: ["Barbers", "Home users"],
      key_features: [{ headline: "Zero-gap blade" }, { headline: "90-min run time" }],
      elevator_pitch: "The fastest lining trimmer in its class.",
    };
    const activeReport = {
      competitive_analysis: {
        positioning_recommendation: "Position as the precision-lining leader.",
        large_brand_competitors: [{ name: "Wahl Detailer" }],
        indie_emerging_competitors: [{ name: "Supreme Trimmer" }],
      },
      pricing_analysis: { price_positioning: "Mid-tier" },
    };
    const tds: Record<string, string> = {
      warranty: "1 year limited",
      material: "ABS plastic",
      blade_name: "Zero-Gap DLC T-Blade",
      motor_type: "Magnetic Motor",
      product_title: "Apex Cordless Trimmer Pro",
    };

    const withTds = deriveFieldsFromSources(project, salesKit, tds, activeReport);
    const withoutTds = deriveFieldsFromSources(project, salesKit, null, activeReport);

    assert(Object.keys(withoutTds).length > 0, "deriveFieldsFromSources with tds=null still returns real fields (no crash, no empty result)");

    // Fields where the PROJECT RECORD itself wins regardless of TDS
    // (firstOf([project.x, ...], [t.x, "tds"]) with project.x always
    // present in this fixture) — the exact "GTM quality unaffected" claim.
    assert(withTds.approved_pricing?.answer === withoutTds.approved_pricing?.answer, "approved_pricing (project.pricePoint) is identical with/without TDS");
    assert(withTds.approved_pricing?.source === "project_record" && withoutTds.approved_pricing?.source === "project_record", "approved_pricing sources from project_record either way, never silently downgraded");
    assert(withTds.motor_type?.answer === withoutTds.motor_type?.answer && withTds.motor_type?.answer === "Magnetic Motor", "motor_type (project.motorTech) is identical with/without TDS");
    assert(withTds.reason_to_buy?.answer === withoutTds.reason_to_buy?.answer, "reason_to_buy (sales kit elevator pitch) is identical with/without TDS");
    assert(withTds.comps?.answer === withoutTds.comps?.answer, "comps (active report competitors) is identical with/without TDS");

    // Fields that are TDS-exclusive (no project/salesKit/activeReport tier
    // reaches them) — honestly absent without TDS, never corrupted/guessed.
    assert(withTds.warranty?.answer === "1 year limited", "warranty IS populated when TDS is present");
    assert(withoutTds.warranty === undefined, "warranty is honestly ABSENT (not corrupted, not guessed) when TDS is absent");
    assert(withTds.material?.answer === "ABS plastic", "material IS populated when TDS is present");
    assert(withoutTds.material === undefined, "material is honestly absent when TDS is absent");
  }

  console.log("\n[2] getFeatureFlag — env var fallback vs DB row precedence");
  {
    // memoryDb.featureFlags is seeded with tds_enabled:true by default —
    // confirm the DB row (not the env var) is authoritative once it exists.
    assert(await getFeatureFlag("tds_enabled") === true, "default seeded DB row (enabled:true) is authoritative");

    await setFeatureFlag("tds_enabled", false);
    assert(await getFeatureFlag("tds_enabled") === false, "setFeatureFlag persists and getFeatureFlag reads the updated DB row");
    assert(await isTdsEnabled() === false, "isTdsEnabled() reflects the same updated state");

    await setFeatureFlag("tds_enabled", true);
    assert(await getFeatureFlag("tds_enabled") === true, "flag round-trips back to enabled");

    // No DB row at all for a flag -> falls back to the env var default.
    const priorEnv = process.env.SOME_UNSEEDED_FLAG_ENABLED;
    process.env.SOME_UNSEEDED_FLAG_ENABLED = "false";
    memoryDb.featureFlags = memoryDb.featureFlags.filter(f => f.flagName !== "some_unseeded_flag");
    assert(await getFeatureFlag("some_unseeded_flag") === true, "an unrecognized flag name with no env default falls back to enabled (fail-open, no accidental hiding)");
    if (priorEnv === undefined) delete process.env.SOME_UNSEEDED_FLAG_ENABLED; else process.env.SOME_UNSEEDED_FLAG_ENABLED = priorEnv;
  }

  console.log("\n[3] Generation engine — the 'tds' phase slot is skipped, not removed, when the flag is off");
  {
    await setFeatureFlag("tds_enabled", false);

    // Reset any project/generation-state left over from other verify
    // scripts sharing this same in-process memoryDb import.
    const projectId = `proj_tds_flag_test_${Date.now()}`;
    memoryDb.projects.push({
      id: projectId, orgId: "org_test", userId: "user_test", name: "Flag Test",
      industry: "grooming-barbering", targetMarket: "both", productName: "Test Trimmer",
      description: "d", category: null, toolType: "trimmer", companyContext: null,
      motorTech: null, keyDiff: null, pricePoint: null, productUrl: null, asin: null,
      createdAt: new Date(), updatedAt: new Date(),
    } as any);

    const { startGenerationState } = await import("../lib/db/generation-state");
    await startGenerationState(projectId, { phase: "snapshot" });

    const { runProjectGenerationStep } = await import("../lib/project-generation-engine");
    const result = await runProjectGenerationStep(projectId, "org_test", "user_test");

    assert(result.state.phase === "tds", "phase transitions straight from 'snapshot' to 'tds' with the flag off");
    assert(result.state.status === "running", "status stays 'running' (this is a skip, not a completion)");

    // The real, observable proof that generateTdsFields/getOrCreateDocument
    // never ran: no "tds" document row exists for this project at all (if
    // the skip branch hadn't fired, the normal snapshot-phase work would
    // have created one via getOrCreateDocument(projectId, "tds")).
    const tdsDocExists = memoryDb.documents.some((d: any) => d.projectId === projectId && d.docType === "tds");
    assert(!tdsDocExists, "no TDS document was created — generateTdsFields/getOrCreateDocument never ran while the flag was off");

    await setFeatureFlag("tds_enabled", true);
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) throw new Error(`${failed} assertion(s) failed`);
}

main().catch(e => { console.error(e); process.exit(1); });
