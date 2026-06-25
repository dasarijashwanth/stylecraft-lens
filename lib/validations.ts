import { z } from "zod";

export const AddCompetitorSchema = z.object({
  name: z.string().min(2, "Name must be at least 2 characters").max(100),
  website: z.string().url("Enter a valid URL").optional().or(z.literal("")),
  description: z.string().max(500, "Description too long").optional(),
  status: z.enum(["ACTIVE", "MONITORING", "ARCHIVED"]),
  tags: z.array(z.string().max(30)).max(10, "Maximum 10 tags"),
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
});
