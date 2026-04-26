import { PrismaClient } from "@prisma/client";
import process from "process";

const prisma = new PrismaClient();

async function resetSalesCount() {
  console.log("🔄 Resetting product salesCount to 0...");

  try {
    const result = await prisma.product.updateMany({
      data: {
        salesCount: 0,
      },
    });

    console.log(`✅ Updated ${result.count} products`);
  } catch (error) {
    console.error("❌ Failed to reset salesCount:", error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

resetSalesCount();
