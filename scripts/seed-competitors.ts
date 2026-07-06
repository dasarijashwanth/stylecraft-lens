// scripts/seed-competitors.ts
// Run once with: npx tsx scripts/seed-competitors.ts

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";
import { resolve } from "path";

// Load environment variables manually from .env.local
try {
  const envPath = resolve(process.cwd(), ".env.local");
  const envContent = readFileSync(envPath, "utf-8");
  envContent.split("\n").forEach(line => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) return;
    const index = trimmed.indexOf("=");
    if (index === -1) return;
    const key = trimmed.substring(0, index).trim();
    let val = trimmed.substring(index + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.substring(1, val.length - 1);
    }
    process.env[key] = val;
  });
  console.log("Successfully loaded environment variables from .env.local");
} catch (e) {
  console.warn("Warning: Could not read .env.local file. Proceeding with system env vars.");
}

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error("Error: NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in env or .env.local");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

const FIXED_COMPETITORS = [
  { name: "Wahl Professional",          website: "https://wahlpro.com",                  main_products: "Clippers, trimmers, grooming tools" },
  { name: "Andis",                      website: "https://andis.com",                    main_products: "Clippers, trimmers, shavers" },
  { name: "BaBylissPRO",                website: "https://babylisspro.com",               main_products: "Professional styling tools & barber equipment" },
  { name: "Gamma+",                     website: "https://gamma-plus.com",                main_products: "Professional clippers, trimmers, styling tools" },
  { name: "JRL Professional",           website: "https://jrlusa.com",                    main_products: "Clippers, trimmers, salon equipment" },
  { name: "Oster Professional",         website: "https://www.osterpro.com",              main_products: "Clippers and grooming tools" },
  { name: "Cocco Professional",         website: "https://coccohairpro.com",              main_products: "Clippers, trimmers, styling tools" },
  { name: "TPOB (The People's Barber)", website: "https://tpob.co.uk",                    main_products: "Barber clippers and trimmers" },
  { name: "Supreme Trimmer",            website: "https://supremetrimmer.com",            main_products: "Clippers, trimmers, shavers" },
  { name: "Caliber Pro",                website: "https://caliberprocorp.com",            main_products: "Professional barber tools" },
  { name: "Panasonic Professional",     website: "https://shop.panasonic.com",            main_products: "Professional hair clippers and trimmers" },
  { name: "Philips Norelco",            website: "https://www.usa.philips.com",           main_products: "Electric grooming devices" },
  { name: "Braun",                      website: "https://us.braun.com",                  main_products: "Grooming and shaving products" },
  { name: "Remington",                  website: "https://www.remingtonproducts.com",     main_products: "Hair styling and grooming tools" },
  { name: "ConairPRO",                  website: "https://www.conairpro.com",             main_products: "Professional salon tools" },
  { name: "Hatteker",                   website: "https://www.hatteker.com",              main_products: "Grooming kits and trimmers" },
  { name: "Kiepe Professional",         website: "https://www.kiepe.it",                  main_products: "Professional barber equipment" },
  { name: "Moser (Wahl Group)",         website: "https://www.moserpro.com",              main_products: "Professional hair clippers" },
  { name: "Jaguar Solingen",            website: "https://www.jaguar-solingen.com",        main_products: "Professional salon and barber tools" },
  { name: "WAHL Home Products",         website: "https://us.wahl.com",                   main_products: "Consumer grooming products" },
];

async function seed() {
  const SYSTEM_USER_ID = process.env.SEED_USER_ID ?? "system-fixed-competitors";

  for (const comp of FIXED_COMPETITORS) {
    const { data: existing } = await supabase
      .from("competitors")
      .select("id")
      .eq("name", comp.name)
      .eq("is_fixed", true)
      .maybeSingle();

    if (existing) {
      console.log(`Already exists: ${comp.name}`);
      continue;
    }

    const { error } = await supabase.from("competitors").insert({
      user_id:       SYSTEM_USER_ID,
      org_id:        SYSTEM_USER_ID,
      name:          comp.name,
      website:       comp.website,
      main_products: comp.main_products,
      status:        "active",
      is_fixed:      true,
      tags:          ["fixed", "industry-standard"],
    });

    if (error) {
      console.error(`Failed to seed ${comp.name}:`, error.message);
    } else {
      console.log(`Seeded: ${comp.name}`);
    }
  }

  console.log("\nDone. 20 fixed competitors seeded.");
}

seed().catch(console.error);
