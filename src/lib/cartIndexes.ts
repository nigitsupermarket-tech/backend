// backend/src/lib/cartIndexes.ts
//
// Cart.userId / Cart.sessionId are optional + @unique in schema.prisma.
// Prisma's MongoDB connector turns that into a PLAIN unique index, which
// treats a missing field as null — so only ONE guest cart (no userId) and
// ONE user cart (no sessionId) can ever exist. Every cart after that fails
// with P2002, which the UI shows as "Cart sync issue — please refresh".
//
// `prisma db push` re-creates that plain index whenever it runs, so a
// one-off fix does not stay fixed. This module makes the repair idempotent
// and callable from both the CLI script and the running API (self-heal).

import prisma from "../config/database";

const PARTIAL_INDEXES = [
  {
    field: "userId",
    name: "carts_userId_partial_unique",
    // $type (not $exists) so an explicit null is also excluded.
    filter: { userId: { $type: "objectId" } },
  },
  {
    field: "sessionId",
    name: "carts_sessionId_partial_unique",
    filter: { sessionId: { $type: "string" } },
  },
] as const;

let repairing: Promise<boolean> | null = null;

/**
 * Drops any non-partial unique index on carts.userId / carts.sessionId and
 * creates partial ones. Returns true if anything was changed.
 * Safe to call repeatedly and concurrently.
 */
export function repairCartIndexes(): Promise<boolean> {
  if (!repairing) {
    repairing = doRepair().finally(() => {
      repairing = null;
    });
  }
  return repairing;
}

async function doRepair(): Promise<boolean> {
  let changed = false;

  const listed = (await prisma.$runCommandRaw({
    listIndexes: "carts",
  })) as any;
  const indexes: any[] = listed?.cursor?.firstBatch ?? [];

  for (const spec of PARTIAL_INDEXES) {
    const forField = indexes.filter((idx) => {
      const keys = Object.keys(idx.key || {});
      return keys.length === 1 && keys[0] === spec.field;
    });

    // Drop every index on this field that is not already our partial one.
    for (const idx of forField) {
      if (idx.name === spec.name && idx.partialFilterExpression) continue;
      try {
        await prisma.$runCommandRaw({ dropIndexes: "carts", index: idx.name });
        changed = true;
      } catch (err: any) {
        console.warn(`[cartIndexes] could not drop ${idx.name}:`, err?.message);
      }
    }

    const hasGood = forField.some(
      (idx) => idx.name === spec.name && idx.partialFilterExpression,
    );
    if (!hasGood) {
      await prisma.$runCommandRaw({
        createIndexes: "carts",
        indexes: [
          {
            key: { [spec.field]: 1 },
            name: spec.name,
            unique: true,
            partialFilterExpression: spec.filter,
          },
        ],
      });
      changed = true;
    }
  }

  if (changed) console.log("[cartIndexes] cart indexes repaired");
  return changed;
}
