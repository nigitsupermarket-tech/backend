// backend/scripts/backfill-order-stock.ts
//
// WHY THIS SCRIPT EXISTS
// ────────────────────────────────────────────────────────────────────────
// Stock is normally deducted at payment confirmation (see
// backend/src/lib/orderStock.ts — deductStockForOrder(), called from the
// Paystack verify/webhook and bank-transfer-confirm paths). If the site was
// having issues right when a payment was confirmed, that call can be missed
// entirely: the order ends up correctly marked PAID, but `stockDeducted`
// stays false forever, and the sale never shows up in the Stock Movement
// report or affects available inventory — because nothing ever ran.
//
// This script does exactly what would have run automatically, after the
// fact, for a specific order (or several) — decrementing stock, writing the
// same InventoryLog entries the live path would have written, and marking
// stockDeducted: true — but with two differences appropriate for a manual
// backfill:
//   1. The InventoryLog entries are backdated to the order's actual paid
//      time (order.paidAt, falling back to order.createdAt), not "now" —
//      so the Stock Movement report reflects when the sale really
//      happened, not when someone happened to run this script.
//   2. It writes an ActivityLog entry per order documenting that this was
//      a manual backfill (and why), so it's clearly distinguishable later
//      from a normal live deduction if anyone goes looking.
//
// It is idempotent and safe to re-run: any order already marked
// stockDeducted: true is skipped untouched, matching deductStockForOrder's
// own guard.
//
// USAGE
// ────────────────────────────────────────────────────────────────────────
//   Backfill specific order(s) by order number or Mongo ID:
//     npm run backfill:order-stock -- ORD-16489547-386
//     npm run backfill:order-stock -- ORD-16489547-386 ORD-16490001-042
//
//   Preview without writing anything (always do this first):
//     npm run backfill:order-stock -- --dry-run ORD-16489547-386
//
//   Auto-discover EVERY paid order that's missing its stock deduction
//   (useful if more than one order was affected by the same outage):
//     npm run backfill:order-stock -- --all-missing
//     npm run backfill:order-stock -- --dry-run --all-missing
//
//   Attribute the backfill to a specific admin instead of the default
//   "System (backfill script)" label:
//     npm run backfill:order-stock -- --by="Caleb Opule" ORD-16489547-386

import prisma from "../src/config/database";
import { log as logActivity } from "../src/utils/activityLogger";

const REASON =
  "Backfilled — stock deduction was missed at checkout time due to a site issue";

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const allMissing = args.includes("--all-missing");
  const byArg = args.find((a) => a.startsWith("--by="));
  const performedByName = byArg
    ? byArg.slice("--by=".length)
    : "System (backfill script)";
  const orderIdentifiers = args.filter(
    (a) => !a.startsWith("--") && a.trim().length > 0,
  );

  if (!allMissing && orderIdentifiers.length === 0) {
    console.error(
      "Usage: backfill-order-stock [--dry-run] [--by=\"Name\"] <orderNumber...>\n" +
        "   or: backfill-order-stock [--dry-run] --all-missing",
    );
    process.exitCode = 1;
    return;
  }

  console.log(
    dryRun
      ? "🔍 DRY RUN — no changes will be written.\n"
      : "⚙️  Running backfill (changes WILL be written).\n",
  );

  let orders;
  if (allMissing) {
    orders = await prisma.order.findMany({
      where: { paymentStatus: "PAID", stockDeducted: false },
      include: { items: true },
      orderBy: { createdAt: "asc" },
    });
    console.log(
      `Found ${orders.length} paid order(s) with stock not yet deducted.\n`,
    );
  } else {
    orders = await prisma.order.findMany({
      where: {
        OR: orderIdentifiers.flatMap((v) => [
          { orderNumber: v },
          ...(v.match(/^[0-9a-fA-F]{24}$/) ? [{ id: v }] : []),
        ]),
      },
      include: { items: true },
    });
    const foundNumbers = new Set(orders.map((o) => o.orderNumber));
    for (const id of orderIdentifiers) {
      if (!foundNumbers.has(id) && !orders.some((o) => o.id === id)) {
        console.warn(`  ⚠️  No order found matching "${id}" — skipping.`);
      }
    }
  }

  if (orders.length === 0) {
    console.log("Nothing to do.");
    return;
  }

  let processed = 0;
  let skipped = 0;

  for (const order of orders) {
    if (order.stockDeducted) {
      console.log(
        `  ⏭  ${order.orderNumber} — already deducted, skipping.`,
      );
      skipped++;
      continue;
    }
    if (order.paymentStatus !== "PAID") {
      console.log(
        `  ⏭  ${order.orderNumber} — payment status is ${order.paymentStatus}, not PAID. ` +
          `Skipping (use a different order if this needs stock deducted anyway).`,
      );
      skipped++;
      continue;
    }

    const saleTimestamp = order.paidAt || order.createdAt;
    console.log(
      `  ▶ ${order.orderNumber} — ${order.items.length} item line(s), ` +
        `sale time ${saleTimestamp.toISOString()}`,
    );

    const products = await prisma.product.findMany({
      where: { id: { in: order.items.map((i) => i.productId) } },
      select: { id: true, name: true, trackInventory: true, stockQuantity: true },
    });
    const productMap = new Map(products.map((p) => [p.id, p]));

    const lineSummaries: string[] = [];

    if (!dryRun) {
      await prisma.$transaction(
        async (tx) => {
          // BUG FIX (P2034 "write conflict or deadlock"): a MongoDB
          // transaction runs on a single server-side session, and that
          // session can only process one operation at a time — issuing
          // several writes concurrently via Promise.all() within the same
          // transaction (even against completely different documents)
          // makes the driver send overlapping commands on that one
          // session, which MongoDB correctly rejects as a conflict. Unlike
          // a traditional SQL transaction, there's no parallelism to be
          // had here — every write in the transaction has to be awaited
          // one at a time, sequentially.
          for (const item of order.items) {
            const product = productMap.get(item.productId);
            if (!product) {
              lineSummaries.push(
                `      ⚠️  Product ${item.productId} (${item.productName ?? "unknown"}) no longer exists — skipped this line.`,
              );
              continue;
            }
            if (!product.trackInventory) {
              lineSummaries.push(
                `      · ${product.name}: not stock-tracked, no change`,
              );
              continue;
            }

            const previousQty = product.stockQuantity;
            const newQty = previousQty - item.quantity;

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
                type: "ONLINE_SALE",
                quantity: -item.quantity,
                previousQty,
                newQty,
                reason: REASON,
                reference: order.orderNumber,
                performedByName,
                // Backdated so the Stock Movement report reflects when
                // the sale actually happened, not when this script ran.
                createdAt: saleTimestamp,
              },
            });

            lineSummaries.push(
              `      · ${product.name}: ${previousQty} → ${newQty} (-${item.quantity})` +
                (newQty < 0
                  ? "  ⚠️  went negative — reconcile physical stock"
                  : ""),
            );
          }

          await tx.order.update({
            where: { id: order.id },
            data: { stockDeducted: true },
          });
        },
        // Prisma's interactive-transaction default is a 5s timeout, which
        // is fine for the live payment-confirmation path (1-2 items) but
        // not for a backfill that might touch a dozen-plus line items,
        // each requiring two sequential round trips (see the sequential-
        // writes note above — this can't be parallelized on MongoDB). 60s
        // is generous headroom even for a very large order.
        { timeout: 60_000, maxWait: 10_000 },
      );

      logActivity({
        action: "backfill order stock",
        entity: "order",
        entityId: order.id,
        metadata: {
          orderNumber: order.orderNumber,
          reason: REASON,
          performedByName,
          originalSaleTimestamp: saleTimestamp.toISOString(),
          backfilledAt: new Date().toISOString(),
          itemCount: order.items.length,
          totalQuantity: order.items.reduce((s, i) => s + i.quantity, 0),
        },
      });
    } else {
      // Dry run — compute what WOULD happen without writing anything.
      for (const item of order.items) {
        const product = productMap.get(item.productId);
        if (!product) {
          lineSummaries.push(
            `      ⚠️  Product ${item.productId} no longer exists — would skip`,
          );
          continue;
        }
        if (!product.trackInventory) {
          lineSummaries.push(
            `      · ${product.name}: not stock-tracked, no change`,
          );
          continue;
        }
        const newQty = product.stockQuantity - item.quantity;
        lineSummaries.push(
          `      · ${product.name}: ${product.stockQuantity} → ${newQty} (-${item.quantity})` +
            (newQty < 0 ? "  ⚠️  would go negative" : ""),
        );
      }
    }

    lineSummaries.forEach((l) => console.log(l));
    processed++;
  }

  console.log(
    `\n${dryRun ? "Would process" : "Processed"} ${processed} order(s), skipped ${skipped}.`,
  );
  if (dryRun) {
    console.log("Re-run without --dry-run to actually write these changes.");
  }
}

main()
  .catch((err) => {
    console.error("❌ Failed:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
