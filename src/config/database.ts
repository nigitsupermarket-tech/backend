// backend/src/config/database.ts

import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

const createPrismaClient = () => {
  const client = new PrismaClient({
    log:
      process.env.NODE_ENV === "development"
        ? ["error", "warn"] // removed "query" — it floods console and slows dev
        : ["error"],
    datasources: {
      db: {
        url: process.env.DATABASE_URL,
      },
    },
  });

  // Verify connection on startup with a clear log
  client
    .$connect()
    .then(() => console.log("✅ Database connected successfully"))
    .catch((err: Error) => {
      console.error("❌ Database connection failed:", err.message);
      process.exit(1);
    });

  return client;
};

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}

export default prisma;
