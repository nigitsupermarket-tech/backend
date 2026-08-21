// backend/scripts/backfill-scale-shipping-weight.ts
//
// WHY THIS SCRIPT EXISTS
// ────────────────────────────────────────────────────────────────────────
// Product.weight (shipping weight, kg — used to calculate table-rate
// shipping on online orders) is a REQUIRED field on the "Add Product"
// form. For a kg/g/lb scalable product it auto-fills to 1 on save if
// empty — but a React stale-closure bug meant that auto-fill didn't
// actually make it into the SAME save that triggered it (see the fix in
// product-form.tsx's handleSave), and separately, the scale-goods
// importer never set `weight` at creation at all. Combined, every
// product created by a scale import launched with weight: null and would
// silently fail to persist a fix for it on the very first edit — which
// is exactly what "I edited this product but the change isn't showing"
// looks like from the admin side.
//
// Both root causes are now fixed in code (the importer sets weight: 1 on
// every new row; the stale-closure bug no longer drops the auto-filled
// value). This is a one-time repair for products that already exist with
// weight still unset from before those fixes.
//
// USAGE
// ────────────────────────────────────────────────────────────────────────
//   Preview what would change (always do this first):
//     npm run backfill:scale-shipping-weight -- --dry-run
//
//   Apply it:
//     npm run backfill:scale-shipping-weight
//
// Sets weight: 1 (1kg shipped per 1kg/g/lb ordered — the sane default for
// any weight-sold item) on every product with a Scale Ware Code set
// (same targeting as the other scale-import backfill scripts) that
// currently has no weight at all. A product that already has SOME weight
// value — even if it's not 1 — is left alone; that's a deliberate choice
// someone made, not the same gap this is fixing.

import prisma from "../src/config/database";

async function main() {
  const dryRun = process.argv.includes("--dry-run");

  console.log(
    dryRun
      ? "🔍 DRY RUN — no changes will be written.\n"
      : "⚙️  Running backfill (changes WILL be written).\n",
  );

  const candidates = await prisma.product.findMany({
    where: { scaleWareCode: { not: null }, weight: null },
    select: {
      id: true,
      name: true,
      sku: true,
      scaleWareCode: true,
      scaleUnit: true,
    },
    orderBy: { name: "asc" },
  });

  if (candidates.length === 0) {
    console.log(
      "Nothing to fix — every scale-imported product already has a shipping weight set.",
    );
    return;
  }

  console.log(
    `Found ${candidates.length} scale-imported product(s) with no shipping weight set ` +
      `(this was blocking their first edit from fully saving):\n`,
  );
  for (const p of candidates) {
    console.log(`  ${p.sku}  "${p.name}"  [unit: ${p.scaleUnit ?? "—"}]`);
  }

  if (dryRun) {
    console.log(
      `\nDry run only — ${candidates.length} product(s) would be updated. Re-run without --dry-run to apply.`,
    );
    return;
  }

  const result = await prisma.product.updateMany({
    where: { id: { in: candidates.map((p) => p.id) } },
    data: { weight: 1 },
  });

  console.log(
    `\n✅ Updated ${result.count} product(s) — shipping weight is now 1 (kg per unit ordered).`,
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
