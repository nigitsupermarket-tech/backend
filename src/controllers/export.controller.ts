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
import {
  type VariationInput,
  applyProductVariations,
} from "./product.controller";
import * as XLSX from "xlsx";

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
  //
  // Stock interaction with the `stockQuantity` column above: that column
  // is ALWAYS the shared pool, applied first. If this cell changes a
  // variation's OWN dedicated stock count (a preset's `stockQuantity`
  // field inside the JSON), that change is then reconciled on top —
  // pulling from or returning to the shared pool by the equivalent
  // amount, exactly like editing it by hand in the product form (see
  // applyProductVariations in product.controller.ts). Don't set both a
  // new shared `stockQuantity` AND a new dedicated variation count in the
  // same row expecting them to be independent totals — the variation
  // change is always relative to whatever the shared column in this same
  // row just set it to.
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
// Who can do what:
//   ADMIN                     — full control: create or update any field,
//                                including stockQuantity, written immediately.
//   MANAGER / STAFF            — can now ALSO create brand-new products (this
//                                used to be admin-only), and can update
//                                existing products' non-stock fields
//                                immediately. Any stockQuantity they set —
//                                whether on a new product or an existing
//                                one — is deferred to a StockApprovalRequest
//                                instead of written directly. A newly
//                                created product sits at stockQuantity: 0
//                                until that request is approved.
//   Everyone else (e.g. SALES) — same as MANAGER/STAFF for existing
//                                products (non-stock fields update
//                                immediately, stock goes to approval), but
//                                CANNOT create new products via CSV — a row
//                                whose SKU doesn't already exist fails with
//                                a clear error, same boundary as the
//                                product-creation form itself.
// Every successful row (create or update) is recorded as an ImportBatchItem
// against a single ImportBatch for this upload, so the whole import can be
// undone later from Admin → Products → Import/Export → Recent Imports —
// but only while nothing has depended on it yet (see isBatchUndoable /
// undoImportBatch below).
export const importProductsCSV = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    if (!req.file) throw new AppError("Please upload a CSV file", 400);

    const role = req.user?.role;
    const isAdmin = role === "ADMIN";
    // Roles allowed to create brand-new products via CSV — the same set
    // the "Add Product" form allows (SALES is redirected away from
    // creating products there too — see frontend product-form.tsx).
    const canCreate = isAdmin || role === "MANAGER" || role === "STAFF";

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

    // ── Undo tracking — one entry per successful create/update ─────────────
    const batchItems: Array<{
      productId: string;
      productName: string;
      productSku: string;
      action: "CREATED" | "UPDATED";
      previousData: any | null;
      stockApprovalRequestId?: string;
    }> = [];

    // ── Helper: build product data object from a CSV row ──────────────────
    const buildData = (row: any): any => ({
      name: row.name,
      sku: row.sku,
      price: parseFloat(row.price) || 0,
      comparePrice: row.comparePrice ? parseFloat(row.comparePrice) : null,
      costPrice: row.costPrice ? parseFloat(row.costPrice) : null,
      stockQuantity: parseInt(row.stockQuantity) || 0,
      lowStockThreshold: parseInt(row.lowStockThreshold) || 5,
      // categoryId/brandId deliberately NOT included here — see the
      // explicit connect-based handling right before create/update below.
      status: (row.status as any) || "ACTIVE",
      // Product.description is a REQUIRED (non-nullable) field in the
      // schema — a blank cell must become "" here, not null, or Prisma
      // rejects the whole row with "Argument description must not be
      // null." shortDescription right below it IS optional, so that one
      // correctly stays `|| null`.
      description: row.description || "",
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
    const parseVariationsCell = (
      raw: string | undefined,
    ): VariationInput[] | undefined => {
      if (raw === undefined || raw === null || raw.trim() === "")
        return undefined;
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
    // Full records (not just a few fields) — an UPDATE row's previous
    // scalar values are snapshotted from here for undo.
    const allSkus = records.map((r: any) => r.sku).filter(Boolean);
    const existingProducts = await prisma.product.findMany({
      where: { sku: { in: allSkus } },
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

    const requestingUser = !isAdmin
      ? await prisma.user.findUnique({ where: { id: req.user!.userId } })
      : null;
    if (!isAdmin && !requestingUser) throw new AppError("User not found", 404);

    // Needed for applyProductVariations' shared-pool transfer log
    // attribution regardless of role (requestingUser above is only
    // populated for non-admins).
    const actingUser = requestingUser
      ? { id: req.user!.userId, name: requestingUser.name }
      : { id: req.user!.userId, name: undefined as string | undefined };
    if (isAdmin) {
      const admin = await prisma.user.findUnique({
        where: { id: req.user!.userId },
        select: { name: true },
      });
      actingUser.name = admin?.name;
    }

    // Strips down a full Product record to a plain object safe to hand back
    // to prisma.update() later for undo — drops id/timestamps (managed by
    // Prisma) and the relation-typed categoryId/brandId, which Prisma
    // rejects as bare scalar keys on .update() for this schema (same
    // reason the create/update paths below use explicit connect syntax).
    // Those two are restored separately in undoImportBatch via
    // category:{connect} / brand:{connect|disconnect}.
    const snapshotForUndo = (product: any) => {
      const { id, createdAt, updatedAt, categoryId, brandId, ...rest } =
        product;
      return { ...rest, categoryId, brandId };
    };

    await processChunks(records, async (row: any, rowNum: number) => {
      try {
        if (!row.sku) throw new Error("SKU is required");
        const existing = existingMap.get(row.sku);

        // ══════════════════════════════════════════════════════════════
        // UPDATE an existing product
        // ══════════════════════════════════════════════════════════════
        if (existing) {
          const previousData = snapshotForUndo(existing);
          let stockApprovalRequestId: string | undefined;

          // Stock change → approval request (everyone except ADMIN)
          if (
            !isAdmin &&
            row.stockQuantity !== undefined &&
            row.stockQuantity !== "" &&
            parseInt(row.stockQuantity) !== existing.stockQuantity
          ) {
            const requestedQty = parseInt(row.stockQuantity);
            if (isNaN(requestedQty) || requestedQty < 0) {
              throw new Error(`Invalid stockQuantity: ${row.stockQuantity}`);
            }
            const request = await prisma.stockApprovalRequest.create({
              data: {
                productId: existing.id,
                productName: existing.name,
                productSku: existing.sku,
                requestedBy: req.user!.userId,
                requestedByName: requestingUser!.name,
                currentQty: existing.stockQuantity,
                requestedQty,
                reason:
                  row.reason ||
                  `CSV import by ${requestingUser!.name} (${req.user!.role})`,
                source: "CSV_IMPORT",
                status: "PENDING",
              },
            });
            results.stockRequests++;
            stockApprovalRequestId = request.id;
          }

          if (isAdmin) {
            // Full direct update, every present column, including stock.
            const fullData = buildData(row);
            const data = pickPresentFields(row, fullData);
            if (data.scaleWareCode) {
              const owner = wareCodeOwner.get(data.scaleWareCode);
              if (owner && owner !== row.sku) {
                throw new Error(
                  `Scale ware code "${data.scaleWareCode}" is already used by SKU ${owner}`,
                );
              }
              wareCodeOwner.set(data.scaleWareCode, row.sku);
            }
            if (row.categoryId !== undefined) {
              data.category = { connect: { id: row.categoryId } };
            }
            if (row.brandId !== undefined) {
              data.brand = row.brandId
                ? { connect: { id: row.brandId } }
                : { disconnect: true };
            }
            const variations = parseVariationsCell(row.variations);
            await prisma.product.update({ where: { sku: row.sku }, data });
            if (variations !== undefined) {
              await applyProductVariations(existing.id, variations, actingUser);
            }
          } else {
            // Non-stock fields update immediately; stock handled above.
            const safeData: any = {};
            if (row.name) safeData.name = row.name;
            if (row.price)
              safeData.price = parseFloat(row.price) || existing.price;
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
              safeData.description = row.description || ""; // required field — see buildData comment
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
              safeData.scaleStep = row.scaleStep
                ? parseFloat(row.scaleStep)
                : null;
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
          }

          batchItems.push({
            productId: existing.id,
            productName: existing.name,
            productSku: existing.sku,
            action: "UPDATED",
            previousData,
            stockApprovalRequestId,
          });
          results.success++;
          return;
        }

        // ══════════════════════════════════════════════════════════════
        // CREATE a brand-new product
        // ══════════════════════════════════════════════════════════════
        if (!canCreate) {
          throw new Error(
            `Product not found for SKU: ${row.sku}. Your role can't create new products via CSV — ask an admin, manager, or staff member to import it.`,
          );
        }
        if (!row.name || !row.sku || !row.categoryId || !row.price) {
          throw new Error(
            "Required fields missing: name, sku, categoryId, price",
          );
        }

        const fullData = buildData(row);

        if (fullData.scaleWareCode) {
          const owner = wareCodeOwner.get(fullData.scaleWareCode);
          if (owner && owner !== row.sku) {
            throw new Error(
              `Scale ware code "${fullData.scaleWareCode}" is already used by SKU ${owner}`,
            );
          }
          wareCodeOwner.set(fullData.scaleWareCode, row.sku);
        }

        const variations = parseVariationsCell(row.variations);

        // Non-admin creators: the row's requested stock is deferred to
        // approval, same as it would be for an update — a brand-new
        // product just starts that approval from a currentQty of 0.
        const requestedStock = fullData.stockQuantity;
        if (!isAdmin) fullData.stockQuantity = 0;

        fullData.category = { connect: { id: row.categoryId } };
        if (row.brandId) fullData.brand = { connect: { id: row.brandId } };

        fullData.slug =
          row.slug?.trim() ||
          row.name
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/(^-|-$)/g, "");
        const slugExists = await prisma.product.findUnique({
          where: { slug: fullData.slug },
        });
        if (slugExists) {
          fullData.slug = `${fullData.slug}-${row.sku.toLowerCase().replace(/[^a-z0-9]/g, "")}`;
        }

        const created = await prisma.product.create({ data: fullData });

        if (variations !== undefined) {
          await applyProductVariations(created.id, variations, actingUser);
        }

        let stockApprovalRequestId: string | undefined;
        if (!isAdmin && requestedStock > 0) {
          const request = await prisma.stockApprovalRequest.create({
            data: {
              productId: created.id,
              productName: created.name,
              productSku: created.sku,
              requestedBy: req.user!.userId,
              requestedByName: requestingUser!.name,
              currentQty: 0,
              requestedQty: requestedStock,
              reason: `Initial stock for new product via CSV import by ${requestingUser!.name} (${req.user!.role})`,
              source: "CSV_IMPORT",
              status: "PENDING",
            },
          });
          results.stockRequests++;
          stockApprovalRequestId = request.id;
        }

        batchItems.push({
          productId: created.id,
          productName: created.name,
          productSku: created.sku,
          action: "CREATED",
          previousData: null,
          stockApprovalRequestId,
        });
        results.success++;
      } catch (err: any) {
        results.failed++;
        results.errors.push({ row: rowNum, error: err.message, data: row });
      }
    });

    // ── Record this run as an undoable batch (only if it actually did
    // something — nothing to undo for an all-failed import) ───────────────
    if (batchItems.length > 0) {
      const batch = await prisma.importBatch.create({
        data: {
          type: "CSV",
          fileName: req.file.originalname,
          performedBy: req.user!.userId,
          performedByName: isAdmin
            ? "Admin"
            : requestingUser?.name || "Unknown",
          performedByRole: req.user!.role,
          totalRows: records.length,
          createdCount: batchItems.filter((b) => b.action === "CREATED").length,
          updatedCount: batchItems.filter((b) => b.action === "UPDATED").length,
          failedCount: results.failed,
          stockRequestCount: results.stockRequests,
        },
      });
      await prisma.importBatchItem.createMany({
        data: batchItems.map((b) => ({ ...b, batchId: batch.id })),
      });
    }

    // Notify admin emails (fire-and-forget) — any role's import can
    // generate approval requests now, not just non-admin updates.
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
            requestedBy: requestingUser?.name || "Admin",
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

    logActivity({
      userId: req.user?.userId,
      action: "import products CSV",
      entity: "product",
      metadata: {
        totalRows: records.length,
        success: results.success,
        failed: results.failed,
        stockRequests: results.stockRequests,
      },
      req,
    });

    res.status(200).json({
      success: true,
      data: results,
      message:
        results.stockRequests > 0
          ? `${results.success} product(s) imported. ${results.stockRequests} stock change(s) pending admin approval.`
          : `${results.success} product(s) imported.`,
    });
  } catch (error) {
    next(error);
  }
};

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
function pickPresentFields(row: any, data: any): any {
  const partial: any = {};
  for (const key of Object.keys(data)) {
    if (row[key] !== undefined) partial[key] = data[key];
  }
  return partial;
}

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

// ============================================================
// IMPORT SCALE GOODS  (CECON scale PLU sheet, e.g. SCALE_GOODS.xlsx)
// ============================================================
// Recognizes the exact layout the CECON scale's own PLU export produces
// (mscale: Merchandise → Export) — a header row containing "Name", "Code",
// and "Price" columns (an optional leading "PLU NO" column is ignored) —
// plus two OPTIONAL columns this app looks for on top of that:
//   "Stock"     a per-item stock count, so it doesn't have to default to
//               the same number for every row
//   "Category"  a per-item category name (matched case-insensitively; a
//               name that doesn't match any existing category falls back
//               to the generic default below, same as a row with no
//               Category cell at all)
//
// Every matched row becomes a brand-new product identified by its scale
// Code, with everything the sheet doesn't carry filled in automatically:
//   sku            generated the same way the "Add Product" form does
//                  (name-derived prefix + random suffix)
//   slug           generated from the name, de-duplicated
//   barcode        = the scale's own Code, so it scans the same off a
//                  regular barcode reader as it does off the scale
//   scaleWareCode  = same Code (links it to the physical CECON scale —
//                  see the schema comment on Product.scaleWareCode)
//   description    generic placeholder ("No description available.")
//   images         left empty — every place a product image renders
//                  (storefront, cart, admin list, POS) already falls back
//                  to the app's placeholder-product image when images is
//                  empty, so this is the same placeholder the rest of the
//                  app already uses, not a new one
//   category       the sheet's own Category cell if it matches one, else
//                  whatever was picked in the modal, else the generic
//                  default category (found or created — see
//                  resolveGenericScaleCategory below)
//   stockQuantity  the sheet's own "Stock" cell if present and valid,
//                  else the modal's "default stock" field, else 10
//   isScalable     always true — every row is sold by weight/measure on
//                  the physical CECON scale, so this is set immediately
//                  rather than left for an admin to toggle on by hand
//   scaleUnit      the modal's "unit" field (defaults to "kg")
//   pricePerUnit   = the sheet's own Price column — that column IS the
//                  per-unit price on a scale sheet, not a flat item price
//   scaleStep      the modal's "scale step" field (defaults to 0.1)
//
// A row whose Code already belongs to an existing product (matched by
// scaleWareCode) is SKIPPED, never overwritten — re-uploading the same or
// an updated sheet is always safe and only fills in what's still missing.
// Admin-only, same boundary as CSV-creating-new-products (see the isAdmin
// check in importProductsCSV above) — bulk-creating live catalogue rows is
// not something a non-admin sheet import is allowed to do.
const CECON_SHEET_STATUSES = [
  "ACTIVE",
  "DRAFT",
  "OUT_OF_STOCK",
  "DISCONTINUED",
];
const GENERIC_SCALE_CATEGORY_NAME = "Scalable Products";
const GENERIC_SCALE_CATEGORY_SLUG = "scalable-products";

function generateSlugForImport(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .trim();
}

function generateSkuForImport(name: string): string {
  const words = name.trim().split(/\s+/).slice(0, 3);
  const prefix =
    words
      .map((w) =>
        w
          .replace(/[^a-zA-Z0-9]/g, "")
          .toUpperCase()
          .slice(0, 3),
      )
      .join("")
      .slice(0, 8) || "PROD";
  const suffix = Math.floor(Math.random() * 0xfffff)
    .toString(16)
    .toUpperCase()
    .padStart(5, "0");
  return `${prefix}-${suffix}`;
}

// Finds (or, the very first time it's needed, creates) the generic
// fallback category every scale-sheet row lands in when it doesn't name
// its own category and no category was picked in the modal. Idempotent —
// safe to call from many concurrent imports; a duplicate-slug create race
// just re-fetches the one that won.
async function resolveGenericScaleCategory(): Promise<{
  id: string;
  name: string;
}> {
  const existing = await prisma.category.findUnique({
    where: { slug: GENERIC_SCALE_CATEGORY_SLUG },
  });
  if (existing) return existing;
  try {
    return await prisma.category.create({
      data: {
        name: GENERIC_SCALE_CATEGORY_NAME,
        slug: GENERIC_SCALE_CATEGORY_SLUG,
        description:
          "Auto-created default category for scale-sheet imports without their own category.",
        isActive: true,
      },
    });
  } catch {
    // Lost a create race to another concurrent import — just look it up.
    const winner = await prisma.category.findUnique({
      where: { slug: GENERIC_SCALE_CATEGORY_SLUG },
    });
    if (winner) return winner;
    throw new AppError("Could not resolve the generic scale category", 500);
  }
}

export const importScaleGoodsSheet = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    if (req.user?.role !== "ADMIN") {
      throw new AppError(
        "Only admins can bulk-create products from a scale sheet",
        403,
      );
    }
    if (!req.file)
      throw new AppError("Please upload the scale sheet (.xlsx)", 400);

    // categoryId from the modal is now OPTIONAL — it's only the fallback
    // used when a row has no Category cell (or the sheet has no Category
    // column at all) and nothing matches the generic default's name.
    const { categoryId, brandId } = req.body;
    let fallbackCategory: { id: string; name: string } | null = null;
    if (categoryId) {
      const category = await prisma.category.findUnique({
        where: { id: categoryId },
      });
      if (!category) throw new AppError("Category not found", 404);
      fallbackCategory = category;
    }
    if (brandId) {
      const brand = await prisma.brand.findUnique({ where: { id: brandId } });
      if (!brand) throw new AppError("Brand not found", 404);
    }

    const defaultStock = req.body.defaultStock
      ? parseInt(req.body.defaultStock, 10)
      : 10;
    if (isNaN(defaultStock) || defaultStock < 0) {
      throw new AppError("defaultStock must be a non-negative number", 400);
    }
    const status = ((req.body.status as string) || "ACTIVE").toUpperCase();
    if (!CECON_SHEET_STATUSES.includes(status)) {
      throw new AppError(
        `status must be one of ${CECON_SHEET_STATUSES.join(", ")}`,
        400,
      );
    }

    // Every item on a CECON scale is, definitionally, sold by weight — the
    // sheet's "Price" column is the price for ONE unit of scaleUnit (e.g.
    // one kg), not a flat per-item price. So every product this importer
    // creates is marked scalable up front, with pricePerUnit set from that
    // same Price column — no more opening each one afterwards just to tick
    // "sold by measurement/scale" and retype the price that was already on
    // the sheet.
    const scaleUnit = ((req.body.scaleUnit as string) || "kg").trim() || "kg";
    const scaleStep = req.body.scaleStep ? parseFloat(req.body.scaleStep) : 0.1;
    if (isNaN(scaleStep) || scaleStep < 0) {
      throw new AppError("scaleStep must be a positive number", 400);
    }

    let workbook: XLSX.WorkBook;
    try {
      workbook = XLSX.read(req.file.buffer, { type: "buffer" });
    } catch {
      throw new AppError(
        "Could not read this file as an Excel spreadsheet",
        400,
      );
    }
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows: any[][] = XLSX.utils.sheet_to_json(sheet, {
      header: 1,
      defval: "",
    });

    const headerRowIndex = rows.findIndex(
      (row) =>
        row.some((c) => String(c).trim().toLowerCase() === "name") &&
        row.some((c) => String(c).trim().toLowerCase() === "code"),
    );
    if (headerRowIndex === -1) {
      throw new AppError(
        'This doesn\'t look like a CECON scale sheet — expected "Name" and "Code" columns ' +
          "(Merchandise → Export in mscale).",
        400,
      );
    }
    const headers = rows[headerRowIndex].map((h) =>
      String(h).trim().toLowerCase(),
    );
    const nameIdx = headers.indexOf("name");
    const codeIdx = headers.indexOf("code");
    const priceIdx = headers.indexOf("price");
    const stockIdx = headers.indexOf("stock"); // optional — this app's own addition
    const categoryIdx = headers.indexOf("category"); // optional — this app's own addition
    if (priceIdx === -1) {
      throw new AppError('Missing a "Price" column in this sheet.', 400);
    }

    type ParsedRow = {
      name: string;
      code: string;
      price: number;
      stock: number | null;
      categoryName: string | null;
      rowNum: number;
    };
    const parsed: ParsedRow[] = [];
    for (let i = headerRowIndex + 1; i < rows.length; i++) {
      const row = rows[i];
      const name = String(row[nameIdx] ?? "").trim();
      const codeRaw = row[codeIdx];
      const code =
        codeRaw === "" || codeRaw === undefined || codeRaw === null
          ? null
          : String(codeRaw).trim();
      const priceRaw = row[priceIdx];
      let price: number | null = null;
      if (typeof priceRaw === "number") price = priceRaw;
      else if (priceRaw) {
        const cleaned = String(priceRaw).replace(/[^0-9.]/g, "");
        const n = parseFloat(cleaned);
        price = isNaN(n) ? null : n;
      }
      if (!name || !code || price === null) continue;

      let stock: number | null = null;
      if (stockIdx !== -1) {
        const stockRaw = row[stockIdx];
        if (stockRaw !== "" && stockRaw !== undefined && stockRaw !== null) {
          const n = parseInt(String(stockRaw), 10);
          if (!isNaN(n) && n >= 0) stock = n;
        }
      }

      let categoryName: string | null = null;
      if (categoryIdx !== -1) {
        const catRaw = row[categoryIdx];
        if (catRaw !== "" && catRaw !== undefined && catRaw !== null) {
          categoryName = String(catRaw).trim() || null;
        }
      }

      parsed.push({ name, code, price, stock, categoryName, rowNum: i + 1 });
    }

    const results = {
      success: 0,
      failed: 0,
      skipped: 0,
      errors: [] as Array<{ row: number; error: string; data: any }>,
    };

    if (parsed.length === 0) {
      return res.status(200).json({
        success: true,
        data: results,
        message:
          "No valid rows found — every row needs a Name, Code, and Price.",
      });
    }

    // ── Existing DB state, so we don't collide or duplicate ────────────────
    const [existingByWareCode, existingSkus, existingSlugs, allCategories] =
      await Promise.all([
        prisma.product.findMany({
          where: { scaleWareCode: { not: null } },
          select: { scaleWareCode: true },
        }),
        prisma.product.findMany({ select: { sku: true } }),
        prisma.product.findMany({ select: { slug: true } }),
        prisma.category.findMany({ select: { id: true, name: true } }),
      ]);
    const publishedCodes = new Set(
      existingByWareCode.map((p) => p.scaleWareCode as string),
    );
    const takenSkus = new Set(existingSkus.map((p) => p.sku));
    const takenSlugs = new Set(existingSlugs.map((p) => p.slug));
    const seenCodesThisRun = new Set<string>();
    const categoryByName = new Map(
      allCategories.map((c) => [c.name.trim().toLowerCase(), c]),
    );

    // Lazily resolved — only hit the DB for the generic category if a row
    // actually needs it (no per-row Category match AND no modal fallback).
    let genericCategory: { id: string; name: string } | null = null;
    const getGenericCategory = async () => {
      if (!genericCategory)
        genericCategory = await resolveGenericScaleCategory();
      return genericCategory;
    };

    const batchItems: Array<{
      productId: string;
      productName: string;
      productSku: string;
      action: "CREATED";
      previousData: null;
    }> = [];

    // Sequential on purpose (not chunked/parallel like importProductsCSV) —
    // sku/slug/scale-code uniqueness here depends on a shared, mutating
    // in-memory Set checked-then-claimed per row, which parallel writes
    // could race past each other on.
    for (const row of parsed) {
      try {
        if (publishedCodes.has(row.code) || seenCodesThisRun.has(row.code)) {
          results.skipped++;
          continue;
        }
        seenCodesThisRun.add(row.code);

        // Category resolution priority: row's own Category cell → modal's
        // selected category → generic default (found/created once).
        let resolvedCategoryId: string;
        if (row.categoryName) {
          const match = categoryByName.get(
            row.categoryName.trim().toLowerCase(),
          );
          if (match) {
            resolvedCategoryId = match.id;
          } else if (fallbackCategory) {
            resolvedCategoryId = fallbackCategory.id;
          } else {
            resolvedCategoryId = (await getGenericCategory()).id;
          }
        } else if (fallbackCategory) {
          resolvedCategoryId = fallbackCategory.id;
        } else {
          resolvedCategoryId = (await getGenericCategory()).id;
        }

        let slug = generateSlugForImport(row.name) || `product-${row.code}`;
        let candidateSlug = slug;
        let n = 1;
        while (takenSlugs.has(candidateSlug)) {
          candidateSlug = `${slug}-${row.code.toLowerCase().replace(/[^a-z0-9]/g, "")}${n > 1 ? `-${n}` : ""}`;
          n++;
        }
        takenSlugs.add(candidateSlug);

        let sku = generateSkuForImport(row.name);
        while (takenSkus.has(sku)) sku = generateSkuForImport(row.name);
        takenSkus.add(sku);

        const created = await prisma.product.create({
          data: {
            name: row.name,
            slug: candidateSlug,
            sku,
            barcode: row.code,
            scaleWareCode: row.code,
            description: "No description available.",
            price: row.price,
            stockQuantity: row.stock ?? defaultStock,
            lowStockThreshold: 10,
            images: [],
            status: status as any,
            category: { connect: { id: resolvedCategoryId } },
            ...(brandId ? { brand: { connect: { id: brandId } } } : {}),
            // Scale/weight fields — see the comment above this function's
            // scaleUnit/scaleStep parsing for why these are set on every
            // row rather than left for the admin to configure by hand.
            isScalable: true,
            scaleUnit,
            pricePerUnit: row.price,
            scaleStep,
          },
        });
        batchItems.push({
          productId: created.id,
          productName: created.name,
          productSku: created.sku,
          action: "CREATED",
          previousData: null,
        });
        results.success++;
      } catch (err: any) {
        results.failed++;
        results.errors.push({ row: row.rowNum, error: err.message, data: row });
      }
    }

    if (batchItems.length > 0) {
      const batch = await prisma.importBatch.create({
        data: {
          type: "SCALE_GOODS",
          fileName: req.file.originalname,
          performedBy: req.user!.userId,
          performedByName: "Admin",
          performedByRole: req.user!.role,
          totalRows: parsed.length,
          createdCount: batchItems.length,
          updatedCount: 0,
          failedCount: results.failed,
          stockRequestCount: 0,
        },
      });
      await prisma.importBatchItem.createMany({
        data: batchItems.map((b) => ({ ...b, batchId: batch.id })),
      });
    }

    logActivity({
      userId: req.user?.userId,
      action: "import scale goods sheet",
      entity: "product",
      metadata: {
        fileName: req.file.originalname,
        totalRows: parsed.length,
        success: results.success,
        skipped: results.skipped,
        failed: results.failed,
        categoryId: categoryId || null,
      },
      req,
    });

    res.status(200).json({ success: true, data: results });
  } catch (error) {
    next(error);
  }
};

// ============================================================
// IMPORT BATCHES — list + undo
// ============================================================

// GET /export/products/import-batches
// Recent import runs (CSV or scale sheet) with enough info for the modal
// to show what happened and whether Undo is currently available.
export const listImportBatches = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const batches = await prisma.importBatch.findMany({
      orderBy: { createdAt: "desc" },
      take: 20,
    });

    // Undoability is computed fresh on every list call, not cached at
    // import time — something can go from "undoable" to "locked" at any
    // moment (a sale, a cart add, an admin approving the pending stock
    // request), so the UI always needs the current answer.
    const data = await Promise.all(
      batches.map(async (batch) => {
        if (batch.status === "UNDONE") {
          return {
            ...batch,
            undoable: false,
            undoBlockedReason: "Already undone",
          };
        }
        const check = await isBatchUndoable(batch.id);
        return {
          ...batch,
          undoable: check.undoable,
          undoBlockedReason: check.reason,
        };
      }),
    );

    res.status(200).json({ success: true, data: { batches: data } });
  } catch (error) {
    next(error);
  }
};

// Shared undoability check — used by both listImportBatches (to show/hide
// the Undo button) and undoImportBatch (to actually gate the action, never
// trusting the client's last look at the list). A batch is undoable only
// while NOTHING in the app has depended on any product it touched:
//   - no order or POS sale has ever included it
//   - it's never been added to a cart or wishlist
//   - it has no reviews
//   - no InventoryLog exists for it beyond what the import itself made
//     (the import never writes InventoryLog directly, so ANY log entry
//     means a manual adjustment or an approval happened since)
//   - none of the StockApprovalRequests this batch created were APPROVED
//     (a still-PENDING or REJECTED one is fine — nothing real happened)
async function isBatchUndoable(
  batchId: string,
): Promise<{ undoable: boolean; reason: string | null }> {
  const items = await prisma.importBatchItem.findMany({ where: { batchId } });
  if (items.length === 0) return { undoable: false, reason: "Nothing to undo" };

  const productIds = items.map((i) => i.productId);
  const approvalIds = items
    .map((i) => i.stockApprovalRequestId)
    .filter((id): id is string => !!id);

  const [
    orderCount,
    posCount,
    cartCount,
    wishlistCount,
    reviewCount,
    logCount,
    approvedCount,
  ] = await Promise.all([
    prisma.orderItem.count({ where: { productId: { in: productIds } } }),
    prisma.pOSOrderItem.count({ where: { productId: { in: productIds } } }),
    prisma.cartItem.count({ where: { productId: { in: productIds } } }),
    prisma.wishlistItem.count({ where: { productId: { in: productIds } } }),
    prisma.review.count({ where: { productId: { in: productIds } } }),
    prisma.inventoryLog.count({ where: { productId: { in: productIds } } }),
    approvalIds.length > 0
      ? prisma.stockApprovalRequest.count({
          where: { id: { in: approvalIds }, status: "APPROVED" },
        })
      : Promise.resolve(0),
  ]);

  if (approvedCount > 0)
    return {
      undoable: false,
      reason: "A stock change from this import has already been approved",
    };
  if (orderCount > 0 || posCount > 0)
    return {
      undoable: false,
      reason: "One of these products has already been sold",
    };
  if (cartCount > 0)
    return { undoable: false, reason: "A customer has this in their cart" };
  if (wishlistCount > 0)
    return { undoable: false, reason: "A customer has this on their wishlist" };
  if (reviewCount > 0)
    return { undoable: false, reason: "One of these products has a review" };
  if (logCount > 0)
    return {
      undoable: false,
      reason: "Stock has been adjusted since this import",
    };

  return { undoable: true, reason: null };
}

// POST /export/products/import-batches/:id/undo
// Reverts a whole import batch: deletes every product it CREATED, restores
// the pre-import field values on every product it UPDATED, and cancels any
// still-pending StockApprovalRequest it spawned. Refuses if isBatchUndoable
// says no — see that function for exactly what locks a batch.
export const undoImportBatch = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    if (req.user?.role !== "ADMIN") {
      throw new AppError("Only admins can undo an import", 403);
    }
    const id = req.params.id as string;
    const batch = await prisma.importBatch.findUnique({ where: { id } });
    if (!batch) throw new AppError("Import batch not found", 404);
    if (batch.status === "UNDONE") {
      throw new AppError("This import has already been undone", 400);
    }

    const check = await isBatchUndoable(id);
    if (!check.undoable) {
      throw new AppError(`Can't undo this import: ${check.reason}`, 409);
    }

    const items = await prisma.importBatchItem.findMany({
      where: { batchId: id },
    });

    let restoredCount = 0;
    let deletedCount = 0;
    let cancelledApprovals = 0;

    for (const item of items) {
      try {
        if (item.stockApprovalRequestId) {
          const req2 = await prisma.stockApprovalRequest.findUnique({
            where: { id: item.stockApprovalRequestId },
          });
          if (req2 && req2.status === "PENDING") {
            await prisma.stockApprovalRequest.update({
              where: { id: item.stockApprovalRequestId },
              data: {
                status: "REJECTED",
                reviewedBy: req.user!.userId,
                reviewedAt: new Date(),
                reviewNote:
                  "Auto-cancelled — the import that created this request was undone.",
              },
            });
            cancelledApprovals++;
          }
        }

        if (item.action === "CREATED") {
          // Cascade relations (ProductVariation, CartItem, WishlistItem,
          // Review, StockApprovalRequest) clean up automatically — see the
          // onDelete: Cascade on each in schema.prisma. isBatchUndoable
          // already confirmed none of those matter here anyway.
          await prisma.product.delete({ where: { id: item.productId } });
          deletedCount++;
        } else if (item.action === "UPDATED" && item.previousData) {
          const snapshot: any = item.previousData;
          const { categoryId, brandId, ...rest } = snapshot;
          await prisma.product.update({
            where: { id: item.productId },
            data: {
              ...rest,
              ...(categoryId
                ? { category: { connect: { id: categoryId } } }
                : {}),
              ...(brandId
                ? { brand: { connect: { id: brandId } } }
                : { brand: { disconnect: true } }),
            },
          });
          restoredCount++;
        }
      } catch (err: any) {
        // One row failing (e.g. product already deleted by something else)
        // shouldn't abort undoing the rest of the batch — surface it in
        // the activity log instead.
        console.error(`[undoImportBatch] item ${item.id} failed:`, err.message);
      }
    }

    await prisma.importBatch.update({
      where: { id },
      data: {
        status: "UNDONE",
        undoneAt: new Date(),
        undoneBy: req.user!.userId,
        undoneByName:
          (await prisma.user.findUnique({ where: { id: req.user!.userId } }))
            ?.name || "Admin",
      },
    });

    logActivity({
      userId: req.user?.userId,
      action: "undo import batch",
      entity: "product",
      metadata: {
        batchId: id,
        type: batch.type,
        deletedCount,
        restoredCount,
        cancelledApprovals,
      },
      req,
    });

    res.status(200).json({
      success: true,
      message: `Undone: ${deletedCount} product(s) deleted, ${restoredCount} restored, ${cancelledApprovals} pending request(s) cancelled.`,
      data: { deletedCount, restoredCount, cancelledApprovals },
    });
  } catch (error) {
    next(error);
  }
};
