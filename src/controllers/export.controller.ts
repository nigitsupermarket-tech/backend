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
export const exportProductsCSV = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const products = await prisma.product.findMany({
      include: { category: true, brand: true },
      orderBy: { createdAt: "desc" },
    });

    const csvData = products.map((p) => ({
      id: p.id,
      name: p.name,
      slug: p.slug,
      sku: p.sku,
      description: p.description,
      shortDescription: p.shortDescription || "",
      price: p.price,
      comparePrice: p.comparePrice || "",
      costPrice: p.costPrice || "",
      stockQuantity: p.stockQuantity,
      lowStockThreshold: p.lowStockThreshold,
      category: p.category.name,
      categoryId: p.categoryId,
      brand: p.brand?.name || "",
      brandId: p.brandId || "",
      status: p.status,
      isFeatured: p.isFeatured,
      isNewArrival: p.isNewArrival,
      tags: p.tags.join("|"),
      weight: p.weight || "",
      images: p.images.join("|"),
      barcode: p.barcode || "",
      netWeight: p.netWeight || "",
      unitsPerCarton: p.unitsPerCarton || "",
      origin: p.origin || "",
      isHalal: p.isHalal,
      isOrganic: p.isOrganic,
      isOnPromotion: p.isOnPromotion,
      viewCount: p.viewCount,
      salesCount: p.salesCount,
      createdAt: p.createdAt.toISOString(),
    }));

    const csv = stringify(csvData, {
      header: true,
      columns: [
        "id",
        "name",
        "slug",
        "sku",
        "description",
        "shortDescription",
        "price",
        "comparePrice",
        "costPrice",
        "stockQuantity",
        "lowStockThreshold",
        "category",
        "categoryId",
        "brand",
        "brandId",
        "status",
        "isFeatured",
        "isNewArrival",
        "tags",
        "weight",
        "images",
        "barcode",
        "netWeight",
        "unitsPerCarton",
        "origin",
        "isHalal",
        "isOrganic",
        "isOnPromotion",
        "viewCount",
        "salesCount",
        "createdAt",
      ],
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
      // Non-admin: stock change requests submitted for approval
      stockRequests: 0,
      stockRequestsFailed: 0,
    };

    // ── Non-admin import: stock changes go through approval ────────────────
    if (!isAdmin) {
      const user = await prisma.user.findUnique({
        where: { id: req.user!.userId },
      });
      if (!user) throw new AppError("User not found", 404);

      for (let i = 0; i < records.length; i++) {
        const row = records[i];
        const rowNum = i + 2;

        try {
          if (!row.sku) {
            throw new Error("SKU is required");
          }

          const existing = await prisma.product.findUnique({
            where: { sku: row.sku },
          });

          // ── Stock quantity change: route through approval ──────────────
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

          // ── Update non-stock fields normally (strip stockQuantity) ──────
          if (existing) {
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
              safeData.lowStockThreshold =
                parseInt(row.lowStockThreshold) || existing.lowStockThreshold;
            if (row.status) safeData.status = row.status;
            if (row.description !== undefined)
              safeData.description = row.description || null;
            if (row.shortDescription !== undefined)
              safeData.shortDescription = row.shortDescription || null;
            if (row.isFeatured !== undefined)
              safeData.isFeatured = row.isFeatured === "true";
            if (row.isNewArrival !== undefined)
              safeData.isNewArrival = row.isNewArrival === "true";
            if (row.tags) safeData.tags = row.tags.split("|").filter(Boolean);
            if (row.barcode !== undefined)
              safeData.barcode = row.barcode || null;
            if (row.netWeight !== undefined)
              safeData.netWeight = row.netWeight || null;
            if (row.isHalal !== undefined)
              safeData.isHalal = row.isHalal === "true";
            if (row.isOrganic !== undefined)
              safeData.isOrganic = row.isOrganic === "true";
            if (row.isOnPromotion !== undefined)
              safeData.isOnPromotion = row.isOnPromotion === "true";

            if (Object.keys(safeData).length > 0) {
              await prisma.product.update({
                where: { sku: row.sku },
                data: safeData,
              });
            }
            results.success++;
          } else {
            // New product creation is not allowed for non-admin via CSV
            throw new Error(
              "Only admins can create new products via CSV import. Product not found for SKU: " +
                row.sku,
            );
          }
        } catch (err: any) {
          if (String(err.message).startsWith("Only admins")) {
            results.failed++;
            results.errors.push({ row: rowNum, error: err.message, data: row });
          } else {
            results.stockRequestsFailed++;
            results.errors.push({ row: rowNum, error: err.message, data: row });
          }
        }
      }

      // Fire stock notification emails (fire-and-forget)
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
            ? `${results.stockRequests} stock change(s) submitted for admin approval. ${results.success} other field(s) updated.`
            : `${results.success} product(s) updated.`,
      });
    }

    // ── Admin import: full write as before ────────────────────────────────
    for (let i = 0; i < records.length; i++) {
      const row = records[i];
      const rowNum = i + 2;
      try {
        if (!row.name || !row.sku || !row.categoryId || !row.price) {
          throw new Error(
            "Required fields missing: name, sku, categoryId, price",
          );
        }

        const existing = await prisma.product.findUnique({
          where: { sku: row.sku },
        });

        const data: any = {
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
          tags: row.tags ? row.tags.split("|").filter(Boolean) : [],
          images: row.images ? row.images.split("|").filter(Boolean) : [],
          barcode: row.barcode || null,
          netWeight: row.netWeight || null,
          unitsPerCarton: row.unitsPerCarton
            ? parseInt(row.unitsPerCarton)
            : null,
          origin: row.origin || null,
          isHalal: row.isHalal === "true",
          isOrganic: row.isOrganic === "true",
          isOnPromotion: row.isOnPromotion === "true",
        };

        if (existing) {
          await prisma.product.update({ where: { sku: row.sku }, data });
        } else {
          if (!row.slug)
            data.slug = row.name
              .toLowerCase()
              .replace(/[^a-z0-9]+/g, "-")
              .replace(/(^-|-$)/g, "");
          else data.slug = row.slug;
          await prisma.product.create({ data });
        }
        results.success++;
      } catch (err: any) {
        results.failed++;
        results.errors.push({ row: rowNum, error: err.message, data: row });
      }
    }

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
        sku: "PROD-001",
        description: "Product description",
        shortDescription: "Short desc",
        price: "5000",
        comparePrice: "6000",
        costPrice: "3000",
        stockQuantity: "100",
        lowStockThreshold: "10",
        categoryId: "CATEGORY_ID_HERE",
        brandId: "BRAND_ID_HERE (optional)",
        status: "ACTIVE",
        isFeatured: "false",
        isNewArrival: "false",
        tags: "tag1|tag2",
        images: "https://example.com/image1.jpg",
        barcode: "",
        netWeight: "500g",
        unitsPerCarton: "12",
        origin: "Italy",
        isHalal: "false",
        isOrganic: "false",
        isOnPromotion: "false",
      },
    ];

    const csv = stringify(template, { header: true });
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
