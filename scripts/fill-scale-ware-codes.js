#!/usr/bin/env node
// backend/scripts/fill-scale-ware-codes.js
//
// Bulk-fills the "Scale Ware Code" field for products that already exist
// both in the app AND in the CECON scale's own PLU table (Merchandise →
// Export in mscale, e.g. SCALE_GOODS.xlsx) — matched by product name.
//
// This does NOT talk to the database or the API directly. It works purely
// on files: read the app's full product CSV export, read the scale's PLU
// export, match by name, write a new CSV with scaleWareCode filled in for
// every match. You then re-import that CSV through the normal
// Import/Export modal (Admin → Products → Import/Export → Import tab) to
// actually apply the change — same review-before-apply workflow as any
// other bulk CSV edit, nothing silently written straight to the database.
//
// Usage:
//   node scripts/fill-scale-ware-codes.js \
//     --products path/to/products-export.csv \
//     --scale path/to/SCALE_GOODS.xlsx \
//     --out products-with-scale-codes.csv
//
// Requires the app's product CSV to be a FULL export (Export tab → Export
// as CSV) — not a partial/hand-trimmed file — since the safest thing is to
// only ever change the one column you mean to change. The script checks
// for this and warns (not blocks) if columns look thin.

const fs = require("fs");
const path = require("path");
const { parse } = require("csv-parse/sync");
const { stringify } = require("csv-stringify/sync");
const XLSX = require("xlsx");

// Keep this in sync with PRODUCT_CSV_COLUMNS in
// src/controllers/export.controller.ts — used only for the "does this look
// like a full export" sanity check below, not for anything structural.
const EXPECTED_COLUMNS = [
  "name", "slug", "sku", "barcode", "description", "shortDescription",
  "price", "comparePrice", "costPrice", "stockQuantity", "lowStockThreshold",
  "categoryId", "brandId", "status", "isFeatured", "isNewArrival",
  "isOnPromotion", "tags", "images", "netWeight", "unitsPerCarton", "origin",
  "weight", "isHalal", "isOrganic", "isKosher", "isVegan", "isGlutenFree",
  "naifdaNumber", "storageInstructions", "ingredients", "allergens",
  "isScalable", "scaleUnit", "pricePerUnit", "minOrderQty", "maxOrderQty",
  "scaleStep", "scalePresets", "scaleWareCode", "variations",
];

function parseArgs() {
  const args = {};
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith("--")) {
      const key = argv[i].slice(2);
      const value = argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[++i] : true;
      args[key] = value;
    }
  }
  return args;
}

// Normalizes a product name for matching: lowercase, trim, collapse
// whitespace, strip trailing punctuation/ellipses. Deliberately simple —
// exact-after-normalization only. A fuzzy/approximate match is NOT
// attempted here; for a bulk write like this, a wrong high-confidence-
// looking guess is worse than a manual follow-up, so anything that isn't a
// clean match is left for the report at the end instead of auto-applied.
function normalizeName(raw) {
  return String(raw || "")
    .toLowerCase()
    .trim()
    .replace(/\.+$/, "")
    .replace(/\s+/g, " ");
}

function readProductsCsv(filePath) {
  const content = fs.readFileSync(filePath, "utf-8");
  const rows = parse(content, { columns: true, skip_empty_lines: true, trim: true });
  if (rows.length === 0) throw new Error("Products CSV has no data rows.");

  const headers = Object.keys(rows[0]);
  const missing = EXPECTED_COLUMNS.filter((c) => !headers.includes(c));
  if (missing.length > 3) {
    console.warn(
      `⚠️  This CSV is missing ${missing.length} columns this app's export normally ` +
        `has (${missing.slice(0, 6).join(", ")}${missing.length > 6 ? ", …" : ""}).\n` +
        `   That's fine to fill scaleWareCode with — the backend only ever updates\n` +
        `   columns actually present in the file — but double check this is really\n` +
        `   the file you meant to use (Admin → Products → Import/Export → Export\n` +
        `   as CSV, the current one, not an old download).\n`,
    );
  }
  return rows;
}

// Reads the scale's PLU export (SCALE_GOODS.xlsx-shaped: a "Name" and a
// "Code" column somewhere in the first few rows of the first sheet — mscale
// puts them at row 2 with a blank row/column around them, but this scans
// for the header row rather than assuming an exact position, in case a
// different export or sheet layout is used).
function readScalePlu(filePath) {
  const wb = XLSX.readFile(filePath);
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });

  let headerRowIdx = -1;
  let nameCol = -1;
  let codeCol = -1;
  for (let r = 0; r < Math.min(10, rows.length); r++) {
    const row = rows[r].map((c) => String(c || "").trim().toLowerCase());
    const n = row.indexOf("name");
    const c = row.indexOf("code");
    if (n !== -1 && c !== -1) {
      headerRowIdx = r;
      nameCol = n;
      codeCol = c;
      break;
    }
  }
  if (headerRowIdx === -1) {
    throw new Error(
      'Could not find a header row with both "Name" and "Code" columns in the scale export.',
    );
  }

  const entries = [];
  for (let r = headerRowIdx + 1; r < rows.length; r++) {
    const name = rows[r][nameCol];
    const code = rows[r][codeCol];
    if (!name || !code) continue;
    entries.push({ name: String(name), code: String(code).trim() });
  }
  return entries;
}

function main() {
  const args = parseArgs();
  if (!args.products || !args.scale) {
    console.error(
      "Usage: node scripts/fill-scale-ware-codes.js --products <products.csv> --scale <SCALE_GOODS.xlsx> [--out <output.csv>] [--force]",
    );
    process.exit(1);
  }

  const outPath = args.out || "products-with-scale-codes.csv";
  const force = !!args.force;

  const products = readProductsCsv(path.resolve(args.products));
  const scaleEntries = readScalePlu(path.resolve(args.scale));

  // Build normalized-name -> code map, flagging any name that appears more
  // than once in the scale's own export (ambiguous — skip rather than guess).
  const scaleByName = new Map();
  const ambiguousScaleNames = new Set();
  for (const { name, code } of scaleEntries) {
    const key = normalizeName(name);
    if (scaleByName.has(key) && scaleByName.get(key) !== code) {
      ambiguousScaleNames.add(key);
    }
    scaleByName.set(key, code);
  }
  for (const key of ambiguousScaleNames) scaleByName.delete(key);

  let filled = 0;
  let alreadySet = 0;
  let noMatch = 0;
  const unmatchedProducts = [];
  const usedCodes = new Set();

  const updated = products.map((row) => {
    const key = normalizeName(row.name);
    const code = scaleByName.get(key);

    if (row.scaleWareCode && row.scaleWareCode.trim() && !force) {
      if (code) alreadySet++;
      return row;
    }
    if (!code) {
      noMatch++;
      unmatchedProducts.push(row.name);
      return row;
    }
    if (usedCodes.has(code)) {
      // Two different products in the app both normalized-matched the same
      // scale code — a data problem worth a human looking at, not something
      // to silently resolve by picking one.
      console.warn(`⚠️  Scale code ${code} matched more than one product — skipping "${row.name}".`);
      noMatch++;
      unmatchedProducts.push(row.name);
      return row;
    }
    usedCodes.add(code);
    filled++;
    return { ...row, scaleWareCode: code };
  });

  const outHeaders = Array.from(
    new Set([...Object.keys(products[0]), "scaleWareCode"]),
  );
  const csv = stringify(updated, { header: true, columns: outHeaders });
  fs.writeFileSync(outPath, csv);

  console.log(`\nDone.`);
  console.log(`  ${filled} product(s) matched and filled in`);
  console.log(`  ${alreadySet} already had a scale ware code (left untouched — pass --force to overwrite)`);
  console.log(`  ${ambiguousScaleNames.size} scale PLU name(s) were ambiguous (matched 2+ different codes) — skipped`);
  console.log(`  ${noMatch} app product(s) had no match in the scale's PLU list`);
  if (noMatch > 0 && noMatch <= 30) {
    console.log(`\nUnmatched products (check spelling differences, or these just aren't on the scale):`);
    unmatchedProducts.forEach((n) => console.log(`  - ${n}`));
  } else if (noMatch > 30) {
    console.log(`\n(${noMatch} unmatched — too many to list here; check ${outPath} for the full set with scaleWareCode still blank)`);
  }
  console.log(`\nWrote: ${outPath}`);
  console.log(`Next: Admin → Products → Import/Export → Import tab → upload this file.`);
}

main();
