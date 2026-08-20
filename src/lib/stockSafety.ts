// backend/src/lib/stockSafety.ts
//
// Shared by orderStock.ts (online orders) and pos.controller.ts (POS
// sales) — anywhere stock actually gets decremented at the moment of a
// confirmed sale, not just checked ahead of time.
//
// ── The problem ───────────────────────────────────────────────────────────
// Stock is checked before a sale, but the check and the write aren't the
// same instant. An online order sits "pending payment" for minutes before
// deduction happens; even POS's single-transaction checkout has a window
// between two concurrent terminals both reading, then both writing, the
// same product. A plain unconditional `{ decrement: quantity }` doesn't
// care what the CURRENT value is when it applies, so two sales racing on
// the last of an item can both "succeed" and push stock negative with
// nothing to show for why.
//
// ── The fix — two parts ─────────────────────────────────────────────────
// 1. Every decrement is done via `updateMany` with a `stockQuantity: {
//    gte: quantity }` guard in the WHERE clause, so MongoDB only applies
//    it if that document still has enough stock at write time. Losing
//    that race comes back as `count: 0` instead of a negative number.
// 2. Because these decrements run inside Prisma interactive transactions
//    (multi-document, snapshot-isolated), two truly concurrent
//    transactions don't see each other's writes mid-flight the way #1
//    alone would assume — instead MongoDB aborts the second one with a
//    write-conflict error (Prisma code P2034). `runWithRetry` below
//    catches exactly that and re-runs the whole transaction callback from
//    scratch; on retry it gets a fresh snapshot that DOES see the other
//    transaction's committed write, so the `gte` guard then correctly
//    decides whether stock is still available.
//
// A sale that's already been paid for can't be un-sold just because stock
// ran out — there's no stock left to "reject" it with. So a losing
// decrement is floored at 0, logged as a distinctly-typed "OVERSOLD"
// InventoryLog entry recording the shortfall, and summarized to admins in
// one email via `notifyOversold` — a visible, actionable event instead of
// a silent negative number nobody notices until a physical count is short.
import prisma from "../config/database";
import { Prisma } from "@prisma/client";
import { sendAdminStockNotificationEmail } from "../services/email.service";

export async function runWithRetry<T>(
  fn: () => Promise<T>,
  attempts = 5,
): Promise<T> {
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      const isWriteConflict =
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === "P2034";
      if (!isWriteConflict || i === attempts - 1) throw err;
      // Small jittered backoff so a burst of racing sales doesn't just
      // immediately re-collide on the retry too.
      await new Promise((r) => setTimeout(r, 30 + Math.random() * 70));
    }
  }
  // Unreachable — the loop always returns or throws — but keeps TS happy.
  throw new Error("runWithRetry: exhausted attempts without resolving");
}

export interface OversoldEvent {
  productId: string;
  productName: string;
  sku: string;
  shortfall: number;
  unit: string;
  variationLabel?: string | null;
  reference: string; // order number or POS order number
  channel: "ONLINE_ORDER" | "POS";
}

export async function notifyOversold(events: OversoldEvent[]): Promise<void> {
  if (events.length === 0) return;
  try {
    const cfg = await prisma.siteSetting.findFirst();
    const adminEmails: string[] = (cfg as any)?.adminNotificationEmails ?? [];
    if (adminEmails.length === 0) return;
    await Promise.allSettled(
      events.map((e) =>
        sendAdminStockNotificationEmail(adminEmails, {
          productName: `⚠ OVERSOLD: ${e.productName}${e.variationLabel ? ` — ${e.variationLabel}` : ""}`,
          productSku: e.sku,
          requestedBy: "System",
          requestedByRole: "AUTOMATED",
          currentQty: 0,
          requestedQty: 0,
          reason: `${e.channel === "POS" ? "POS sale" : "Online order"} ${e.reference} was confirmed, but only enough stock for a shortfall of ${e.shortfall} ${e.unit} was actually available at deduction time (likely raced another sale on the same item). Stock has been floored at 0 — this needs manual review: restock, contact the customer, or refund.`,
          source: e.channel,
          autoApproved: true,
        }),
      ),
    );
  } catch (err) {
    console.error("[stockSafety] oversold notification failed:", err);
  }
}
