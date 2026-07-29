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

  // Variation items need their own record fetched to know current dedicated
  // stock (previousQty) before decrementing.
  const variationIds = order.items
    .filter((i) => i.variationId)
    .map((i) => i.variationId as string);
  const variations = variationIds.length
    ? await prisma.productVariation.findMany({
        where: { id: { in: variationIds } },
      })
    : [];
  const variationMap = new Map(variations.map((v) => [v.id, v]));

  await prisma.$transaction(async (tx) => {
    for (const item of order.items) {
      const product = productMap.get(item.productId);
      if (!product || !product.trackInventory) continue; // don't track untracked products

      if (item.variationId && item.stockMode === "DEDICATED") {
        const variation = variationMap.get(item.variationId);
        const prevQty = variation?.stockQuantity ?? 0;
        await tx.productVariation.update({
          where: { id: item.variationId },
          data: { stockQuantity: { decrement: item.quantity } },
        });
        await tx.inventoryLog.create({
          data: {
            productId: item.productId,
            type: "ONLINE_SALE",
            quantity: -item.quantity,
            previousQty: prevQty,
            newQty: prevQty - item.quantity,
            reason: `Online order — ${item.variationLabel || "variation"}`,
            reference: order.orderNumber,
            variationId: item.variationId,
            variationLabel: item.variationLabel,
            stockMode: "DEDICATED",
            performedBy: performedBy?.id,
            performedByName: performedBy?.name || "System",
          },
        });
        continue;
      }

      // Shared pool — for variation items this is already the base qty
      // (item.quantity was resolved as packCount × variation.quantity at
      // order-creation time when stockMode is SHARED), for legacy items
      // it's the raw scale/unit quantity, both deduct directly.
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
          // Distinct from POS's "POS_SALE" so the stock-movement report can
          // filter/group by sales channel unambiguously.
          type: "ONLINE_SALE",
          quantity: -item.quantity,
          previousQty: product.stockQuantity,
          newQty: product.stockQuantity - item.quantity,
          reason: item.variationLabel
            ? `Online order — ${item.variationLabel}`
            : "Online order",
          reference: order.orderNumber,
          variationId: item.variationId ?? undefined,
          variationLabel: item.variationLabel ?? undefined,
          stockMode: item.variationId ? "SHARED" : undefined,
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

  const variationIds = order.items
    .filter((i) => i.variationId)
    .map((i) => i.variationId as string);
  const variations = variationIds.length
    ? await prisma.productVariation.findMany({
        where: { id: { in: variationIds } },
      })
    : [];
  const variationMap = new Map(variations.map((v) => [v.id, v]));

  await prisma.$transaction(async (tx) => {
    for (const item of order.items) {
      const product = productMap.get(item.productId);
      if (!product || !product.trackInventory) continue;

      if (item.variationId && item.stockMode === "DEDICATED") {
        const variation = variationMap.get(item.variationId);
        const prevQty = variation?.stockQuantity ?? 0;
        await tx.productVariation.update({
          where: { id: item.variationId },
          data: { stockQuantity: { increment: item.quantity } },
        });
        await tx.inventoryLog.create({
          data: {
            productId: item.productId,
            type: "ONLINE_RETURN",
            quantity: item.quantity,
            previousQty: prevQty,
            newQty: prevQty + item.quantity,
            reason: `Online order — ${reason} (${item.variationLabel || "variation"})`,
            reference: order.orderNumber,
            variationId: item.variationId,
            variationLabel: item.variationLabel,
            stockMode: "DEDICATED",
            performedBy: performedBy?.id,
            performedByName: performedBy?.name || "System",
          },
        });
        continue;
      }

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
          // Distinct from POS's "RETURN" so the stock-movement report can
          // filter/group by sales channel unambiguously.
          type: "ONLINE_RETURN",
          quantity: item.quantity,
          previousQty: product.stockQuantity,
          newQty: product.stockQuantity + item.quantity,
          reason: item.variationLabel
            ? `Online order — ${reason} (${item.variationLabel})`
            : `Online order — ${reason}`,
          reference: order.orderNumber,
          variationId: item.variationId ?? undefined,
          variationLabel: item.variationLabel ?? undefined,
          stockMode: item.variationId ? "SHARED" : undefined,
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
