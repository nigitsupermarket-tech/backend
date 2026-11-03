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
//
// ── Overselling / race-condition safety — see lib/stockSafety.ts ─────────
// Stock is CHECKED at order creation but not held — a customer's order can
// sit "pending payment" for minutes, during which another sale (a second
// online order confirming first, or a POS sale) can take the same stock.
// Every decrement below goes through `updateMany` with a `stockQuantity: {
// gte: quantity }` guard, wrapped in `runWithRetry` for MongoDB's
// transaction write-conflict semantics, and reports any genuine shortfall
// via `notifyOversold` — see stockSafety.ts for the full explanation.
import prisma from "../config/database";
import {
  runWithRetry,
  notifyOversold,
  type OversoldEvent,
} from "./stockSafety";

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
    where: { id: { in: order.items.map((i) => i.productId).filter((id): id is string => !!id) } },
    select: {
      id: true,
      name: true,
      sku: true,
      trackInventory: true,
      stockQuantity: true,
      scaleUnit: true,
    },
  });
  const productMap = new Map(products.map((p) => [p.id, p]));

  const oversoldEvents = await runWithRetry(() =>
    prisma.$transaction(async (tx) => {
      // Scoped inside the transaction (not declared outside it) and
      // returned rather than pushed-to-from-outside — a write-conflict
      // retry re-runs this whole callback from scratch, and an
      // outer-scoped array would double up entries across attempts.
      const events: OversoldEvent[] = [];

      // ATOMIC claim of the "deduct once" flag. The check at the top of this
      // function is read-then-write, so Paystack's verify call and its
      // webhook arriving together can both pass it. Whichever transaction
      // loses the write-conflict is retried by runWithRetry and re-runs this
      // callback — without this claim it would deduct a second time. Here
      // only the transaction that actually flips false→true proceeds.
      const claim = await tx.order.updateMany({
        where: { id: orderId, stockDeducted: false },
        data: { stockDeducted: true },
      });
      if (claim.count === 0) return events;

      for (const item of order.items) {
        const product = productMap.get(item.productId ?? "");
        // Narrow once, right after the lookup: `product` was only found
        // via a real string key in productMap, so if it's truthy here,
        // item.productId was necessarily a real string — but TypeScript
        // can't infer that correlation on its own, and InventoryLog.
        // productId is a required (non-nullable) field below, so this
        // needs an explicit local narrowing rather than relying on
        // `item.productId` directly for the rest of the loop body.
        const productId = item.productId;
        if (!product || !productId || !product.trackInventory) continue; // don't track untracked products

        // Live figures read INSIDE the transaction, so the log's
        // previousQty/newQty reflect the real stock at deduction time (the
        // snapshot taken before the transaction can be minutes old, and
        // doesn't account for earlier lines of this same order).
        const liveProduct = await tx.product.findUnique({
          where: { id: productId },
          select: { stockQuantity: true },
        });
        const liveShared = liveProduct?.stockQuantity ?? 0;

        if (item.variationId && item.stockMode === "DEDICATED") {
          const liveVariation = await tx.productVariation.findUnique({
            where: { id: item.variationId },
            select: { stockQuantity: true },
          });
          const prevQty = liveVariation?.stockQuantity ?? 0;

          const result = await tx.productVariation.updateMany({
            where: {
              id: item.variationId,
              stockQuantity: { gte: item.quantity },
            },
            data: { stockQuantity: { decrement: item.quantity } },
          });

          if (result.count === 0) {
            // Lost the race (or was already short) — floor at 0 rather than
            // leaving it at whatever partial value it had.
            await tx.productVariation.update({
              where: { id: item.variationId },
              data: { stockQuantity: 0 },
            });
            const shortfall = item.quantity - Math.max(0, prevQty);
            await tx.inventoryLog.create({
              data: {
                productId,
                type: "OVERSOLD",
                quantity: -item.quantity,
                previousQty: prevQty,
                newQty: 0,
                reason: `⚠ Oversold — ${item.variationLabel || "variation"} (order ${order.orderNumber}, paid but only ${Math.max(0, prevQty)} of ${item.quantity} available)`,
                reference: order.orderNumber,
                variationId: item.variationId,
                variationLabel: item.variationLabel,
                stockMode: "DEDICATED",
                performedBy: performedBy?.id,
                performedByName: performedBy?.name || "System",
              },
            });
            events.push({
              productId,
              productName: product.name,
              sku: product.sku,
              shortfall: Math.max(0, shortfall),
              unit: "pack(s)",
              variationLabel: item.variationLabel,
              reference: order.orderNumber,
              channel: "ONLINE_ORDER",
            });
          } else {
            await tx.inventoryLog.create({
              data: {
                productId,
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
          }
          continue;
        }

        // Shared pool — for variation items this is already the base qty
        // (item.quantity was resolved as packCount × variation.quantity at
        // order-creation time when stockMode is SHARED), for legacy items
        // it's the raw scale/unit quantity, both deduct the same way.
        const result = await tx.product.updateMany({
          where: { id: productId, stockQuantity: { gte: item.quantity } },
          data: {
            stockQuantity: { decrement: item.quantity },
            salesCount: { increment: item.quantity },
          },
        });

        if (result.count === 0) {
          await tx.product.update({
            where: { id: productId },
            data: {
              stockQuantity: 0,
              salesCount: { increment: item.quantity },
            },
          });
          const shortfall = item.quantity - Math.max(0, liveShared);
          await tx.inventoryLog.create({
            data: {
              productId,
              type: "OVERSOLD",
              quantity: -item.quantity,
              previousQty: liveShared,
              newQty: 0,
              reason: `⚠ Oversold${item.variationLabel ? ` — ${item.variationLabel}` : ""} (order ${order.orderNumber}, paid but only ${Math.max(0, liveShared)} of ${item.quantity} available)`,
              reference: order.orderNumber,
              variationId: item.variationId ?? undefined,
              variationLabel: item.variationLabel ?? undefined,
              stockMode: item.variationId ? "SHARED" : undefined,
              performedBy: performedBy?.id,
              performedByName: performedBy?.name || "System",
            },
          });
          events.push({
            productId,
            productName: product.name,
            sku: product.sku,
            shortfall: Math.max(0, shortfall),
            unit: product.scaleUnit || "unit(s)",
            variationLabel: item.variationLabel,
            reference: order.orderNumber,
            channel: "ONLINE_ORDER",
          });
        } else {
          await tx.inventoryLog.create({
            data: {
              productId,
              // Distinct from POS's "POS_SALE" so the stock-movement report can
              // filter/group by sales channel unambiguously.
              type: "ONLINE_SALE",
              quantity: -item.quantity,
              previousQty: liveShared,
              newQty: liveShared - item.quantity,
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
      }

      return events;
    }),
  );

  // Fire the admin alert after the transaction commits, not inside it —
  // an email failure should never roll back a stock deduction that
  // already succeeded.
  await notifyOversold(oversoldEvents);
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
    where: { id: { in: order.items.map((i) => i.productId).filter((id): id is string => !!id) } },
    select: { id: true, trackInventory: true, stockQuantity: true },
  });
  const productMap = new Map(products.map((p) => [p.id, p]));

  await runWithRetry(() =>
    prisma.$transaction(async (tx) => {
      // Atomic claim (true→false) so a cancel and a refund webhook racing
      // each other can't both restore the same stock.
      const claim = await tx.order.updateMany({
        where: { id: orderId, stockDeducted: true },
        data: { stockDeducted: false },
      });
      if (claim.count === 0) return;

      for (const item of order.items) {
        const product = productMap.get(item.productId ?? "");
        const productId = item.productId;
        if (!product || !productId || !product.trackInventory) continue;

        const liveProduct = await tx.product.findUnique({
          where: { id: productId },
          select: { stockQuantity: true },
        });
        const liveShared = liveProduct?.stockQuantity ?? 0;

        if (item.variationId && item.stockMode === "DEDICATED") {
          const liveVariation = await tx.productVariation.findUnique({
            where: { id: item.variationId },
            select: { stockQuantity: true },
          });
          const prevQty = liveVariation?.stockQuantity ?? 0;
          await tx.productVariation.update({
            where: { id: item.variationId },
            data: { stockQuantity: { increment: item.quantity } },
          });
          await tx.inventoryLog.create({
            data: {
              productId,
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
          where: { id: productId },
          data: {
            stockQuantity: { increment: item.quantity },
            salesCount: { decrement: item.quantity },
          },
        });
        await tx.inventoryLog.create({
          data: {
            productId,
            // Distinct from POS's "RETURN" so the stock-movement report can
            // filter/group by sales channel unambiguously.
            type: "ONLINE_RETURN",
            quantity: item.quantity,
            previousQty: liveShared,
            newQty: liveShared + item.quantity,
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
    }),
  );
}

// Used by every payment-confirmation path. The deduction used to be fired
// without waiting and a failure was only printed to the console — the order
// stayed paid with stockDeducted=false forever and nothing retried it. This
// waits for the result, retries transient failures, and never throws (a stock
// problem must not turn a successful payment into an error response). It
// returns false after the final attempt so callers can log it loudly; any
// order left undeducted can be picked up by scripts/backfill-order-stock.ts.
export async function deductStockWithRetry(
  orderId: string,
  performedBy?: { id?: string; name?: string },
  attempts = 3,
): Promise<boolean> {
  for (let i = 1; i <= attempts; i++) {
    try {
      await deductStockForOrder(orderId, performedBy);
      return true;
    } catch (err) {
      console.error(`[stock] Deduction attempt ${i}/${attempts} failed for order ${orderId}:`, err);
      if (i < attempts) await new Promise((r) => setTimeout(r, 500 * i));
    }
  }
  console.error(`[stock] CRITICAL: order ${orderId} is paid but stock was NOT deducted — run scripts/backfill-order-stock.ts`);
  return false;
}
