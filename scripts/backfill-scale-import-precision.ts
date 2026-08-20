// backend/scripts/backfill-scale-import-precision.ts
//
// WHY THIS SCRIPT EXISTS
// ────────────────────────────────────────────────────────────────────────
// The scale-goods importer (SCALE_GOODS.xlsx via /export/products/import-
// scale-goods) used to default new products to scaleStep: 0.1 — coarser
// than the CECON scale actually supports (it weighs down to the gram).
// That default has since been changed to 0.001 in the importer itself, but
// that only affects NEW imports going forward — every product the OLD
// default already created is stuck at the coarser 0.1 step (and whatever
// minOrderQty it was left at) until someone fixes it by hand, one product
// at a time.
//
// This is a one-time repair: it sets scaleStep AND minOrderQty to 0.001 on
// every product that came through the scale-goods import system —
// identified by having a scaleWareCode set (the one field only that
// importer ever populates; a manually-created product would only have
// this set if an admin deliberately typed in the scale's own item code by
// hand, which this script treats the same way — if it's linked to a
// physical CECON scale, 0.001 precision is the correct step for it too).
//
// This OVERWRITES scaleStep and minOrderQty unconditionally on every
// matching product, even ones an admin may have already customized to a
// different value on purpose — that's what was asked for. Review the
// dry-run output before applying if you're not sure a product's current
// values are all still meant to be the old coarser default.
//
// USAGE
// ────────────────────────────────────────────────────────────────────────
//   Preview what would change (always do this first):
//     npm run backfill:scale-import-precision -- --dry-run
//
//   Apply it:
//     npm run backfill:scale-import-precision
//
// Products with scaleWareCode set but isScalable: false are skipped and
// listed separately — that's the OTHER known bug (see
// backfill-scalable-flag.ts), fix that one first, then re-run this.

import prisma from "../src/config/database";

const NEW_STEP = 0.001;
const NEW_MIN_ORDER_QTY = 0.001;

async function main() {
  const dryRun = process.argv.includes("--dry-run");

  console.log(
    dryRun
      ? "🔍 DRY RUN — no changes will be written.\n"
      : "⚙️  Running backfill (changes WILL be written).\n",
  );

  const scaleImported = await prisma.product.findMany({
    where: { scaleWareCode: { not: null } },
    select: {
      id: true,
      name: true,
      sku: true,
      scaleWareCode: true,
      isScalable: true,
      scaleStep: true,
      minOrderQty: true,
    },
    orderBy: { name: "asc" },
  });

  if (scaleImported.length === 0) {
    console.log("Nothing to update — no products have a Scale Ware Code set.");
    return;
  }

  const eligible = scaleImported.filter((p) => p.isScalable);
  const notScalable = scaleImported.filter((p) => !p.isScalable);

  console.log(
    `Found ${scaleImported.length} product(s) with a Scale Ware Code set ` +
      `(${eligible.length} eligible, ${notScalable.length} skipped):\n`,
  );

  for (const p of eligible) {
    console.log(
      `  ${p.sku}  "${p.name}"  ` +
        `scaleStep: ${p.scaleStep ?? "—"} → ${NEW_STEP}, ` +
        `minOrderQty: ${p.minOrderQty ?? "—"} → ${NEW_MIN_ORDER_QTY}`,
    );
  }

  if (notScalable.length > 0) {
    console.log(
      `\n⏭  Skipped ${notScalable.length} product(s) with a Scale Ware Code but isScalable: false ` +
        `(run "npm run backfill:scalable-flag" first, then re-run this):`,
    );
    for (const p of notScalable) {
      console.log(`   ${p.sku}  "${p.name}"`);
    }
  }

  if (eligible.length === 0) {
    console.log("\nNothing eligible to update.");
    return;
  }

  if (dryRun) {
    console.log(
      `\nDry run only — ${eligible.length} product(s) would be updated. Re-run without --dry-run to apply.`,
    );
    return;
  }

  const result = await prisma.product.updateMany({
    where: { id: { in: eligible.map((p) => p.id) } },
    data: { scaleStep: NEW_STEP, minOrderQty: NEW_MIN_ORDER_QTY },
  });

  console.log(
    `\n✅ Updated ${result.count} product(s) — scaleStep and minOrderQty are now ${NEW_STEP}.`,
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
