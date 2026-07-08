// lib/validations.ts
import { z } from "zod";

// Normalizes and validates any URL input
export function normalizeUrl(input: string): string | null {
  if (!input || input.trim() === "") return null;

  let url = input.trim();

  if (!/^https?:\/\//i.test(url)) {
    url = `https://${url}`;
  }

  try {
    const parsed = new URL(url);
    if (!parsed.hostname.includes(".")) return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

export const AddCompetitorSchema = z.object({
  name:        z.string().min(2, "Name must be at least 2 characters").max(100),
  website:     z.string().optional(),
  description: z.string().max(500).optional(),
  status:      z.enum(["ACTIVE", "MONITORING", "ARCHIVED"]),
  tags:        z.array(z.string().max(30)).max(10),
  main_products: z.string().max(200).optional(),
});

export const ProjectSchema = z.object({
  name:            z.string().min(2).max(100),
  industry:        z.enum(["grooming-barbering", "haircare-styling"]),
  targetMarket:    z.enum(["pro", "consumer", "both"]),
  productName:     z.string().min(2).max(100),
  description:     z.string().min(10).max(2000),
  category:        z.string().max(100).optional(),
  companyContext:  z.string().max(1000).optional(),
  motorTech:       z.string().max(100).optional(),
  keyDiff:         z.string().max(200).optional(),
  pricePoint:      z.string()
                     .max(20)
                     .optional()
                     .refine(
                       val => !val || /^\$?\d+(\.\d{1,2})?$/.test(val),
                       "Price must be a number like 99.95 or $99.95"
                     ),
});

export const AnalysisFormSchema = z.object({
  industry: z.string().min(1, "Select an industry"),
  targetMarket: z.enum(["pro", "consumer", "both"]),
  productName: z.string().min(2, "Product name must be at least 2 characters").max(100),
  description: z.string().min(10, "Add at least 10 characters for sharper results").max(2000),
  category: z.string().optional(),
  companyContext: z.string().max(1000).optional(),
  motorTech: z.string().optional(),
  keyDiff: z.string().max(200).optional(),
  pricePoint: z.string().max(50).optional(),
});

export const NewProjectSchema = z.object({
  name: z.string().min(2, "Project name must be at least 2 characters").max(100),
  industry: z.string().min(1, "Select an industry"),
  targetMarket: z.enum(["pro", "consumer", "both"]),
  productName: z.string().min(2, "Product name must be at least 2 characters").max(100),
  description: z.string().min(10, "Add at least 10 characters for sharper results").max(2000),
  category: z.string().optional(),
  companyContext: z.string().max(1000).optional(),
  motorTech: z.string().optional(),
  keyDiff: z.string().max(200).optional(),
  pricePoint: z.string().max(50).optional(),
  // The product-anchor identity — optional, but when provided drives the
  // real-time TDS snapshot + auto-fill pipeline (see lib/snapshot-capture.ts).
  productUrl: z.string().max(500).optional().refine(v => !v || normalizeUrl(v) !== null, "Enter a valid product URL"),
  asin: z.string().max(20).optional().refine(v => !v || /^[A-Z0-9]{10}$/i.test(v), "ASIN must be exactly 10 letters/digits"),
});
