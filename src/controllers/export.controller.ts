// backend/src/controllers/export.controller.ts

import { Response, NextFunction } from "express";
import { AuthRequest } from "../middlewares/auth.middleware";
import prisma from "../config/database";
import { AppError } from "../utils/appError";
import PDFDocument from "pdfkit";
import { parse } from "csv-parse/sync";
import { stringify } from "csv-stringify/sync";
import https from "https";
import http from "http";
import { log as logActivity } from "../utils/activityLogger";
import { type VariationInput, applyProductVariations } from "./product.controller";

// ── helper: collect PDFDocument into Buffer ───────────────────────────────────
function pdfToBuffer(doc: InstanceType<typeof PDFDocument>): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });
}

// ── helper: fetch a remote image URL and return its Buffer ────────────────────
// Returns null on any error so PDF generation continues without the image.
function fetchImageBuffer(url: string): Promise<Buffer | null> {
  return new Promise((resolve) => {
    if (!url || !url.startsWith("http")) {
      resolve(null);
      return;
    }
    try {
      const client = url.startsWith("https://") ? https : http;
      const req = client.get(url, { timeout: 5000 }, (res) => {
        if (res.statusCode !== 200) {
          resolve(null);
          return;
        }
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => resolve(Buffer.concat(chunks)));
        res.on("error", () => resolve(null));
      });
      req.on("error", () => resolve(null));
      req.on("timeout", () => {
        req.destroy();
        resolve(null);
      });
    } catch {
      resolve(null);
    }
  });
}

// ── helper: format price as "N1,234" (N = Naira; pdfkit can't render ₦) ──────
function naira(amount: number): string {
  return `N${amount.toLocaleString("en-NG")}`;
}

// ── EXPORT PRODUCTS CSV ───────────────────────────────────────────────────────
// ── SHARED: canonical import/export column list ───────────────────────────────
// This is the single source of truth — both exportProductsCSV and
// downloadCSVTemplate use exactly these columns in exactly this order.
const PRODUCT_CSV_COLUMNS = [
  "name",
  "slug",
  "sku",
  "barcode",
  "description",
  "shortDescription",
  "price",
  "comparePrice",
  "costPrice",
  "stockQuantity",
  "lowStockThreshold",
  "categoryId",
  "brandId",
  "status",
  "isFeatured",
  "isNewArrival",
  "isOnPromotion",
  "tags",
  "images",
  "netWeight",
  "unitsPerCarton",
  "origin",
  "weight",
  "isHalal",
  "isOrganic",
  "isKosher",
  "isVegan",
  "isGlutenFree",
  "naifdaNumber",
  "storageInstructions",
  "ingredients",
  "allergens",
  // ── Scalable / weighted product ──
  // Kept as a separate trailing block rather than interleaved above, so a
  // spreadsheet that predates these columns still has every existing
  // column in the same position — only new columns get appended at the end.
  "isScalable",
  "scaleUnit",
  "pricePerUnit",
  "minOrderQty",
  "maxOrderQty",
  "scaleStep",
  "scalePresets",
  "scaleWareCode",
  // Structured presets (see ProductVariation in schema.prisma) — one JSON
  // array per row, e.g. [{"label":"500g Pack","quantity":0.5,"price":9000,...}].
  // This is the only field in this list that isn't a flat scalar; CSV has
  // no native way to represent a one-to-many relation, and a JSON blob in
  // a single cell is the only lossless round-trip that doesn't require
  // inventing a second file/sheet. Importing this column back in re-creates
  // the exact same variations (matched by "id" when present, so editing a
  // variation's price in the CSV and re-importing updates it in place
  // rather than creating a duplicate).
  "variations",
] as const;

// ── EXPORT PRODUCTS CSV ───────────────────────────────────────────────────────
export const exportProductsCSV = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const products = await prisma.product.findMany({
      include: { category: true, brand: true, variations: true },
      orderBy: { createdAt: "desc" },
    });

    const csvData = products.map((p) => ({
      name: p.name,
      slug: p.slug,
      sku: p.sku,
      barcode: p.barcode || "",
      description: p.description,
      shortDescription: p.shortDescription || "",
      price: p.price,
      comparePrice: p.comparePrice || "",
      costPrice: p.costPrice || "",
      stockQuantity: p.stockQuantity,
      lowStockThreshold: p.lowStockThreshold,
      categoryId: p.categoryId,
      brandId: p.brandId || "",
      status: p.status,
      isFeatured: p.isFeatured,
      isNewArrival: p.isNewArrival,
      isOnPromotion: p.isOnPromotion,
      tags: p.tags.join("|"),
      images: p.images.join("|"),
      netWeight: p.netWeight || "",
      unitsPerCarton: p.unitsPerCarton || "",
      origin: p.origin || "",
      weight: p.weight || "",
      isHalal: p.isHalal,
      isOrganic: p.isOrganic,
      isKosher: p.isKosher,
      isVegan: p.isVegan,
      isGlutenFree: p.isGlutenFree,
      naifdaNumber: p.naifdaNumber || "",
      storageInstructions: p.storageInstructions || "",
      ingredients: p.ingredients || "",
      allergens: (p.allergens || []).join("|"),
      // ── Scalable / weighted product ──
      isScalable: p.isScalable,
      scaleUnit: p.scaleUnit || "",
      pricePerUnit: p.pricePerUnit ?? "",
      minOrderQty: p.minOrderQty ?? "",
      maxOrderQty: p.maxOrderQty ?? "",
      scaleStep: p.scaleStep ?? "",
      scalePresets: (p.scalePresets || []).join("|"),
      scaleWareCode: p.scaleWareCode || "",
      variations: JSON.stringify(
        (p.variations || []).map((v) => ({
          id: v.id,
          label: v.label,
          quantity: v.quantity,
          price: v.price,
          compareAtPrice: v.compareAtPrice,
          barcode: v.barcode,
          sku: v.sku,
          stockQuantity: v.stockQuantity,
          isDefault: v.isDefault,
          isActive: v.isActive,
          sortOrder: v.sortOrder,
        })),
      ),
    }));

    const csv = stringify(csvData, {
      header: true,
      columns: [...PRODUCT_CSV_COLUMNS],
    });

    res.setHeader("Content-Type", "text/csv");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="products-${Date.now()}.csv"`,
    );
    res.send(csv);
  } catch (error) {
    next(error);
  }
};

// ── EXPORT PRODUCTS PDF (inventory table) ────────────────────────────────────
export const exportProductsPDF = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    // No limit — export ALL products
    const products = await prisma.product.findMany({
      where: { status: "ACTIVE" },
      include: { category: true, brand: true },
      orderBy: { name: "asc" },
    });

    const doc = new PDFDocument({
      margin: 50,
      size: "A4",
      autoFirstPage: true,
    });
    const bufferPromise = pdfToBuffer(doc);

    // Header
    doc
      .fontSize(20)
      .font("Helvetica-Bold")
      .text("Product Inventory Report", { align: "center" });
    doc.moveDown(0.5);
    doc
      .fontSize(10)
      .font("Helvetica")
      .text(`Generated: ${new Date().toLocaleString()}`, { align: "center" });
    doc
      .text(`Total Products: ${products.length}`, { align: "center" })
      .moveDown(1.5);

    // Table headers
    const tableTop = doc.y;
    const colWidths = [185, 85, 85, 70, 75];
    const headers = ["Product", "SKU", "Price (N)", "Stock", "Status"];
    doc.fontSize(9).font("Helvetica-Bold");
    headers.forEach((header, i) => {
      const x = 50 + colWidths.slice(0, i).reduce((a, b) => a + b, 0);
      doc.text(header, x, tableTop, { width: colWidths[i], align: "left" });
    });
    doc
      .moveTo(50, tableTop + 15)
      .lineTo(550, tableTop + 15)
      .stroke();

    let y = tableTop + 25;
    doc.fontSize(8).font("Helvetica");

    products.forEach((product, index) => {
      if (y > 700) {
        doc.addPage();
        y = 50;
      }

      const rowData = [
        product.name.substring(0, 40),
        product.sku,
        naira(product.price),
        `${product.stockQuantity}`,
        product.status,
      ];

      rowData.forEach((data, i) => {
        const x = 50 + colWidths.slice(0, i).reduce((a, b) => a + b, 0);
        doc.text(data, x, y, { width: colWidths[i], align: "left" });
      });

      y += 20;
      if (index < products.length - 1) {
        doc
          .strokeColor("#e5e7eb")
          .moveTo(50, y - 5)
          .lineTo(550, y - 5)
          .stroke();
        doc.strokeColor("#000000");
      }
    });

    doc
      .fontSize(8)
      .font("Helvetica")
      .text(
        "NigitTriple Industry — Port Harcourt, Rivers State",
        50,
        doc.page.height - 50,
        { align: "center" },
      );

    doc.end();
    const pdfBuffer = await bufferPromise;

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="products-${Date.now()}.pdf"`,
    );
    res.setHeader("Content-Length", pdfBuffer.length);
    res.end(pdfBuffer);
  } catch (error) {
    next(error);
  }
};

// ── IMPORT PRODUCTS CSV ───────────────────────────────────────────────────────
export const importProductsCSV = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    if (!req.file) throw new AppError("Please upload a CSV file", 400);

    const isAdmin = req.user?.role === "ADMIN";
    const csvContent = req.file.buffer.toString("utf-8");
    const records = parse(csvContent, {
      columns: true,
      skip_empty_lines: true,
      trim: true,
    }) as any[];

    const results = {
      success: 0,
      failed: 0,
      errors: [] as Array<{ row: number; error: string; data: any }>,
      stockRequests: 0,
      stockRequestsFailed: 0,
    };

    // ── Helper: build product data object from a CSV row ──────────────────
    const buildData = (row: any): any => ({
      name: row.name,
      sku: row.sku,
      price: parseFloat(row.price) || 0,
      comparePrice: row.comparePrice ? parseFloat(row.comparePrice) : null,
      costPrice: row.costPrice ? parseFloat(row.costPrice) : null,
      stockQuantity: parseInt(row.stockQuantity) || 0,
      lowStockThreshold: parseInt(row.lowStockThreshold) || 5,
      categoryId: row.categoryId,
      brandId: row.brandId || null,
      status: (row.status as any) || "ACTIVE",
      description: row.description || null,
      shortDescription: row.shortDescription || null,
      isFeatured: row.isFeatured === "true",
      isNewArrival: row.isNewArrival === "true",
      isOnPromotion: row.isOnPromotion === "true",
      tags: row.tags ? row.tags.split("|").filter(Boolean) : [],
      images: row.images ? row.images.split("|").filter(Boolean) : [],
      barcode: row.barcode || null,
      netWeight: row.netWeight || null,
      unitsPerCarton: row.unitsPerCarton ? parseInt(row.unitsPerCarton) : null,
      origin: row.origin || null,
      weight: row.weight ? parseFloat(row.weight) : null,
      isHalal: row.isHalal === "true",
      isOrganic: row.isOrganic === "true",
      isKosher: row.isKosher === "true",
      isVegan: row.isVegan === "true",
      isGlutenFree: row.isGlutenFree === "true",
      naifdaNumber: row.naifdaNumber || null,
      storageInstructions: row.storageInstructions || null,
      ingredients: row.ingredients || null,
      allergens: row.allergens ? row.allergens.split("|").filter(Boolean) : [],
      // ── Scalable / weighted product ──
      isScalable: row.isScalable === "true",
      scaleUnit: row.scaleUnit || null,
      pricePerUnit: row.pricePerUnit ? parseFloat(row.pricePerUnit) : null,
      minOrderQty: row.minOrderQty ? parseFloat(row.minOrderQty) : null,
      maxOrderQty: row.maxOrderQty ? parseFloat(row.maxOrderQty) : null,
      scaleStep: row.scaleStep ? parseFloat(row.scaleStep) : null,
      scalePresets: row.scalePresets
        ? row.scalePresets
            .split("|")
            .map((n: string) => parseFloat(n))
            .filter((n: number) => !isNaN(n))
        : [],
      scaleWareCode: row.scaleWareCode?.trim() || null,
    });

    // Parses the "variations" CSV cell (a JSON array, see PRODUCT_CSV_COLUMNS'
    // comment) into VariationInput[]. Returns undefined for a blank cell —
    // meaning "don't touch this product's variations" — and throws a plain
    // Error (caught per-row, same as every other validation in this import)
    // for a cell that's present but isn't valid JSON or isn't an array.
    const parseVariationsCell = (raw: string | undefined): VariationInput[] | undefined => {
      if (raw === undefined || raw === null || raw.trim() === "") return undefined;
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        throw new Error('Invalid "variations" JSON — could not parse');
      }
      if (!Array.isArray(parsed)) {
        throw new Error('"variations" must be a JSON array');
      }
      return parsed as VariationInput[];
    };

    // ── One query to fetch all existing products by SKU ────────────────────
    const allSkus = records.map((r: any) => r.sku).filter(Boolean);
    const existingProducts = await prisma.product.findMany({
      where: { sku: { in: allSkus } },
      select: { id: true, sku: true, stockQuantity: true, name: true },
    });
    const existingMap = new Map(existingProducts.map((p) => [p.sku, p]));

    // ── Batch scale-ware-code uniqueness check ──────────────────────────────
    // Not enforced at the database level (see the schema comment on
    // Product.scaleWareCode — Prisma+MongoDB can't create a sparse unique
    // index). The normal edit flow checks this in createProduct/updateProduct,
    // but CSV import writes via Prisma directly, so it needs its own check.
    // wareCodeOwner maps scaleWareCode -> the SKU currently holding it, kept
    // updated synchronously as rows claim a code, so two rows in the same
    // CSV can't silently both claim the same code either.
    const existingWareCodes = await prisma.product.findMany({
      where: { scaleWareCode: { not: null } },
      select: { sku: true, scaleWareCode: true },
    });
    const wareCodeOwner = new Map<string, string>(
      existingWareCodes
        .filter((p) => p.scaleWareCode)
        .map((p) => [p.scaleWareCode as string, p.sku]),
    );

    // ── Helper: process records in parallel chunks ─────────────────────────
    const CHUNK = 20;
    const processChunks = async (
      items: any[],
      handler: (row: any, rowNum: number) => Promise<void>,
    ) => {
      for (let i = 0; i < items.length; i += CHUNK) {
        const chunk = items.slice(i, i + CHUNK);
        await Promise.allSettled(
          chunk.map((row, j) => handler(row, i + j + 2)),
        );
      }
    };

    // ── Non-admin import: stock changes go through approval ────────────────
    if (!isAdmin) {
      const user = await prisma.user.findUnique({
        where: { id: req.user!.userId },
      });
      if (!user) throw new AppError("User not found", 404);

      await processChunks(records, async (row: any, rowNum: number) => {
        try {
          if (!row.sku) throw new Error("SKU is required");

          const existing = existingMap.get(row.sku);

          // Stock change → approval request
          if (
            existing &&
            row.stockQuantity !== undefined &&
            row.stockQuantity !== "" &&
            parseInt(row.stockQuantity) !== existing.stockQuantity
          ) {
            const requestedQty = parseInt(row.stockQuantity);
            if (isNaN(requestedQty) || requestedQty < 0) {
              throw new Error(`Invalid stockQuantity: ${row.stockQuantity}`);
            }
            await prisma.stockApprovalRequest.create({
              data: {
                productId: existing.id,
                productName: existing.name,
                productSku: existing.sku,
                requestedBy: req.user!.userId,
                requestedByName: user.name,
                currentQty: existing.stockQuantity,
                requestedQty,
                reason:
                  row.reason ||
                  `CSV import by ${user.name} (${req.user!.role})`,
                source: "CSV_IMPORT",
                status: "PENDING",
              },
            });
            results.stockRequests++;
          }

          // Update non-stock fields
          if (existing) {
            const safeData: any = {};
            if (row.name) safeData.name = row.name;
            if (row.price)
              safeData.price = parseFloat(row.price) || existing.stockQuantity;
            if (row.comparePrice !== undefined)
              safeData.comparePrice = row.comparePrice
                ? parseFloat(row.comparePrice)
                : null;
            if (row.costPrice !== undefined)
              safeData.costPrice = row.costPrice
                ? parseFloat(row.costPrice)
                : null;
            if (row.lowStockThreshold)
              safeData.lowStockThreshold = parseInt(row.lowStockThreshold) || 5;
            if (row.status) safeData.status = row.status;
            if (row.description !== undefined)
              safeData.description = row.description || null;
            if (row.shortDescription !== undefined)
              safeData.shortDescription = row.shortDescription || null;
            if (row.isFeatured !== undefined)
              safeData.isFeatured = row.isFeatured === "true";
            if (row.isNewArrival !== undefined)
              safeData.isNewArrival = row.isNewArrival === "true";
            if (row.isOnPromotion !== undefined)
              safeData.isOnPromotion = row.isOnPromotion === "true";
            if (row.tags) safeData.tags = row.tags.split("|").filter(Boolean);
            if (row.barcode !== undefined)
              safeData.barcode = row.barcode || null;
            if (row.netWeight !== undefined)
              safeData.netWeight = row.netWeight || null;
            if (row.unitsPerCarton !== undefined)
              safeData.unitsPerCarton = row.unitsPerCarton
                ? parseInt(row.unitsPerCarton)
                : null;
            if (row.origin !== undefined) safeData.origin = row.origin || null;
            if (row.weight !== undefined)
              safeData.weight = row.weight ? parseFloat(row.weight) : null;
            if (row.isHalal !== undefined)
              safeData.isHalal = row.isHalal === "true";
            if (row.isOrganic !== undefined)
              safeData.isOrganic = row.isOrganic === "true";
            if (row.isKosher !== undefined)
              safeData.isKosher = row.isKosher === "true";
            if (row.isVegan !== undefined)
              safeData.isVegan = row.isVegan === "true";
            if (row.isGlutenFree !== undefined)
              safeData.isGlutenFree = row.isGlutenFree === "true";
            if (row.naifdaNumber !== undefined)
              safeData.naifdaNumber = row.naifdaNumber || null;
            if (row.storageInstructions !== undefined)
              safeData.storageInstructions = row.storageInstructions || null;
            if (row.ingredients !== undefined)
              safeData.ingredients = row.ingredients || null;
            if (row.allergens !== undefined)
              safeData.allergens = row.allergens
                ? row.allergens.split("|").filter(Boolean)
                : [];
            // ── Scalable / weighted product ── (variations deliberately
            // excluded here — structural/nested changes stay admin-only,
            // same boundary as new-product creation just above)
            if (row.isScalable !== undefined)
              safeData.isScalable = row.isScalable === "true";
            if (row.scaleUnit !== undefined)
              safeData.scaleUnit = row.scaleUnit || null;
            if (row.pricePerUnit !== undefined)
              safeData.pricePerUnit = row.pricePerUnit
                ? parseFloat(row.pricePerUnit)
                : null;
            if (row.minOrderQty !== undefined)
              safeData.minOrderQty = row.minOrderQty
                ? parseFloat(row.minOrderQty)
                : null;
            if (row.maxOrderQty !== undefined)
              safeData.maxOrderQty = row.maxOrderQty
                ? parseFloat(row.maxOrderQty)
                : null;
            if (row.scaleStep !== undefined)
              safeData.scaleStep = row.scaleStep ? parseFloat(row.scaleStep) : null;
            if (row.scalePresets !== undefined)
              safeData.scalePresets = row.scalePresets
                ? row.scalePresets
                    .split("|")
                    .map((n: string) => parseFloat(n))
                    .filter((n: number) => !isNaN(n))
                : [];
            if (row.scaleWareCode !== undefined) {
              const code = row.scaleWareCode?.trim() || null;
              if (code) {
                const owner = wareCodeOwner.get(code);
                if (owner && owner !== row.sku) {
                  throw new Error(
                    `Scale ware code "${code}" is already used by SKU ${owner}`,
                  );
                }
                wareCodeOwner.set(code, row.sku);
              }
              safeData.scaleWareCode = code;
            }
            if (Object.keys(safeData).length > 0) {
              await prisma.product.update({
                where: { sku: row.sku },
                data: safeData,
              });
            }
            results.success++;
          } else {
            throw new Error(
              `Product not found for SKU: ${row.sku}. Only admins can create new products via CSV.`,
            );
          }
        } catch (err: any) {
          results.failed++;
          results.errors.push({ row: rowNum, error: err.message, data: row });
        }
      });

      // Notify admin emails (fire-and-forget)
      if (results.stockRequests > 0) {
        prisma.siteSetting
          .findFirst()
          .then((cfg) => {
            const adminEmails: string[] =
              (cfg as any)?.adminNotificationEmails ?? [];
            if (adminEmails.length === 0) return;
            const {
              sendAdminStockNotificationEmail,
            } = require("../services/email.service");
            sendAdminStockNotificationEmail(adminEmails, {
              productName: `${results.stockRequests} product(s) via CSV`,
              productSku: "CSV_IMPORT",
              requestedBy: user!.name,
              requestedByRole: req.user!.role,
              currentQty: 0,
              requestedQty: 0,
              reason: `Bulk CSV import — ${results.stockRequests} stock change(s) pending approval`,
              source: "CSV_IMPORT",
              autoApproved: false,
            }).catch((err: any) =>
              console.error("[email] CSV stock notification failed:", err),
            );
          })
          .catch(() => {});
      }

      return res.status(200).json({
        success: true,
        data: results,
        message:
          results.stockRequests > 0
            ? `${results.stockRequests} stock change(s) submitted for admin approval. ${results.success} field(s) updated.`
            : `${results.success} product(s) updated.`,
      });
    }

    // buildData always fills every field, using a default for anything
    // absent from the row (needed for CREATE — a new product has to have
    // *something* in every field). For UPDATE that's dangerous: a CSV
    // that's missing a column (e.g. an older export, or one intentionally
    // trimmed to just a few columns for a targeted bulk edit) would silently
    // reset every field it doesn't mention back to its default — wiping
    // real data on 1000+ existing products from one re-import. This filters
    // buildData's output down to only the keys whose column was actually
    // present in this CSV row (an absent column gives `undefined`; an
    // empty-but-present cell gives `""`, which still passes through as an
    // intentional "clear this field").
    const pickPresentFields = (row: any, data: any): any => {
      const partial: any = {};
      for (const key of Object.keys(data)) {
        if (row[key] !== undefined) partial[key] = data[key];
      }
      return partial;
    };

    // ── Admin import: batched parallel upserts ────────────────────────────
    await processChunks(records, async (row: any, rowNum: number) => {
      try {
        if (!row.name || !row.sku || !row.categoryId || !row.price) {
          throw new Error(
            "Required fields missing: name, sku, categoryId, price",
          );
        }
        const existing = existingMap.get(row.sku);
        const fullData = buildData(row);
        const data = existing ? pickPresentFields(row, fullData) : fullData;

        // Claim/validate the scale ware code synchronously (before any
        // `await` below) so two rows in the same parallel chunk can't both
        // claim the same code — see wareCodeOwner comment above.
        if (data.scaleWareCode) {
          const owner = wareCodeOwner.get(data.scaleWareCode);
          if (owner && owner !== row.sku) {
            throw new Error(
              `Scale ware code "${data.scaleWareCode}" is already used by SKU ${owner}`,
            );
          }
          wareCodeOwner.set(data.scaleWareCode, row.sku);
        }

        const variations = parseVariationsCell(row.variations);

        let productId: string;
        if (existing) {
          await prisma.product.update({ where: { sku: row.sku }, data });
          productId = existing.id;
        } else {
          data.slug =
            row.slug?.trim() ||
            row.name
              .toLowerCase()
              .replace(/[^a-z0-9]+/g, "-")
              .replace(/(^-|-$)/g, "");
          // Ensure slug uniqueness by appending SKU suffix if needed
          const slugExists = await prisma.product.findUnique({
            where: { slug: data.slug },
          });
          if (slugExists) {
            data.slug = `${data.slug}-${row.sku.toLowerCase().replace(/[^a-z0-9]/g, "")}`;
          }
          const created = await prisma.product.create({ data });
          productId = created.id;
        }

        if (variations !== undefined) {
          await applyProductVariations(productId, variations);
        }

        results.success++;
      } catch (err: any) {
        results.failed++;
        results.errors.push({ row: rowNum, error: err.message, data: row });
      }
    });

    logActivity({
      userId: req.user?.userId,
      action: "import products CSV",
      entity: "product",
      metadata: {
        totalRows: records.length,
        success: results.success,
        failed: results.failed,
      },
      req,
    });

    res.status(200).json({ success: true, data: results });
  } catch (error) {
    next(error);
  }
};

// ── DOWNLOAD CSV TEMPLATE ─────────────────────────────────────────────────────
export const downloadCSVTemplate = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const template = [
      {
        name: "Example Product",
        slug: "example-product",
        sku: "PROD-001",
        barcode: "5901234123457",
        description: "Full product description goes here",
        shortDescription: "Short one-line description",
        price: "5000",
        comparePrice: "6000",
        costPrice: "3000",
        stockQuantity: "100",
        lowStockThreshold: "10",
        categoryId: "PASTE_CATEGORY_ID_HERE",
        brandId: "PASTE_BRAND_ID_HERE (or leave blank)",
        status: "ACTIVE",
        isFeatured: "false",
        isNewArrival: "false",
        isOnPromotion: "false",
        tags: "tag1|tag2|tag3",
        images: "https://example.com/image1.jpg|https://example.com/image2.jpg",
        netWeight: "500g",
        unitsPerCarton: "12",
        origin: "Nigeria",
        weight: "0.5",
        isHalal: "false",
        isOrganic: "false",
        isKosher: "false",
        isVegan: "false",
        isGlutenFree: "false",
        naifdaNumber: "",
        storageInstructions: "Store in a cool dry place",
        ingredients: "Ingredient 1, Ingredient 2",
        allergens: "Nuts|Gluten",
        // ── Scalable / weighted product — leave isScalable "false" and the
        // rest blank for a normal fixed-price/fixed-quantity product. ──
        isScalable: "false",
        scaleUnit: "kg",
        pricePerUnit: "2000",
        minOrderQty: "0.1",
        maxOrderQty: "10",
        scaleStep: "0.1",
        scalePresets: "0.5|1|2",
        scaleWareCode: "",
        variations: "",
      },
    ];

    const csv = stringify(template, {
      header: true,
      columns: [...PRODUCT_CSV_COLUMNS],
    });
    res.setHeader("Content-Type", "text/csv");
    res.setHeader(
      "Content-Disposition",
      "attachment; filename=product-import-template.csv",
    );
    res.send(csv);
  } catch (error) {
    next(error);
  }
};

// ── CATALOGUE PDF (single column, images embedded, logo from settings) ────────
export const exportCataloguePDF = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const { categoryId, featured } = req.query;
    const where: any = { status: "ACTIVE" };
    if (categoryId) where.categoryId = categoryId;
    if (featured === "true") where.isFeatured = true;

    // ── Fetch ALL products (no limit) ──
    const [products, settings] = await Promise.all([
      prisma.product.findMany({
        where,
        include: { category: true, brand: true },
        orderBy: [{ category: { name: "asc" } }, { name: "asc" }],
      }),
      prisma.siteSetting.findFirst(),
    ]);

    const companyName = settings?.siteName || "NigitTriple Industry";
    const companyAddress =
      settings?.address || "Port Harcourt, Rivers State, Nigeria";
    const companyWebsite = (settings as any)?.website || "NigitTriple.com";
    const logoUrl = settings?.logo || null;

    const doc = new PDFDocument({
      margin: 40,
      size: "A4",
      autoFirstPage: true,
    });
    const bufferPromise = pdfToBuffer(doc);

    const PAGE_W = 515; // usable width (595 - 2*40)
    const LEFT = 40;

    // ── COVER PAGE ────────────────────────────────────────────────────────────
    // Try to embed logo
    if (logoUrl) {
      const logoBuffer = await fetchImageBuffer(logoUrl);
      if (logoBuffer) {
        try {
          doc.image(logoBuffer, LEFT + PAGE_W / 2 - 60, 80, {
            width: 120,
            height: 60,
            fit: [120, 60],
          });
          doc.moveDown(5);
        } catch {
          // logo embed failed — fall back to text
          doc
            .fontSize(26)
            .font("Helvetica-Bold")
            .fillColor("#16a34a")
            .text(companyName, LEFT, 80, { align: "center", width: PAGE_W });
          doc.moveDown(0.5);
        }
      } else {
        doc
          .fontSize(26)
          .font("Helvetica-Bold")
          .fillColor("#16a34a")
          .text(companyName, LEFT, 80, { align: "center", width: PAGE_W });
        doc.moveDown(0.5);
      }
    } else {
      doc
        .fontSize(26)
        .font("Helvetica-Bold")
        .fillColor("#16a34a")
        .text(companyName, LEFT, 80, { align: "center", width: PAGE_W });
      doc.moveDown(0.5);
    }

    doc
      .fontSize(16)
      .font("Helvetica")
      .fillColor("#374151")
      .text("Product Catalogue", LEFT, doc.y, {
        align: "center",
        width: PAGE_W,
      });
    doc.moveDown(0.4);
    doc
      .fontSize(10)
      .fillColor("#6b7280")
      .text(
        `${new Date().toLocaleDateString("en-NG", { month: "long", year: "numeric" })} · ${products.length} products`,
        LEFT,
        doc.y,
        { align: "center", width: PAGE_W },
      );
    doc.moveDown(3);

    // Divider
    doc
      .moveTo(LEFT, doc.y)
      .lineTo(LEFT + PAGE_W, doc.y)
      .strokeColor("#e5e7eb")
      .stroke();
    doc.moveDown(1.5);

    // ── PRODUCTS — single column ──────────────────────────────────────────────
    const IMG_SIZE = 70; // product image box
    const ROW_GAP = 10; // gap between rows
    const MIN_ROW_H = IMG_SIZE + ROW_GAP;

    for (let i = 0; i < products.length; i++) {
      const product = products[i];

      // Add a new page if not enough room
      if (doc.y + MIN_ROW_H > doc.page.height - 60) {
        doc.addPage();
      }

      const rowY = doc.y;

      // ── Product Image ──
      const firstImage = product.images?.[0] || null;
      let imageDrawn = false;

      if (firstImage) {
        const imgBuf = await fetchImageBuffer(firstImage);
        if (imgBuf) {
          try {
            doc.image(imgBuf, LEFT, rowY, {
              width: IMG_SIZE,
              height: IMG_SIZE,
              fit: [IMG_SIZE, IMG_SIZE],
            });
            imageDrawn = true;
          } catch {
            /* fall through to placeholder */
          }
        }
      }

      if (!imageDrawn) {
        // Grey placeholder box
        doc
          .rect(LEFT, rowY, IMG_SIZE, IMG_SIZE)
          .fillAndStroke("#f3f4f6", "#e5e7eb");
        doc
          .fontSize(7)
          .fillColor("#9ca3af")
          .text("No image", LEFT, rowY + IMG_SIZE / 2 - 4, {
            width: IMG_SIZE,
            align: "center",
          });
      }

      // ── Product Text (right of image) ──
      const textX = LEFT + IMG_SIZE + 14;
      const textW = PAGE_W - IMG_SIZE - 14;
      let textY = rowY;

      // Product name
      doc
        .fontSize(10)
        .font("Helvetica-Bold")
        .fillColor("#111827")
        .text(product.name, textX, textY, { width: textW, lineBreak: false });
      textY = doc.y + 3;

      // Brand · Category
      const sub = [product.brand?.name, product.category?.name]
        .filter(Boolean)
        .join(" · ");
      if (sub) {
        doc
          .fontSize(8)
          .font("Helvetica")
          .fillColor("#6b7280")
          .text(sub, textX, textY, { width: textW });
        textY = doc.y + 3;
      }

      // Price — use N instead of ₦ so pdfkit renders it correctly
      doc
        .fontSize(12)
        .font("Helvetica-Bold")
        .fillColor("#16a34a")
        .text(naira(product.price), textX, textY, { width: textW });
      textY = doc.y + 3;

      // Short description (if fits)
      if (product.shortDescription) {
        doc
          .fontSize(8)
          .font("Helvetica")
          .fillColor("#4b5563")
          .text(product.shortDescription.substring(0, 120), textX, textY, {
            width: textW,
            lineBreak: true,
          });
        textY = doc.y + 2;
      }

      // SKU
      doc
        .fontSize(7)
        .font("Helvetica")
        .fillColor("#9ca3af")
        .text(`SKU: ${product.sku}`, textX, textY, { width: textW });

      // Move doc cursor to bottom of row (max of image bottom and text bottom)
      const rowBottom = Math.max(rowY + IMG_SIZE, doc.y) + ROW_GAP;

      // Separator line
      if (i < products.length - 1) {
        doc
          .moveTo(LEFT, rowBottom - ROW_GAP / 2)
          .lineTo(LEFT + PAGE_W, rowBottom - ROW_GAP / 2)
          .strokeColor("#f3f4f6")
          .stroke();
      }

      doc.y = rowBottom;
    }

    // ── Footer ────────────────────────────────────────────────────────────────
    const footerY = doc.page.height - 35;
    doc
      .fontSize(8)
      .font("Helvetica")
      .fillColor("#6b7280")
      .text(
        `${companyName} · ${companyAddress} · ${companyWebsite}`,
        LEFT,
        footerY,
        { align: "center", width: PAGE_W },
      );

    doc.end();
    const pdfBuffer = await bufferPromise;

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="catalogue-${Date.now()}.pdf"`,
    );
    res.setHeader("Content-Length", pdfBuffer.length);
    res.end(pdfBuffer);
  } catch (error) {
    next(error);
  }
};
