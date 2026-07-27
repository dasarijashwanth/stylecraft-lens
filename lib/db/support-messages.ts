// lib/db/support-messages.ts
// CRUD over support_messages (Contact Support submissions) — dual-path
// (Supabase/memoryDb), mirroring lib/db/faqs.ts's exact style. Unlike FAQ
// content, this is real user-generated data, not admin-seeded reference
// config — memoryDb starts empty here, nothing to seed.
import { isSupabaseConfigured, supabaseAdmin } from "@/lib/supabase";
import { memoryDb, MockSupportMessage } from "@/lib/memoryDb";

export type EmailStatus = "pending" | "sent" | "failed";

export interface SupportMessageRow {
  id: string;
  user_id: string;
  name: string;
  email: string;
  topic: string;
  message: string;
  context: Record<string, any> | null;
  screenshot_url: string | null;
  email_status: EmailStatus;
  email_error: string | null;
  ack_email_status: EmailStatus;
  admin_notification_read: boolean;
  created_at: string;
  updated_at: string;
}

function mockToRow(m: MockSupportMessage): SupportMessageRow {
  return {
    id: m.id,
    user_id: m.userId,
    name: m.name,
    email: m.email,
    topic: m.topic,
    message: m.message,
    context: m.context,
    screenshot_url: m.screenshotUrl,
    email_status: m.emailStatus,
    email_error: m.emailError,
    ack_email_status: m.ackEmailStatus,
    admin_notification_read: m.adminNotificationRead,
    created_at: m.createdAt.toISOString(),
    updated_at: m.updatedAt.toISOString(),
  };
}

export async function createSupportMessage(input: {
  userId: string;
  name: string;
  email: string;
  topic: string;
  message: string;
  context: Record<string, any> | null;
  screenshotUrl: string | null;
}): Promise<SupportMessageRow> {
  if (isSupabaseConfigured) {
    const { data, error } = await supabaseAdmin
      .from("support_messages")
      .insert({
        user_id: input.userId,
        name: input.name,
        email: input.email,
        topic: input.topic,
        message: input.message,
        context: input.context,
        screenshot_url: input.screenshotUrl,
        email_status: "pending",
        ack_email_status: "pending",
        admin_notification_read: false,
      })
      .select()
      .single();
    if (error) throw error;
    return data;
  }

  const now = new Date();
  const row: MockSupportMessage = {
    id: `support_${Date.now()}_${Math.floor(Math.random() * 1e6)}`,
    userId: input.userId,
    name: input.name,
    email: input.email,
    topic: input.topic,
    message: input.message,
    context: input.context,
    screenshotUrl: input.screenshotUrl,
    emailStatus: "pending",
    emailError: null,
    ackEmailStatus: "pending",
    adminNotificationRead: false,
    createdAt: now,
    updatedAt: now,
  };
  memoryDb.supportMessages.push(row);
  return mockToRow(row);
}

// Rate limiting: 5 submissions per identity per rolling hour.
export async function countRecentSupportMessages(userId: string, sinceIso: string): Promise<number> {
  if (isSupabaseConfigured) {
    const { count, error } = await supabaseAdmin
      .from("support_messages")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .gte("created_at", sinceIso);
    if (error) throw error;
    return count ?? 0;
  }
  return memoryDb.supportMessages.filter(m => m.userId === userId && m.createdAt.toISOString() >= sinceIso).length;
}

export async function listSupportMessages(): Promise<SupportMessageRow[]> {
  if (isSupabaseConfigured) {
    const { data, error } = await supabaseAdmin
      .from("support_messages")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) throw error;
    return data || [];
  }
  return memoryDb.supportMessages
    .slice()
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    .map(mockToRow);
}

export async function getSupportMessage(id: string): Promise<SupportMessageRow | null> {
  if (isSupabaseConfigured) {
    const { data, error } = await supabaseAdmin.from("support_messages").select("*").eq("id", id).maybeSingle();
    if (error) throw error;
    return data;
  }
  const row = memoryDb.supportMessages.find(m => m.id === id);
  return row ? mockToRow(row) : null;
}

export async function updateEmailStatus(id: string, status: EmailStatus, error: string | null): Promise<void> {
  if (isSupabaseConfigured) {
    const { error: dbErr } = await supabaseAdmin
      .from("support_messages")
      .update({ email_status: status, email_error: error, updated_at: new Date().toISOString() })
      .eq("id", id);
    if (dbErr) throw dbErr;
    return;
  }
  const row = memoryDb.supportMessages.find(m => m.id === id);
  if (row) {
    row.emailStatus = status;
    row.emailError = error;
    row.updatedAt = new Date();
  }
}

export async function updateAckEmailStatus(id: string, status: EmailStatus): Promise<void> {
  if (isSupabaseConfigured) {
    const { error } = await supabaseAdmin
      .from("support_messages")
      .update({ ack_email_status: status, updated_at: new Date().toISOString() })
      .eq("id", id);
    if (error) throw error;
    return;
  }
  const row = memoryDb.supportMessages.find(m => m.id === id);
  if (row) {
    row.ackEmailStatus = status;
    row.updatedAt = new Date();
  }
}

export async function markNotificationRead(id: string): Promise<void> {
  if (isSupabaseConfigured) {
    const { error } = await supabaseAdmin
      .from("support_messages")
      .update({ admin_notification_read: true })
      .eq("id", id);
    if (error) throw error;
    return;
  }
  const row = memoryDb.supportMessages.find(m => m.id === id);
  if (row) row.adminNotificationRead = true;
}
