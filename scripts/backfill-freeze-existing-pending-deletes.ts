// backend/scripts/backfill-freeze-existing-pending-deletes.ts
//
// WHY THIS SCRIPT EXISTS
// ────────────────────────────────────────────────────────────────────────
// Product.pendingDeleteRequest (the flag that hides a product from the
// storefront/POS while a hard-delete request is pending — see
// requestProductDelete in product.controller.ts) was added AFTER some
// delete requests were already submitted and sitting PENDING. Those
// earlier requests never had the chance to set the flag on their product
// — the code that does that didn't exist yet when they were created — so
// those specific products are still fully visible everywhere despite
// genuinely having a pending delete request against them, and don't show
// the "Deletion pending approval" label on the admin product list either.
//
// This is a one-time repair: for every ProductDeleteApprovalRequest still
// sitting at status PENDING, set pendingDeleteRequest: true on its
// product (if the product still exists). New requests going forward
// already set this correctly at creation time — this script only needs
// to run once, for requests that predate the flag.
//
// USAGE
// ────────────────────────────────────────────────────────────────────────
//   Preview what would change (always do this first):
//     npm run backfill:freeze-pending-deletes -- --dry-run
//
//   Apply it:
//     npm run backfill:freeze-pending-deletes

import prisma from "../src/config/database";

async function main() {
  const dryRun = process.argv.includes("--dry-run");

  console.log(
    dryRun
      ? "🔍 DRY RUN — no changes will be written.\n"
      : "⚙️  Running backfill (changes WILL be written).\n",
  );

  const pendingRequests = await prisma.productDeleteApprovalRequest.findMany({
    where: { status: "PENDING" },
    select: { id: true, productId: true, productName: true, productSku: true },
  });

  if (pendingRequests.length === 0) {
    console.log("Nothing to fix — no pending delete requests found.");
    return;
  }

  console.log(
    `Found ${pendingRequests.length} pending delete request(s):\n`,
  );
  for (const r of pendingRequests) {
    console.log(`  ${r.productSku}  "${r.productName}"`);
  }

  if (dryRun) {
    console.log(
      `\nDry run only — up to ${pendingRequests.length} product(s) would be flagged as frozen. Re-run without --dry-run to apply.`,
    );
    return;
  }

  const result = await prisma.product.updateMany({
    where: { id: { in: pendingRequests.map((r) => r.productId) } },
    data: { pendingDeleteRequest: true },
  });

  console.log(
    `\n✅ Flagged ${result.count} product(s) as pendingDeleteRequest: true.`,
  );
  if (result.count < pendingRequests.length) {
    console.log(
      `Note: ${pendingRequests.length - result.count} request(s) point at a product that no longer exists — skipped, nothing to flag.`,
    );
  }
  console.log(
    "These products should now show the 'Deletion pending approval' label on the admin list, and be hidden from the storefront/POS.",
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
