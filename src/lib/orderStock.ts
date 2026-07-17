// backend/src/lib/orderStock.ts
//
// Stock is deducted for an online order at PAYMENT CONFIRMATION, not at
// order creation — a customer who abandons checkout (bank-transfer never
// paid, Paystack never completes) should never have tied up inventory.
//
// This mirrors the same stockQuantity/salesCount/InventoryLog pattern
// already used for POS sales (see pos.controller.ts), so reporting and
// inventory logs stay consistent across both sales channels.
//
// `Order.stockDeducted` is the idempotency guard — call this from every
// payment-confirmation path (Paystack verify, Paystack webhook, bank
// transfer confirm) without worrying about double-deducting if more than
// one of those fires for the same order.
import prisma from "../config/database";

export async function deductStockForOrder(
  orderId: string,
  performedBy?: { id?: string; name?: string },
): Promise<void> {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: { items: true },
  });
  if (!order || order.stockDeducted) return; // already deducted, or order missing

  const products = await prisma.product.findMany({
    where: { id: { in: order.items.map((i) => i.productId) } },
    select: { id: true, trackInventory: true, stockQuantity: true },
  });
  const productMap = new Map(products.map((p) => [p.id, p]));

  await prisma.$transaction(async (tx) => {
    for (const item of order.items) {
      const product = productMap.get(item.productId);
      if (!product || !product.trackInventory) continue; // don't track untracked products

      await tx.product.update({
        where: { id: item.productId },
        data: {
          stockQuantity: { decrement: item.quantity },
          salesCount: { increment: item.quantity },
        },
      });
      await tx.inventoryLog.create({
        data: {
          productId: item.productId,
          type: "SALE",
          quantity: -item.quantity,
          previousQty: product.stockQuantity,
          newQty: product.stockQuantity - item.quantity,
          reason: "Online order payment confirmed",
          reference: order.orderNumber,
          performedBy: performedBy?.id,
          performedByName: performedBy?.name || "System",
        },
      });
    }

    await tx.order.update({
      where: { id: orderId },
      data: { stockDeducted: true },
    });
  });
}

export async function restoreStockForOrder(
  orderId: string,
  reason: string,
  performedBy?: { id?: string; name?: string },
): Promise<void> {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: { items: true },
  });
  // Only restore what was actually deducted — an order cancelled before
  // payment confirmation never touched stock in the first place.
  if (!order || !order.stockDeducted) return;

  const products = await prisma.product.findMany({
    where: { id: { in: order.items.map((i) => i.productId) } },
    select: { id: true, trackInventory: true, stockQuantity: true },
  });
  const productMap = new Map(products.map((p) => [p.id, p]));

  await prisma.$transaction(async (tx) => {
    for (const item of order.items) {
      const product = productMap.get(item.productId);
      if (!product || !product.trackInventory) continue;

      await tx.product.update({
        where: { id: item.productId },
        data: {
          stockQuantity: { increment: item.quantity },
          salesCount: { decrement: item.quantity },
        },
      });
      await tx.inventoryLog.create({
        data: {
          productId: item.productId,
          type: "RETURN",
          quantity: item.quantity,
          previousQty: product.stockQuantity,
          newQty: product.stockQuantity + item.quantity,
          reason,
          reference: order.orderNumber,
          performedBy: performedBy?.id,
          performedByName: performedBy?.name || "System",
        },
      });
    }

    await tx.order.update({
      where: { id: orderId },
      data: { stockDeducted: false },
    });
  });
}
