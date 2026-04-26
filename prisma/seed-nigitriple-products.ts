/**
 * NigitTriple Product Seed Script
 * Populates 830 grocery products from NigitTriple_Products_Final.csv
 *
 * Run: npx ts-node --project prisma/tsconfig.json prisma/seed-NigitTriple-products.ts
 *
 * This script:
 *  1. Upserts all categories (21) from the CSV
 *  2. Upserts all brands (227) from the CSV
 *  3. Upserts every product row — safe to re-run (idempotent via slug)
 */

import { PrismaClient, ProductStatus } from "@prisma/client";
import * as fs from "fs";
import * as path from "path";
import * as readline from "readline";

const prisma = new PrismaClient();

// ─── Helpers ──────────────────────────────────────────────────────────────────

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function generateSKU(category: string, name: string): string {
  const prefix = category
    .split(/[\s&/]+/)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("")
    .slice(0, 4)
    .padEnd(4, "X");

  const nameAbbr = name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w.substring(0, 3).toUpperCase())
    .join("");

  const rand = Math.floor(100000 + Math.random() * 900000);
  return `${prefix}-${nameAbbr}-${rand}`;
}

function parseBoolean(val: string | undefined): boolean {
  if (!val) return false;
  return (
    val.toString().trim().toLowerCase() === "yes" ||
    val === "true" ||
    val === "1"
  );
}

function parseNumber(val: string | undefined): number | null {
  if (!val || val.trim() === "" || val === "nan") return null;
  const n = parseFloat(val.trim());
  return isNaN(n) ? null : n;
}

function parseJSON(val: string | undefined): any {
  if (!val || val.trim() === "" || val === "nan") return undefined;
  try {
    // Handle Python-style single quotes
    return JSON.parse(val.replace(/'/g, '"'));
  } catch {
    return undefined;
  }
}

function parseAllergens(val: string | undefined): string[] {
  if (!val || val.trim() === "" || val === "nan") return [];
  return val
    .split("|")
    .map((s) => s.trim())
    .filter(Boolean);
}

function parseTags(val: string | undefined): string[] {
  if (!val || val.trim() === "" || val === "nan") return [];
  return val
    .split("|")
    .map((s) => s.trim())
    .filter(Boolean);
}

function parseStatus(val: string | undefined): ProductStatus {
  if (!val) return ProductStatus.ACTIVE;
  const v = val.trim().toUpperCase();
  if (v === "OUT OF STOCK") return ProductStatus.OUT_OF_STOCK;
  if (v === "DRAFT") return ProductStatus.DRAFT;
  if (v === "DISCONTINUED") return ProductStatus.DISCONTINUED;
  return ProductStatus.ACTIVE;
}

// ─── CSV Parser (no external deps) ───────────────────────────────────────────

interface RawRow {
  submittedAt: string;
  name: string;
  category: string;
  subcategory: string;
  brand: string;
  description: string;
  price: string;
  costPrice: string;
  stockQuantity: string;
  unit: string;
  status: string;
  isFeatured: string;
  imageUrl: string;
  barcode: string;
  weightInGrams: string;
  shortDescription: string;
  netWeight: string;
  packageSize: string;
  unitsPerCarton: string;
  origin: string;
  ingredients: string;
  allergens: string;
  nutritionalInfo: string;
  servingSize: string;
  servingsPerPack: string;
  storageInstructions: string;
  shelfLifeDays: string;
  requiresRefrigeration: string;
  requiresFreezing: string;
  isOrganic: string;
  isHalal: string;
  isKosher: string;
  isVegan: string;
  isGlutenFree: string;
  nafdacNumber: string;
  tags: string;
}

async function parseCSV(filePath: string): Promise<RawRow[]> {
  const rows: RawRow[] = [];
  const rl = readline.createInterface({
    input: fs.createReadStream(filePath),
    crlfDelay: Infinity,
  });

  let headers: string[] = [];
  let isFirst = true;

  for await (const line of rl) {
    if (isFirst) {
      headers = parseCSVLine(line);
      isFirst = false;
      continue;
    }
    if (!line.trim()) continue;
    const values = parseCSVLine(line);
    const row: any = {};
    headers.forEach((h, i) => {
      row[h] = values[i] ?? "";
    });
    rows.push(row as RawRow);
  }

  return rows;
}

function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === "," && !inQuotes) {
      result.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  result.push(current);
  return result;
}

// ─── Main Seed ────────────────────────────────────────────────────────────────

async function main() {
  const csvPath = path.resolve(__dirname, "../NigitTriple_Products_Final.csv");

  // Allow passing custom path as arg
  const customPath = process.argv[2];
  const filePath = customPath || csvPath;

  if (!fs.existsSync(filePath)) {
    console.error(`❌ CSV not found at: ${filePath}`);
    console.error(
      `   Usage: npx ts-node --project prisma/tsconfig.json prisma/seed-NigitTriple-products.ts [/path/to/file.csv]`,
    );
    process.exit(1);
  }

  console.log("📦 NigitTriple Product Seed");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log(`📄 CSV: ${filePath}`);

  const rows = await parseCSV(filePath);
  console.log(`✅ Parsed ${rows.length} rows`);

  // ── 1. Collect unique categories & brands ─────────────────────────────────

  const categoryNames = [
    ...new Set(rows.map((r) => r.category?.trim()).filter(Boolean)),
  ];
  const brandNames = [
    ...new Set(rows.map((r) => r.brand?.trim()).filter(Boolean)),
  ];

  console.log(
    `\n🗂️  Upserting ${categoryNames.length} categories and ${brandNames.length} brands...`,
  );

  // ── 2. Upsert categories ──────────────────────────────────────────────────

  const categoryMap = new Map<string, string>(); // name → id

  for (const name of categoryNames) {
    const slug = slugify(name);
    const cat = await prisma.category.upsert({
      where: { slug },
      update: { name },
      create: {
        name,
        slug,
        description: `${name} — NigitTriple grocery category`,
        isActive: true,
      },
    });
    categoryMap.set(name, cat.id);
  }

  console.log(`   ✔ Categories done`);

  // ── 3. Upsert brands ──────────────────────────────────────────────────────

  const brandMap = new Map<string, string>(); // name → id

  for (const name of brandNames) {
    const slug = slugify(name) + "-brand";
    const brand = await prisma.brand.upsert({
      where: { slug },
      update: { name },
      create: {
        name,
        slug,
        description: `${name} brand products`,
        isActive: true,
      },
    });
    brandMap.set(name, brand.id);
  }

  console.log(`   ✔ Brands done`);

  // ── 4. Upsert products ────────────────────────────────────────────────────

  console.log(`\n🛒 Seeding products...`);

  let created = 0;
  let updated = 0;
  let failed = 0;
  const slugsSeen = new Set<string>();

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];

    const name = row.name?.trim();
    if (!name) {
      failed++;
      continue;
    }

    // Make slug unique if duplicate names exist in CSV
    let slug = slugify(name);
    if (slugsSeen.has(slug)) {
      slug = `${slug}-${Math.random().toString(36).slice(2, 6)}`;
    }
    slugsSeen.add(slug);

    const categoryId = categoryMap.get(row.category?.trim() ?? "");
    const brandId = brandMap.get(row.brand?.trim() ?? "");

    if (!categoryId) {
      console.warn(`   ⚠️  No category found for row ${i + 2}: ${name}`);
      failed++;
      continue;
    }

    const price = parseNumber(row.price) ?? 0;
    const costPrice = parseNumber(row.costPrice) ?? undefined;
    const stockQty = parseInt(row.stockQuantity) || 0;
    const weightGrams = parseNumber(row.weightInGrams);
    const weightKg = weightGrams ? weightGrams / 1000 : undefined;

    const nutritionalInfo = parseJSON(row.nutritionalInfo);
    const isFeatured = parseBoolean(row.isFeatured);

    const imageUrls: string[] = [];
    if (row.imageUrl?.trim() && row.imageUrl !== "nan") {
      imageUrls.push(row.imageUrl.trim());
    }

    const productData = {
      name,
      slug,
      description: row.description?.trim() || name,
      shortDescription: row.shortDescription?.trim() || undefined,
      sku: generateSKU(row.category?.trim() || "PROD", name),
      barcode:
        row.barcode?.trim() && row.barcode !== "nan"
          ? row.barcode.trim()
          : undefined,
      price,
      costPrice: costPrice ?? undefined,
      stockQuantity: stockQty,
      trackInventory: true,
      lowStockThreshold: 5,
      images: imageUrls,
      videos: [] as string[],
      isFeatured,
      status: parseStatus(row.status),
      categoryId,
      brandId: brandId || undefined,
      tags: parseTags(row.tags),

      // Grocery-specific fields
      netWeight:
        row.netWeight?.trim() && row.netWeight !== "nan"
          ? row.netWeight.trim()
          : undefined,
      packageSize:
        row.packageSize?.trim() && row.packageSize !== "nan"
          ? row.packageSize.trim()
          : undefined,
      unitsPerCarton: parseInt(row.unitsPerCarton) || undefined,
      origin:
        row.origin?.trim() && row.origin !== "nan"
          ? row.origin.trim()
          : undefined,
      ingredients:
        row.ingredients?.trim() && row.ingredients !== "nan"
          ? row.ingredients.trim()
          : undefined,
      allergens: parseAllergens(row.allergens),
      nutritionalInfo: nutritionalInfo ?? undefined,
      servingSize:
        row.servingSize?.trim() && row.servingSize !== "nan"
          ? row.servingSize.trim()
          : undefined,
      servingsPerPack:
        row.servingsPerPack?.trim() && row.servingsPerPack !== "nan"
          ? row.servingsPerPack.trim()
          : undefined,
      storageInstructions:
        row.storageInstructions?.trim() && row.storageInstructions !== "nan"
          ? row.storageInstructions.trim()
          : undefined,
      shelfLifeDays: parseInt(row.shelfLifeDays) || undefined,
      requiresRefrigeration: parseBoolean(row.requiresRefrigeration),
      requiresFreezing: parseBoolean(row.requiresFreezing),
      isOrganic: parseBoolean(row.isOrganic),
      isHalal: parseBoolean(row.isHalal),
      isKosher: parseBoolean(row.isKosher),
      isVegan: parseBoolean(row.isVegan),
      isGlutenFree: parseBoolean(row.isGlutenFree),
      naifdaNumber:
        row.nafdacNumber?.trim() && row.nafdacNumber !== "nan"
          ? row.nafdacNumber.trim()
          : undefined,
      weight: weightKg ?? undefined,
    };

    try {
      const existing = await prisma.product.findUnique({ where: { slug } });

      if (existing) {
        await prisma.product.update({
          where: { slug },
          data: {
            ...productData,
            // Don't overwrite slug/sku on update
            slug: existing.slug,
            sku: existing.sku,
          },
        });
        updated++;
      } else {
        await prisma.product.create({ data: productData });
        created++;
      }

      if ((created + updated) % 50 === 0) {
        process.stdout.write(
          `   Progress: ${created + updated}/${rows.length} (${created} new, ${updated} updated)\r`,
        );
      }
    } catch (err: any) {
      console.error(`\n   ❌ Row ${i + 2} "${name}": ${err.message}`);
      failed++;
    }
  }

  console.log(`\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`✅ Seed complete!`);
  console.log(`   Created : ${created}`);
  console.log(`   Updated : ${updated}`);
  console.log(`   Failed  : ${failed}`);
  console.log(`   Total   : ${rows.length}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
