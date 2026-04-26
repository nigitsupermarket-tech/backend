import app from "./app";
import prisma from "./config/database";

// Connect DB on cold start
prisma.$connect().catch((err) => {
  console.error("❌ Database connection failed:", err);
});

export default app;
