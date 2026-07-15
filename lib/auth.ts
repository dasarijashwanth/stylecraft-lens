import { prisma, isDbConfigured } from "./db";
import { isSupabaseConfigured, supabaseAdmin } from "./supabase";
import { createSupabaseServerClient } from "./supabase-server";

export interface UserSession {
  userId: string;
  orgId: string;
  email: string;
  name: string;
  avatarUrl: string;
  role: "OWNER" | "ADMIN" | "MEMBER" | "VIEWER";
  plan: "FREE" | "PRO" | "AGENCY" | "ENTERPRISE";
  // True until the seeded admin changes their bootstrap password — gates
  // access via components/layout/Shell.tsx's redirect to /change-password.
  mustChangePassword: boolean;
}

const MOCK_SESSION: UserSession = {
  userId: "dev_user_id",
  orgId: "dev_org_id",
  email: "developer@stylecraftlens.com",
  name: "Dev Admin",
  avatarUrl: "https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=150&h=150",
  role: "OWNER",
  plan: "FREE",
  mustChangePassword: false,
};

export const hasClerkKeys =
  !!process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY &&
  !!process.env.CLERK_SECRET_KEY &&
  process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY !== "pk_..." &&
  process.env.CLERK_SECRET_KEY !== "sk_...";

export async function getAuthSession(): Promise<UserSession> {
  // Real Supabase Auth — the actual live identity provider for this app
  // (Supabase is always configured in the deployed app, so this is the
  // path that actually runs there; the Clerk/dev-bypass/mock chain below
  // only remains reachable for local contributors without real Supabase
  // credentials). Deliberately throws rather than falling back to
  // MOCK_SESSION when nobody's logged in — /api/auth/session/route.ts
  // already catches this and reports {user: null}, which is what drives
  // the real sign-in redirect; silently succeeding as "Dev Admin" here
  // would defeat the entire point of adding real auth.
  if (isSupabaseConfigured) {
    const supabase = createSupabaseServerClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) throw new Error("UNAUTHENTICATED");

    const { data: profile, error } = await supabaseAdmin
      .from("profiles")
      .select("*")
      .eq("id", user.id)
      .maybeSingle();
    if (error) throw error;
    if (!profile) {
      // A real Supabase user exists but has no profiles row — a genuine
      // misconfiguration (e.g. scripts/create-admin-user.ts never run, or
      // the profiles table migration wasn't applied), not "not logged in".
      // Surface this loudly instead of quietly treating them as a guest.
      throw new Error(`No profile found for ${user.email} — run scripts/create-admin-user.ts and ensure the profiles table exists.`);
    }

    return {
      // Domain data (projects/competitors/analyses/reports) stays keyed to
      // these existing fixed literals rather than the real Supabase user
      // id — ownership filtering is inconsistent across lib/db/*.ts today
      // (some filter by org_id, some by user_id), so a real per-row
      // migration risks silently orphaning data in whichever tables use
      // the column not migrated. Pinning here means the admin sees 100% of
      // existing data with zero SQL migration. This is a single-admin app
      // with no multi-tenant management requested — if a second real user
      // is ever added, this pinning strategy needs to be replaced with a
      // genuine per-user migration first.
      userId: "dev_user_id",
      orgId: "dev_org_id",
      email: profile.email,
      name: profile.name || profile.email,
      avatarUrl: "",
      role: profile.role,
      plan: "FREE",
      mustChangePassword: profile.must_change_password,
    };
  }

  if (hasClerkKeys && isDbConfigured) {
    try {
      const { auth, currentUser } = await import("@clerk/nextjs/server");
      const session = await auth();
      const user = await currentUser();
      
      if (session.userId && user) {
        const email = user.emailAddresses[0]?.emailAddress || `${session.userId}@clerk.local`;
        const name = user.firstName
          ? `${user.firstName} ${user.lastName || ""}`.trim()
          : "User";
        const avatarUrl = user.imageUrl;
        
        let dbUser = await prisma.user.findUnique({
          where: { clerkId: session.userId },
          include: { org: true },
        });
        
        if (!dbUser) {
          let org = await prisma.org.findFirst();
          if (!org) {
            org = await prisma.org.create({
              data: {
                id: "default_org",
                name: "Workspace Org",
                slug: `org-${Date.now()}`,
                plan: "FREE",
              },
            });
          }
          
          dbUser = await prisma.user.create({
            data: {
              clerkId: session.userId,
              email,
              name,
              avatarUrl,
              orgId: org.id,
              role: "OWNER",
            },
            include: { org: true },
          });
        }
        
        return {
          userId: dbUser.id,
          orgId: dbUser.orgId || "default_org",
          email: dbUser.email,
          name: dbUser.name || "User",
          avatarUrl: dbUser.avatarUrl || "",
          role: dbUser.role as any,
          plan: (dbUser.org?.plan as any) || "FREE",
          mustChangePassword: false,
        };
      }
    } catch (e) {
      console.error("Clerk auth extraction failed, falling back to developer session:", e);
    }
  }

  // Developer Mode Bypass
  if (isDbConfigured) {
    try {
      let org = await prisma.org.findUnique({ where: { slug: "dev-workspace" } });
      if (!org) {
        org = await prisma.org.create({
          data: {
            id: "dev_org_id",
            name: "Dev Workspace",
            slug: "dev-workspace",
            plan: "FREE",
          },
        });
      }
      
      let user = await prisma.user.findUnique({ where: { email: MOCK_SESSION.email } });
      if (!user) {
        user = await prisma.user.create({
          data: {
            id: MOCK_SESSION.userId,
            clerkId: "clerk_dev_123",
            email: MOCK_SESSION.email,
            name: MOCK_SESSION.name,
            avatarUrl: MOCK_SESSION.avatarUrl,
            orgId: org.id,
            role: "OWNER",
          },
        });
      }
      
      return {
        userId: user.id,
        orgId: user.orgId || org.id,
        email: user.email,
        name: user.name || "Dev Admin",
        avatarUrl: user.avatarUrl || "",
        role: user.role as any,
        plan: org.plan as any,
        mustChangePassword: false,
      };
    } catch (error) {
      // Graceful degradation when the database is completely offline/unconfigured
      return MOCK_SESSION;
    }
  }

  return MOCK_SESSION;
}
