// backend/scripts/backfill-scale-track-inventory.ts
//
// WHY THIS SCRIPT EXISTS
// ────────────────────────────────────────────────────────────────────────
// Reported symptom: a scale-imported product's stock never moves after a
// confirmed POS sale — the sale completes normally, a real receipt
// prints, payment is recorded, but the product's stockQuantity is
// unchanged afterward.
//
// The stock-deduction transaction (pos.controller.ts createPOSOrder)
// deliberately SKIPS any line item whose product has trackInventory:
// false — that's correct behavior for a product that's genuinely not
// meant to be stock-tracked (e.g. a made-to-order item), but for a
// physical, scale-weighed good it's never what's actually wanted, and
// there's no error or warning when it happens — the sale just quietly
// doesn't touch stock, which is very easy not to notice until a physical
// count comes up short.
//
// This finds every product with a Scale Ware Code set (the reliable
// marker of "came through the scale-goods import system" — see
// backfill-scale-import-precision.ts for the same targeting logic) where
// trackInventory is currently false, and turns it back on. The importer
// itself has also been updated to set trackInventory: true explicitly on
// every new row going forward, rather than relying on the schema default
// — this script is only for products that already exist.
//
// USAGE
// ────────────────────────────────────────────────────────────────────────
//   Preview what would change (always do this first):
//     npm run backfill:scale-track-inventory -- --dry-run
//
//   Apply it:
//     npm run backfill:scale-track-inventory

import prisma from "../src/config/database";

async function main() {
  const dryRun = process.argv.includes("--dry-run");

  console.log(
    dryRun
      ? "🔍 DRY RUN — no changes will be written.\n"
      : "⚙️  Running backfill (changes WILL be written).\n",
  );

  const candidates = await prisma.product.findMany({
    where: { scaleWareCode: { not: null }, trackInventory: false },
    select: {
      id: true,
      name: true,
      sku: true,
      scaleWareCode: true,
      stockQuantity: true,
      status: true,
    },
    orderBy: { name: "asc" },
  });

  if (candidates.length === 0) {
    console.log(
      "Nothing to fix — no scale-imported product currently has trackInventory: false.",
    );
    return;
  }

  console.log(
    `Found ${candidates.length} scale-imported product(s) with trackInventory: false ` +
      `— sales for these have NOT been deducting stock:\n`,
  );
  for (const p of candidates) {
    console.log(
      `  ${p.sku}  "${p.name}"  ` +
        `[current stock: ${p.stockQuantity}, status: ${p.status}, scaleWareCode: ${p.scaleWareCode}]`,
    );
  }

  if (dryRun) {
    console.log(
      `\nDry run only — ${candidates.length} product(s) would be updated. Re-run without --dry-run to apply.`,
    );
    return;
  }

  const result = await prisma.product.updateMany({
    where: { id: { in: candidates.map((p) => p.id) } },
    data: { trackInventory: true },
  });

  console.log(
    `\n✅ Updated ${result.count} product(s) — trackInventory is now true.`,
  );
  console.log(
    "Note: this doesn't retroactively deduct stock for sales that already",
  );
  console.log(
    "happened while tracking was off — if any of these products sold units",
  );
  console.log(
    "during that window, their stockQuantity is still overstated by that",
  );
  console.log("amount and needs a manual stock adjustment to correct.");
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
