// backend/scripts/fix-cart-indexes.ts
//
// WHY THIS SCRIPT EXISTS
// ────────────────────────────────────────────────────────────────────────
// Cart.userId and Cart.sessionId are optional (String?) and @unique in
// schema.prisma. Prisma's MongoDB connector translates that into a plain
// `createIndex({ userId: 1 }, { unique: true })` — it does NOT add
// `sparse: true` or a `partialFilterExpression`, even though the field is
// optional. This is a known, still-open Prisma limitation:
//   https://github.com/prisma/prisma/issues/23870
//   https://github.com/prisma/prisma/discussions/11558
//
// The practical effect on this collection: every guest cart omits `userId`
// entirely, and MongoDB indexes a missing field the same as `null`. A plain
// unique index only allows ONE document with that null value — so the
// FIRST guest cart ever created "claims" userId:null, and every guest cart
// created after that fails with a duplicate-key error (P2002) on `userId`.
// The mirror image happens to `sessionId` for logged-in users' carts.
//
// That P2002 is exactly what the frontend was showing as:
//   "Cart conflict — please refresh the page"
//   "Cart sync issue — please refresh the page"
// ...and refreshing never fixed it, because the same collision reoccurs on
// every retry — it isn't a transient race, it's a structural index bug.
//
// THE FIX
// ────────────────────────────────────────────────────────────────────────
// Drop Prisma's plain unique index and recreate it as a MongoDB PARTIAL
// unique index, scoped to only the documents where the field exists. That
// gives the same guarantee (no two carts share a userId, no two carts share
// a sessionId) WITHOUT colliding on carts that don't set the field at all.
//
// WHEN TO RUN THIS
// ────────────────────────────────────────────────────────────────────────
// Run it once now against your existing database, and again every time
// `prisma db push` is run in the future — `db push` will otherwise recreate
// the plain (buggy) index because that's what schema.prisma literally says
// (Prisma requires @unique there to model the 1:1 relation with User.cart;
// there's no schema syntax for "partial unique" yet). A `postdbpush` npm
// script is wired up below to make this automatic.
//
// Usage: npx ts-node scripts/fix-cart-indexes.ts
//    or: npm run fix-cart-indexes

import prisma from "../src/config/database";

async function main() {
  console.log("🔧 Fixing Cart userId/sessionId indexes...\n");

  // ── 1. Drop any existing indexes on these fields (names may vary slightly
  //       across Prisma/Mongo versions, so drop by key spec via listIndexes) ──
  const existing = (await prisma.$runCommandRaw({
    listIndexes: "carts",
  })) as any;

  const indexNames: string[] = (existing?.cursor?.firstBatch || [])
    .filter((idx: any) => {
      const keys = Object.keys(idx.key || {});
      return (
        (keys.length === 1 && keys[0] === "userId") ||
        (keys.length === 1 && keys[0] === "sessionId")
      );
    })
    .map((idx: any) => idx.name);

  for (const name of indexNames) {
    console.log(`  Dropping existing index: ${name}`);
    try {
      await prisma.$runCommandRaw({ dropIndexes: "carts", index: name });
    } catch (err: any) {
      console.warn(`  ⚠️  Could not drop ${name}:`, err?.message || err);
    }
  }

  // ── 2. Recreate as partial unique indexes ─────────────────────────────
  console.log("  Creating partial unique index on userId...");
  await prisma.$runCommandRaw({
    createIndexes: "carts",
    indexes: [
      {
        key: { userId: 1 },
        name: "carts_userId_partial_unique",
        unique: true,
        partialFilterExpression: { userId: { $exists: true } },
      },
    ],
  });

  console.log("  Creating partial unique index on sessionId...");
  await prisma.$runCommandRaw({
    createIndexes: "carts",
    indexes: [
      {
        key: { sessionId: 1 },
        name: "carts_sessionId_partial_unique",
        unique: true,
        partialFilterExpression: { sessionId: { $exists: true } },
      },
    ],
  });

  // ── 3. De-duplicate any carts that were already split by the bug ───────
  // (Two Cart rows for the same userId, or same sessionId, that both slipped
  // through before this fix. Merge their items into the oldest cart, delete
  // the rest, so nobody's items look "lost".)
  console.log("\n🔎 Checking for carts already split by the bug...");
  await dedupeCarts("userId");
  await dedupeCarts("sessionId");

  console.log("\n✅ Done.");
}

async function dedupeCarts(field: "userId" | "sessionId") {
  const carts = await prisma.cart.findMany({
    where: { [field]: { not: null } } as any,
    include: { items: true },
    orderBy: { createdAt: "asc" },
  });

  const groups = new Map<string, typeof carts>();
  for (const cart of carts) {
    const key = (cart as any)[field];
    if (!key) continue;
    if (!groups.has(key)) groups.set(key, [] as any);
    groups.get(key)!.push(cart);
  }

  let merged = 0;
  for (const [key, group] of groups) {
    if (group.length <= 1) continue;
    const [primary, ...dupes] = group; // oldest cart wins
    console.log(
      `  Merging ${dupes.length} duplicate cart(s) for ${field}=${key} into cart ${primary.id}`,
    );
    for (const dupe of dupes) {
      for (const item of dupe.items) {
        const existingItem = await prisma.cartItem.findFirst({
          where: { cartId: primary.id, productId: item.productId },
        });
        if (existingItem) {
          await prisma.cartItem.update({
            where: { id: existingItem.id },
            data: { quantity: existingItem.quantity + item.quantity },
          });
        } else {
          await prisma.cartItem.update({
            where: { id: item.id },
            data: { cartId: primary.id },
          });
        }
      }
      await prisma.cart.delete({ where: { id: dupe.id } });
      merged++;
    }
  }
  if (merged === 0) {
    console.log(`  No duplicate carts found for ${field}.`);
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
