// lib/db/projects.ts
import { supabase } from "@/lib/supabase";

export async function createProject(userId: string, data: {
  name:           string;
  industry:       string;
  targetMarket:   string;
  productName:    string;
  description?:   string;
  category?:      string;
  companyContext?: string;
  motorTech?:     string;
  keyDiff?:       string;
  pricePoint?:    string;
}) {
  const { data: project, error } = await supabase
    .from("projects")
    .insert({
      user_id:         userId,
      name:            data.name,
      industry:        data.industry,
      target_market:   data.targetMarket,
      product_name:    data.productName,
      description:     data.description ?? "",
      category:        data.category ?? "",
      company_context: data.companyContext ?? "",
      motor_tech:      data.motorTech ?? "",
      key_diff:        data.keyDiff ?? "",
      price_point:     data.pricePoint ?? "",
      last_used_at:    new Date().toISOString(),
    })
    .select()
    .single();

  if (error) throw error;
  return project;
}

export async function getUserProjects(userId: string) {
  const { data, error } = await supabase
    .from("projects")
    .select(`
      *,
      reports!latest_report_id (id, title, status, created_at)
    `)
    .eq("user_id", userId)
    .order("last_used_at", { ascending: false });

  if (error) throw error;
  return data ?? [];
}

export async function getProject(projectId: string, userId: string) {
  const { data, error } = await supabase
    .from("projects")
    .select("*")
    .eq("id", projectId)
    .eq("user_id", userId)
    .single();

  if (error) throw error;
  return data;
}

export async function updateProject(projectId: string, userId: string, updates: any) {
  const { data, error } = await supabase
    .from("projects")
    .update({ ...updates, last_used_at: new Date().toISOString() })
    .eq("id", projectId)
    .eq("user_id", userId)
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function deleteProject(projectId: string, userId: string) {
  const { error } = await supabase
    .from("projects")
    .delete()
    .eq("id", projectId)
    .eq("user_id", userId);

  if (error) throw error;
}
