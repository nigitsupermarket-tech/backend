// backend/scripts/backfill-pending-delete-flag.ts
//
// WHY THIS SCRIPT EXISTS
// ────────────────────────────────────────────────────────────────────────
// The Product model just gained a required field, `pendingDeleteRequest
// Boolean @default(false)`, as part of the hard-delete approval workflow
// (see requestProductDelete/rejectProductDeleteRequest in
// product.controller.ts). Prisma's `@default(...)` only applies when a
// NEW document is created — it is never backfilled onto documents that
// already existed in MongoDB before the field was added to the schema.
//
// The practical symptom: every product created before this migration is
// entirely missing the `pendingDeleteRequest` key in its raw MongoDB
// document. Because the field is declared as required (non-optional) in
// the Prisma schema, Prisma can't cleanly deserialize those documents
// against the schema when reading them back — the visible effect is
// products silently vanishing from listings (POS grid, storefront, the
// admin product list, "no products found" everywhere), not an error.
//
// This is a one-time repair: explicitly write `pendingDeleteRequest:
// false` onto every product that doesn't already have the field set, so
// every document matches the schema's expectations going forward. New
// products created after this migration already get it correctly via
// the schema default — this script only needs to run once.
//
// USAGE
// ────────────────────────────────────────────────────────────────────────
//   Preview what would change (always do this first):
//     npm run backfill:pending-delete-flag -- --dry-run
//
//   Apply it:
//     npm run backfill:pending-delete-flag

import prisma from "../src/config/database";

async function main() {
  const dryRun = process.argv.includes("--dry-run");

  console.log(
    dryRun
      ? "🔍 DRY RUN — no changes will be written.\n"
      : "⚙️  Running backfill (changes WILL be written).\n",
  );

  // Raw driver access, not the typed Prisma client — we specifically need
  // to find documents where the key is ENTIRELY ABSENT (not just false),
  // which `$exists: false` expresses cleanly. The typed client's filter
  // types assume the field is always present (it's required in the
  // schema now), so they can't express "field missing" the same way.
  const raw = await prisma.$runCommandRaw({
    find: "products",
    filter: { pendingDeleteRequest: { $exists: false } },
    projection: { _id: 1, name: 1, sku: 1 },
    limit: 100000,
  });
  const missing = ((raw as any)?.cursor?.firstBatch ?? []) as {
    _id: { $oid: string };
    name: string;
    sku: string;
  }[];

  if (missing.length === 0) {
    console.log("Nothing to fix — every product already has the field set.");
    return;
  }

  console.log(
    `Found ${missing.length} product(s) missing pendingDeleteRequest entirely:\n`,
  );
  for (const p of missing.slice(0, 20)) {
    console.log(`  ${p.sku}  "${p.name}"`);
  }
  if (missing.length > 20) {
    console.log(`  ...and ${missing.length - 20} more`);
  }

  if (dryRun) {
    console.log(
      `\nDry run only — ${missing.length} product(s) would be updated. Re-run without --dry-run to apply.`,
    );
    return;
  }

  const result = await prisma.$runCommandRaw({
    update: "products",
    updates: [
      {
        q: { pendingDeleteRequest: { $exists: false } },
        u: { $set: { pendingDeleteRequest: false } },
        multi: true,
      },
    ],
  });

  console.log(
    `\n✅ Updated ${(result as any).nModified ?? (result as any).n ?? missing.length} product(s) — pendingDeleteRequest is now explicitly false.`,
  );
  console.log(
    "Products should reappear immediately in the POS grid, storefront, and admin list.",
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
