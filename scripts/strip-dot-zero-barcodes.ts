// backend/scripts/strip-dot-zero-barcodes.ts
//
// WHY THIS SCRIPT EXISTS
// ────────────────────────────────────────────────────────────────────────
// Spreadsheet imports stored barcodes like "8000810101937.00" instead of
// "8000810101937". A scanner reads the second form, every lookup is an exact
// match, so those products could never be scanned at POS.
//
// The code now normalizes barcodes on every write and lookup
// (src/utils/barcode.ts). This is the one-time repair for rows that were
// ALREADY saved with the ".00" (or ".0", ".000" …) suffix — on both
// Product.barcode and ProductVariation.barcode.
//
// SAFETY
// ────────────────────────────────────────────────────────────────────────
//  • Dry run by default. Nothing is written unless you pass --apply.
//  • Never creates a duplicate: if stripping would collide with a barcode
//    that is already in use (or with another row being fixed), that row is
//    skipped and listed so you can decide by hand.
//  • Only touches the "digits + .00" pattern. Other odd barcodes (a leading
//    backtick, letters, spaces) are LISTED but never modified.
//  • Before writing, saves every old → new value to
//    scripts/barcode-cleanup-backup-<timestamp>.json so it can be reversed.
//  • Idempotent — running it again after a successful run finds nothing.
//  • Historical sale/receipt snapshots (POSOrderItem.barcode) are left
//    alone on purpose; they record what was on the item at the time.
//
// USAGE
// ────────────────────────────────────────────────────────────────────────
//   Preview (always first):   npm run cleanup:dot-zero-barcodes
//   Apply:                    npm run cleanup:dot-zero-barcodes -- --apply

import fs from "fs";
import path from "path";
import prisma from "../src/config/database";
import { planBarcodeCleanup } from "../src/utils/barcode";

type Kind = "product" | "variation";

async function main() {
  const apply = process.argv.includes("--apply");
  console.log(
    apply
      ? "⚙️  APPLY mode — changes WILL be written.\n"
      : "🔍 DRY RUN — nothing will be written. Re-run with --apply to fix.\n",
  );

  const [products, variations] = await Promise.all([
    prisma.product.findMany({
      where: { barcode: { not: null } },
      select: { id: true, sku: true, name: true, barcode: true },
    }),
    prisma.productVariation.findMany({
      where: { barcode: { not: null } },
      select: { id: true, label: true, barcode: true, productId: true },
    }),
  ]);

  // One combined pool so a product and a variation can't both end up with
  // the same barcode after the fix.
  const labels = new Map<string, string>();
  const records = [
    ...products.map((p) => {
      labels.set(`product:${p.id}`, `product ${p.sku} "${p.name}"`);
      return { id: `product:${p.id}`, barcode: p.barcode };
    }),
    ...variations.map((v) => {
      labels.set(`variation:${v.id}`, `variation "${v.label}" (product ${v.productId})`);
      return { id: `variation:${v.id}`, barcode: v.barcode };
    }),
  ];
  const existing = new Set(records.map((r) => r.barcode!.trim()));

  const plan = planBarcodeCleanup(records, existing);

  console.log(
    `Scanned ${products.length} product barcode(s) and ${variations.length} variation barcode(s).\n`,
  );
  console.log(`Fixable: ${plan.fixes.length}`);
  for (const f of plan.fixes) {
    console.log(`  ${labels.get(f.id)}:  ${f.from}  →  ${f.to}`);
  }

  if (plan.collisions.length) {
    console.log(`\n⚠️  Skipped — would create a duplicate barcode (${plan.collisions.length}):`);
    for (const c of plan.collisions) {
      console.log(`  ${labels.get(c.id)}:  ${c.from}  (${c.reason})`);
    }
    console.log("  Resolve these by hand (decide which record owns the barcode).");
  }

  if (plan.suspicious.length) {
    console.log(`\nℹ️  Other unusual barcodes — NOT modified (${plan.suspicious.length}):`);
    for (const s of plan.suspicious) {
      console.log(`  ${labels.get(s.id)}:  ${JSON.stringify(s.barcode)}`);
    }
  }

  if (plan.fixes.length === 0) {
    console.log("\nNothing to fix.");
    return;
  }
  if (!apply) {
    console.log(`\nDry run only — ${plan.fixes.length} barcode(s) would be updated.`);
    return;
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupPath = path.join(__dirname, `barcode-cleanup-backup-${stamp}.json`);
  fs.writeFileSync(backupPath, JSON.stringify(plan.fixes, null, 2));
  console.log(`\n💾 Backup written: ${backupPath}`);

  let done = 0;
  let failed = 0;
  for (const f of plan.fixes) {
    const [kind, id] = f.id.split(":") as [Kind, string];
    try {
      if (kind === "product") {
        await prisma.product.update({ where: { id }, data: { barcode: f.to } });
      } else {
        await prisma.productVariation.update({ where: { id }, data: { barcode: f.to } });
      }
      done++;
    } catch (err) {
      failed++;
      console.error(`  ✗ ${labels.get(f.id)}: ${(err as Error).message}`);
    }
  }
  console.log(`\n✅ Updated ${done} barcode(s)${failed ? `, ${failed} failed (see above)` : ""}.`);
  console.log("POS terminals pick up the corrected barcodes on their next catalog sync.");
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
