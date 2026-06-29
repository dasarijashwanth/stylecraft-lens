import { prisma, isDbConfigured } from "./db";

export interface UserSession {
  userId: string;
  orgId: string;
  email: string;
  name: string;
  avatarUrl: string;
  role: "OWNER" | "ADMIN" | "MEMBER" | "VIEWER";
  plan: "FREE" | "PRO" | "AGENCY" | "ENTERPRISE";
}

const MOCK_SESSION: UserSession = {
  userId: "dev_user_id",
  orgId: "dev_org_id",
  email: "developer@stylecraftlens.com",
  name: "Dev Admin",
  avatarUrl: "https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=150&h=150",
  role: "OWNER",
  plan: "FREE",
};

export const hasClerkKeys =
  !!process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY &&
  !!process.env.CLERK_SECRET_KEY &&
  process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY !== "pk_..." &&
  process.env.CLERK_SECRET_KEY !== "sk_...";

export async function getAuthSession(): Promise<UserSession> {
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
      };
    } catch (error) {
      // Graceful degradation when the database is completely offline/unconfigured
      return MOCK_SESSION;
    }
  }

  return MOCK_SESSION;
}
