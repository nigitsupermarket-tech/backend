// backend/scripts/backfill-scalable-flag.ts
//
// WHY THIS SCRIPT EXISTS
// ────────────────────────────────────────────────────────────────────────
// Two separate bugs (both now fixed in code) could leave a product with
// its scale/weight details fully configured — scaleUnit, pricePerUnit,
// scaleStep, minOrderQty, or scaleWareCode all set — while `isScalable`
// itself stayed `false`:
//
//   1. CSV import parsed every boolean column with an exact-match
//      `row.isScalable === "true"` — so a cell that came back from Excel
//      as "TRUE" (its default capitalization for a recognized boolean),
//      or with stray whitespace, silently read as false while the other
//      scale columns in the same row still applied normally.
//   2. The CECON scale-sheet importer (SCALE_GOODS.xlsx) didn't set
//      isScalable at all in an earlier version — every product it
//      created needed the checkbox turned on by hand afterward.
//
// The practical symptom: a product's edit screen shows correct
// unit/price/step, the scale prints a barcode for it, but scanning that
// barcode at POS fails with "isn't marked as a scalable product" — even
// though it plainly is, everywhere except that one flag.
//
// This is a one-time repair for products already stuck in that state.
// New imports don't need it once export.controller.ts's parseCsvBool fix
// and the scale-importer's isScalable:true are both deployed.
//
// USAGE
// ────────────────────────────────────────────────────────────────────────
//   Preview what would change (always do this first):
//     npm run backfill:scalable-flag -- --dry-run
//
//   Apply it:
//     npm run backfill:scalable-flag
//
// A product only qualifies if isScalable is currently false AND it shows
// clear scalable intent — scaleWareCode set, OR scaleUnit set, OR
// pricePerUnit set. A product with none of those is left alone; there's
// nothing to reasonably infer for it.

import prisma from "../src/config/database";

async function main() {
  const dryRun = process.argv.includes("--dry-run");

  console.log(
    dryRun
      ? "🔍 DRY RUN — no changes will be written.\n"
      : "⚙️  Running backfill (changes WILL be written).\n",
  );

  const candidates = await prisma.product.findMany({
    where: {
      isScalable: false,
      OR: [
        { scaleWareCode: { not: null } },
        { scaleUnit: { not: null } },
        { pricePerUnit: { not: null } },
      ],
    },
    select: {
      id: true,
      name: true,
      sku: true,
      scaleWareCode: true,
      scaleUnit: true,
      pricePerUnit: true,
      scaleStep: true,
    },
  });

  if (candidates.length === 0) {
    console.log("Nothing to fix — no products match.");
    return;
  }

  console.log(
    `Found ${candidates.length} product(s) with scale details set but isScalable: false:\n`,
  );
  for (const p of candidates) {
    console.log(
      `  ${p.sku}  "${p.name}"  ` +
        `[unit=${p.scaleUnit ?? "—"}, pricePerUnit=${p.pricePerUnit ?? "—"}, ` +
        `scaleStep=${p.scaleStep ?? "—"}, scaleWareCode=${p.scaleWareCode ?? "—"}]`,
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
    data: { isScalable: true },
  });

  console.log(
    `\n✅ Updated ${result.count} product(s) — isScalable is now true.`,
  );
  console.log(
    "Note: this only sets the flag. If any of these also need a scaleUnit,",
  );
  console.log(
    "pricePerUnit, or scaleStep value and don't have one, edit them individually.",
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
