// backend/scripts/publish-scale-goods.ts
//
// WHY THIS SCRIPT EXISTS
// ────────────────────────────────────────────────────────────────────────
// The CECON scale's own PLU export (Merchandise → Export in mscale, e.g.
// SCALE_GOODS.xlsx) only has 4 columns: PLU NO, Name, Code, Price. Every
// item in that sheet needs to exist as a real Product in the app before
// its scale barcode means anything at checkout.
//
// This script reads that sheet and turns every row that ISN'T already a
// product (matched by Code == Product.scaleWareCode) into a full product
// row, filling in everything the sheet doesn't have:
//   - sku          generated in the exact same format the admin "Add
//                   Product" form uses (see generateSKU in
//                   frontend/src/lib/utils.ts) — e.g. "ARTDRY-4F2A1"
//   - slug          generated from the name, de-duplicated
//   - barcode       the scale's own Code (so the item scans the same way
//                   at a regular barcode reader as it does off the scale)
//   - scaleWareCode the scale's own Code (so the CECON scale is
//                   recognized at checkout — see the schema comment on
//                   Product.scaleWareCode)
//   - description   a generic placeholder ("No description available.")
//   - category      whatever category you point it at with --category
//   - stockQuantity 10 by default, override with --stock
//   - status        ACTIVE by default, override with --status
//
// Like fill-scale-ware-codes.js, this does NOT write to the database. It
// only reads (to avoid duplicate/colliding SKUs, slugs, and scale codes)
// and then writes a CSV in the exact column format the app's own product
// importer expects. You review that CSV and import it yourself through
// Admin → Products → Import/Export → Import tab — same
// review-before-apply workflow as any other bulk product change, nothing
// silently written straight to the database by this script.
//
// USAGE
// ────────────────────────────────────────────────────────────────────────
//   1. See what categories exist and grab the one you want:
//        npm run publish:scale-goods -- --list-categories
//
//   2. Generate the import CSV (drop SCALE_GOODS.xlsx into scripts/ first,
//      or pass --file explicitly):
//        npm run publish:scale-goods -- --category="Deli & Cheese"
//        npm run publish:scale-goods -- --category=68f0a1c2b1234567890abcde
//        npm run publish:scale-goods -- --file=/path/to/SCALE_GOODS.xlsx --category="Deli"
//
//      Optional flags:
//        --stock=20          stockQuantity for every new row (default 10)
//        --status=DRAFT       ACTIVE | DRAFT | OUT_OF_STOCK | DISCONTINUED (default ACTIVE)
//        --out=my-file.csv   output path (default scripts/scale-goods-import-<timestamp>.csv)
//
//   3. Open Admin → Products → Import/Export → Import tab, upload the CSV
//      that gets written, and review the row count before confirming.

import fs from "fs";
import path from "path";
import XLSX from "xlsx";
import { stringify } from "csv-stringify/sync";
import prisma from "../src/config/database";

// Keep this in sync with PRODUCT_CSV_COLUMNS in
// src/controllers/export.controller.ts — the importer reads by header
// name, but keeping the same order makes the file easy to eyeball.
const PRODUCT_CSV_COLUMNS = [
  "name", "slug", "sku", "barcode", "description", "shortDescription",
  "price", "comparePrice", "costPrice", "stockQuantity", "lowStockThreshold",
  "categoryId", "brandId", "status", "isFeatured", "isNewArrival",
  "isOnPromotion", "tags", "images", "netWeight", "unitsPerCarton", "origin",
  "weight", "isHalal", "isOrganic", "isKosher", "isVegan", "isGlutenFree",
  "naifdaNumber", "storageInstructions", "ingredients", "allergens",
  "isScalable", "scaleUnit", "pricePerUnit", "minOrderQty", "maxOrderQty",
  "scaleStep", "scalePresets", "scaleWareCode", "variations",
] as const;

const VALID_STATUSES = ["ACTIVE", "DRAFT", "OUT_OF_STOCK", "DISCONTINUED"];

function parseArgs() {
  const args: Record<string, string | boolean> = {};
  for (const raw of process.argv.slice(2)) {
    if (!raw.startsWith("--")) continue;
    const [key, ...rest] = raw.slice(2).split("=");
    args[key] = rest.length ? rest.join("=") : true;
  }
  return args;
}

// ── Same slug format as frontend/src/lib/utils.ts generateSlug() ──────────
function generateSlug(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .trim();
}

// ── Same SKU format as frontend/src/lib/utils.ts generateSKU() ────────────
// e.g. "Artigiana Dry Tomatoes" -> "ARTDRYTOM-4F2A1"
function generateSku(productName: string): string {
  const words = productName.trim().split(/\s+/).slice(0, 3);
  const prefix = words
    .map((w) => w.replace(/[^a-zA-Z0-9]/g, "").toUpperCase().slice(0, 3))
    .join("")
    .slice(0, 8) || "PROD";
  const suffix = Math.floor(Math.random() * 0xfffff)
    .toString(16)
    .toUpperCase()
    .padStart(5, "0");
  return `${prefix}-${suffix}`;
}

function parsePrice(raw: unknown): number | null {
  if (raw === null || raw === undefined || raw === "") return null;
  if (typeof raw === "number") return raw;
  const cleaned = String(raw).replace(/[^0-9.]/g, "");
  const n = parseFloat(cleaned);
  return isNaN(n) ? null : n;
}

function normalizeCode(raw: unknown): string | null {
  if (raw === null || raw === undefined || raw === "") return null;
  return String(raw).trim();
}

// ── Locate the sheet's own header row (PLU NO / Name / Code / Price can
// sit a couple of rows down, e.g. under a title row) and read data below
// it, keyed by header name rather than a hardcoded column letter — so a
// slightly different export layout from mscale doesn't silently misread
// columns. ─────────────────────────────────────────────────────────────
function readScaleGoods(filePath: string): Array<{ name: string; code: string; price: number }> {
  const wb = XLSX.readFile(filePath);
  const sheetName = wb.SheetNames[0];
  const sheet = wb.Sheets[sheetName];
  const rows: unknown[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });

  const headerRowIndex = rows.findIndex((row) =>
    row.some((c) => String(c).trim().toLowerCase() === "name") &&
    row.some((c) => String(c).trim().toLowerCase() === "code"),
  );
  if (headerRowIndex === -1) {
    throw new Error(
      `Couldn't find a header row with "Name" and "Code" columns in ${filePath}. ` +
        `Expected the mscale PLU export layout (PLU NO, Name, Code, Price).`,
    );
  }

  const headers = rows[headerRowIndex].map((h) => String(h).trim().toLowerCase());
  const nameIdx = headers.indexOf("name");
  const codeIdx = headers.indexOf("code");
  const priceIdx = headers.indexOf("price");
  if (priceIdx === -1) {
    throw new Error(`Couldn't find a "Price" column in ${filePath}.`);
  }

  const out: Array<{ name: string; code: string; price: number }> = [];
  for (let i = headerRowIndex + 1; i < rows.length; i++) {
    const row = rows[i];
    const name = String(row[nameIdx] ?? "").trim();
    const code = normalizeCode(row[codeIdx]);
    const price = parsePrice(row[priceIdx]);
    if (!name || !code || price === null) continue; // skip blank/partial rows
    out.push({ name, code, price });
  }
  return out;
}

async function main() {
  const args = parseArgs();

  if (args["list-categories"]) {
    const categories = await prisma.category.findMany({
      orderBy: { name: "asc" },
      select: { id: true, name: true, slug: true, isActive: true },
    });
    console.log(`\n${categories.length} categor${categories.length === 1 ? "y" : "ies"}:\n`);
    for (const c of categories) {
      console.log(`  ${c.id}   ${c.name}${c.isActive ? "" : "  (inactive)"}`);
    }
    console.log(`\nRun again with --category="Name" or --category=<id>.\n`);
    await prisma.$disconnect();
    return;
  }

  // ── Resolve the scale-goods file ────────────────────────────────────────
  const scriptsDir = __dirname;
  let filePath = typeof args.file === "string" ? args.file : "";
  if (!filePath) {
    const candidates = fs
      .readdirSync(scriptsDir)
      .filter((f) => f.toLowerCase().endsWith(".xlsx"))
      .map((f) => path.join(scriptsDir, f));
    if (candidates.length === 0) {
      console.error(
        "No .xlsx file found in scripts/. Drop SCALE_GOODS.xlsx in there, or pass --file=/path/to/file.xlsx.",
      );
      process.exitCode = 1;
      return;
    }
    filePath = candidates.sort(
      (a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs,
    )[0];
    console.log(`Using ${filePath} (auto-detected)\n`);
  }
  if (!fs.existsSync(filePath)) {
    console.error(`File not found: ${filePath}`);
    process.exitCode = 1;
    return;
  }

  // ── Resolve category ─────────────────────────────────────────────────
  const categoryArg = typeof args.category === "string" ? args.category : "";
  if (!categoryArg) {
    console.error(
      'Missing --category. Run "npm run publish:scale-goods -- --list-categories" to see options,\n' +
        'then pass --category="Category Name" or --category=<categoryId>.',
    );
    process.exitCode = 1;
    return;
  }
  const isObjectId = /^[0-9a-fA-F]{24}$/.test(categoryArg);
  const category = isObjectId
    ? await prisma.category.findUnique({ where: { id: categoryArg } })
    : await prisma.category.findFirst({
        where: { name: { equals: categoryArg, mode: "insensitive" } },
      });
  if (!category) {
    console.error(
      `Category "${categoryArg}" not found. Run with --list-categories to see valid names/ids.`,
    );
    process.exitCode = 1;
    return;
  }

  const stockQuantity = args.stock ? parseInt(String(args.stock), 10) : 10;
  const status = typeof args.status === "string" ? args.status.toUpperCase() : "ACTIVE";
  if (!VALID_STATUSES.includes(status)) {
    console.error(`--status must be one of ${VALID_STATUSES.join(", ")}`);
    process.exitCode = 1;
    return;
  }

  // ── Read the sheet ──────────────────────────────────────────────────────
  const rows = readScaleGoods(filePath);
  console.log(`Read ${rows.length} row(s) with a name, code, and price from ${path.basename(filePath)}.\n`);

  // ── Existing DB state, so we don't collide or duplicate ────────────────
  const [existingByWareCode, existingSkus, existingSlugs] = await Promise.all([
    prisma.product.findMany({
      where: { scaleWareCode: { not: null } },
      select: { scaleWareCode: true, name: true },
    }),
    prisma.product.findMany({ select: { sku: true } }),
    prisma.product.findMany({ select: { slug: true } }),
  ]);
  const publishedCodes = new Map(
    existingByWareCode.map((p) => [p.scaleWareCode as string, p.name]),
  );
  const takenSkus = new Set(existingSkus.map((p) => p.sku));
  const takenSlugs = new Set(existingSlugs.map((p) => p.slug));

  const outRows: any[] = [];
  const skipped: Array<{ name: string; code: string; existingName: string }> = [];
  const seenCodesThisRun = new Set<string>();

  for (const row of rows) {
    if (publishedCodes.has(row.code)) {
      skipped.push({ name: row.name, code: row.code, existingName: publishedCodes.get(row.code)! });
      continue;
    }
    if (seenCodesThisRun.has(row.code)) {
      skipped.push({ name: row.name, code: row.code, existingName: "(duplicate row in this sheet)" });
      continue;
    }
    seenCodesThisRun.add(row.code);

    // Slug — dedupe against DB + rows already queued this run
    let slug = generateSlug(row.name);
    if (!slug) slug = `product-${row.code}`;
    let candidateSlug = slug;
    let n = 1;
    while (takenSlugs.has(candidateSlug)) {
      candidateSlug = `${slug}-${row.code.toLowerCase().replace(/[^a-z0-9]/g, "")}${n > 1 ? `-${n}` : ""}`;
      n++;
    }
    takenSlugs.add(candidateSlug);

    // SKU — dedupe against DB + rows already queued this run
    let sku = generateSku(row.name);
    while (takenSkus.has(sku)) sku = generateSku(row.name);
    takenSkus.add(sku);

    outRows.push({
      name: row.name,
      slug: candidateSlug,
      sku,
      barcode: row.code,
      description: "No description available.",
      shortDescription: "",
      price: String(row.price),
      comparePrice: "",
      costPrice: "",
      stockQuantity: String(stockQuantity),
      lowStockThreshold: "10",
      categoryId: category.id,
      brandId: "",
      status,
      isFeatured: "false",
      isNewArrival: "false",
      isOnPromotion: "false",
      tags: "",
      images: "",
      netWeight: "",
      unitsPerCarton: "",
      origin: "",
      weight: "",
      isHalal: "false",
      isOrganic: "false",
      isKosher: "false",
      isVegan: "false",
      isGlutenFree: "false",
      naifdaNumber: "",
      storageInstructions: "",
      ingredients: "",
      allergens: "",
      isScalable: "false",
      scaleUnit: "",
      pricePerUnit: "",
      minOrderQty: "",
      maxOrderQty: "",
      scaleStep: "",
      scalePresets: "",
      scaleWareCode: row.code,
      variations: "",
    });
  }

  if (outRows.length === 0) {
    console.log("Nothing new to publish — every row in the sheet is already a product (matched by Scale Ware Code).");
    await prisma.$disconnect();
    return;
  }

  const outPath =
    typeof args.out === "string"
      ? args.out
      : path.join(scriptsDir, `scale-goods-import-${Date.now()}.csv`);
  const csv = stringify(outRows, { header: true, columns: [...PRODUCT_CSV_COLUMNS] });
  fs.writeFileSync(outPath, csv);

  console.log(`✅ Wrote ${outRows.length} new product row(s) to:\n   ${outPath}\n`);
  console.log(`   Category:      ${category.name} (${category.id})`);
  console.log(`   Stock:         ${stockQuantity} each`);
  console.log(`   Status:        ${status}`);
  console.log(`   Barcode:       same as Scale Ware Code`);

  if (skipped.length > 0) {
    console.log(`\n⏭  Skipped ${skipped.length} row(s) already published (matched by Scale Ware Code):`);
    for (const s of skipped.slice(0, 15)) {
      console.log(`   ${s.code}  "${s.name}"  → already exists as "${s.existingName}"`);
    }
    if (skipped.length > 15) console.log(`   ...and ${skipped.length - 15} more.`);
  }

  console.log(
    `\nNext: Admin → Products → Import/Export → Import tab → upload this CSV and confirm.\n`,
  );

  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exitCode = 1;
});
