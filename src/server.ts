import app from "./app";
import prisma from "./config/database";

const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log(`🚀 Server is running on port ${PORT}`);
});

// Database connection check (runs once on cold start)
async function connectDatabase() {
  try {
    await prisma.$connect();
    console.log("✅ Database connected successfully");
  } catch (error) {
    console.error("❌ Database connection failed:", error);
  }
}

// Connect to DB on module load (serverless cold start)
connectDatabase();

// Graceful shutdown for local dev
async function gracefulShutdown() {
  console.log("\n🔄 Shutting down gracefully...");
  await prisma.$disconnect();
  process.exit(0);
}

process.on("SIGTERM", gracefulShutdown);
process.on("SIGINT", gracefulShutdown);

// Export app for Vercel serverless
export default app;
