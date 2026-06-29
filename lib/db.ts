import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const isDbConfigured = 
  !!process.env.DATABASE_URL && 
  process.env.DATABASE_URL !== "" &&
  !process.env.DATABASE_URL.includes("placeholder") &&
  !process.env.DATABASE_URL.includes("xxxxxxxx");

export const prisma: PrismaClient = (isDbConfigured
  ? (globalForPrisma.prisma ??
     new PrismaClient({
       log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
     }))
  : (new Proxy({}, {
      get(target, model) {
        return new Proxy({}, {
          get(t, method) {
            return () => {
              throw new Error("Database not configured. Bypassing Prisma Client.");
            };
          }
        });
      }
    }) as any)) as PrismaClient;

if (process.env.NODE_ENV !== "production" && isDbConfigured) {
  globalForPrisma.prisma = prisma as any;
}
