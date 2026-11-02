// backend/src/controllers/stockApproval.controller.ts
import { Response, NextFunction } from "express";
import prisma from "../config/database";
import { AppError, NotFoundError } from "../utils/appError";
import { AuthRequest } from "../middlewares/auth.middleware";
import { log as logActivity } from "../utils/activityLogger";
import { sendAdminStockNotificationEmail } from "../services/email.service";
import { runWithRetry } from "../lib/stockSafety";


// ─────────────────────────────────────────────────────────────────────────────
// Applies an approved request to the LIVE stock figure.
//
// A request stores the quantity the product had when it was submitted
// (`currentQty`) and the quantity the requester wants (`requestedQty`).
// Writing `requestedQty` verbatim at approval time — what this used to do —
// silently wipes out every sale, return or other adjustment that happened
// between submission and approval, which is exactly how the product list and
// the product details page ended up disagreeing. Instead the REQUESTED CHANGE
// (requestedQty - currentQty) is applied on top of whatever the stock is now,
// floored at 0. When nothing moved in between, the result is identical to the
// old behaviour (live === currentQty → live + delta === requestedQty).
// ─────────────────────────────────────────────────────────────────────────────
async function applyApprovedRequest(
  request: {
    id: string;
    productId: string;
    variationId: string | null;
    currentQty: number;
    requestedQty: number;
    reason: string | null;
  },
  admin: { id: string; name: string },
  reasonPrefix: string,
  reviewNote?: string | null,
) {
  await runWithRetry(() =>
    prisma.$transaction(async (tx) => {
      let liveQty: number;
      if (request.variationId) {
        const v = await tx.productVariation.findUnique({
          where: { id: request.variationId },
          select: { stockQuantity: true },
        });
        if (!v) throw new NotFoundError("Variation no longer exists");
        liveQty = v.stockQuantity ?? 0;
      } else {
        const p = await tx.product.findUnique({
          where: { id: request.productId },
          select: { stockQuantity: true },
        });
        if (!p) throw new NotFoundError("Product no longer exists");
        liveQty = p.stockQuantity;
      }

      const delta = request.requestedQty - request.currentQty;
      const newQty = Math.max(0, liveQty + delta);
      const drifted = liveQty !== request.currentQty;

      if (request.variationId) {
        await tx.productVariation.update({
          where: { id: request.variationId },
          data: { stockQuantity: newQty },
        });
      } else {
        await tx.product.update({
          where: { id: request.productId },
          data: { stockQuantity: newQty },
        });
      }

      const variation = request.variationId
        ? await tx.productVariation.findUnique({
            where: { id: request.variationId },
            select: { label: true },
          })
        : null;

      await tx.inventoryLog.create({
        data: {
          productId: request.productId,
          type: "ADJUSTMENT",
          quantity: Math.abs(newQty - liveQty),
          previousQty: liveQty,
          newQty,
          reason:
            `${reasonPrefix}` +
            (drifted
              ? ` (stock moved from ${request.currentQty} to ${liveQty} since the request was made — requested change of ${delta >= 0 ? "+" : ""}${delta} applied to the live figure)`
              : ""),
          reference: `approval:${request.id}`,
          variationId: request.variationId ?? undefined,
          variationLabel: variation?.label ?? undefined,
          stockMode: request.variationId ? "DEDICATED" : undefined,
          performedBy: admin.id,
          performedByName: admin.name,
        },
      });

      await tx.stockApprovalRequest.update({
        where: { id: request.id },
        data: {
          status: "APPROVED",
          reviewedBy: admin.id,
          reviewedByName: admin.name,
          reviewedAt: new Date(),
          reviewNote: reviewNote || null,
        },
      });
    }),
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/v1/stock-approvals
// Staff submits a stock change request — does NOT touch the product yet.
// ─────────────────────────────────────────────────────────────────────────────
export const createStockRequest = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const { productId, requestedQty, reason, source, variationId } = req.body;

    // Defence in depth — the route already restricts this, but SALES and
    // ACCOUNTANT must never be able to change stock by any path.
    if (!["ADMIN", "MANAGER", "STAFF"].includes(req.user!.role))
      throw new AppError("Your role is not allowed to change stock", 403);

    if (requestedQty === undefined || requestedQty < 0)
      throw new AppError("requestedQty must be >= 0", 400);

    const product = await prisma.product.findUnique({
      where: { id: productId },
      include: { variations: true },
    });
    if (!product) throw new NotFoundError("Product not found");

    const user = await prisma.user.findUnique({
      where: { id: req.user!.userId },
    });
    if (!user) throw new NotFoundError("User not found");

    // ── Resolve target: whole product (shared "per unit" pool) or one
    // specific preset's OWN dedicated stock ─────────────────────────────
    let variation: { id: string; label: string; stockQuantity: number | null } | null = null;
    if (variationId) {
      const match = product.variations.find((v) => v.id === variationId);
      if (!match) throw new NotFoundError("Variation not found on this product");
      if (match.stockQuantity === null || match.stockQuantity === undefined) {
        throw new AppError(
          `"${match.label}" shares stock with the product's main pool — adjust the product's stock directly instead of this preset.`,
          400,
        );
      }
      variation = match;
    }

    const currentQty = variation ? (variation.stockQuantity as number) : product.stockQuantity;
    const targetLabel = variation ? `${product.name} — ${variation.label}` : product.name;

    // Admin requests are auto-approved and applied immediately
    if (req.user!.role === "ADMIN") {
      await prisma.$transaction([
        variation
          ? prisma.productVariation.update({
              where: { id: variation.id },
              data: { stockQuantity: requestedQty },
            })
          : prisma.product.update({
              where: { id: productId },
              data: { stockQuantity: requestedQty },
            }),
        prisma.inventoryLog.create({
          data: {
            productId,
            type: "ADJUSTMENT",
            quantity: Math.abs(requestedQty - currentQty),
            previousQty: currentQty,
            newQty: requestedQty,
            reason: reason || "Admin stock adjustment",
            reference: `admin:${req.user!.userId}`,
            variationId: variation?.id,
            variationLabel: variation?.label,
            stockMode: variation ? "DEDICATED" : undefined,
            performedBy: req.user!.userId,
            performedByName: user.name,
          },
        }),
      ]);

      // Notify admin notification emails (fire-and-forget)
      prisma.siteSetting.findFirst().then((cfg) => {
        const adminEmails: string[] = (cfg as any)?.adminNotificationEmails ?? [];
        if (adminEmails.length === 0) return;
        sendAdminStockNotificationEmail(adminEmails, {
          productName: targetLabel,
          productSku: product.sku,
          requestedBy: user.name,
          requestedByRole: req.user!.role,
          currentQty,
          requestedQty,
          reason,
          source: source || "INVENTORY",
          autoApproved: true,
        }).catch((err) => console.error("[email] Stock notification failed:", err));
      }).catch(() => {});

      return res.status(200).json({
        success: true,
        message: "Stock updated immediately (admin)",
        data: { autoApproved: true },
      });
    }

    // Staff — create a pending request
    const request = await prisma.stockApprovalRequest.create({
      data: {
        productId,
        productName: product.name,
        productSku: product.sku,
        variationId: variation?.id,
        variationLabel: variation?.label,
        requestedBy: req.user!.userId,
        requestedByName: user.name,
        currentQty,
        requestedQty,
        reason,
        source: source || "INVENTORY",
        status: "PENDING",
      },
    });

    // Notify admin notification emails (fire-and-forget)
    prisma.siteSetting.findFirst().then((cfg) => {
      const adminEmails: string[] = (cfg as any)?.adminNotificationEmails ?? [];
      if (adminEmails.length === 0) return;
      sendAdminStockNotificationEmail(adminEmails, {
        productName: targetLabel,
        productSku: product.sku,
        requestedBy: user.name,
        requestedByRole: req.user!.role,
        currentQty,
        requestedQty,
        reason,
        source: source || "INVENTORY",
        autoApproved: false,
      }).catch((err) => console.error("[email] Stock notification failed:", err));
    }).catch(() => {});

    logActivity({
      userId: req.user!.userId,
      action: "request stock change",
      entity: "product",
      entityId: productId,
      metadata: { productName: targetLabel, productSku: product.sku, currentQty, requestedQty, reason, source, variationId: variation?.id },
      req,
    });

    res.status(201).json({
      success: true,
      message: "Stock change request submitted — awaiting admin approval",
      data: { request },
    });
  } catch (error) {
    next(error);
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/v1/stock-approvals
// Admin fetches all requests with filters
// ─────────────────────────────────────────────────────────────────────────────
export const getStockRequests = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const {
      status,
      source,
      staffId,
      search,
      page = "1",
      limit = "20",
    } = req.query;

    const where: any = {};
    if (status) where.status = status;
    if (source) where.source = source;
    if (staffId) where.requestedBy = staffId;
    if (search) {
      where.OR = [
        { productName: { contains: search as string, mode: "insensitive" } },
        { productSku: { contains: search as string, mode: "insensitive" } },
        {
          requestedByName: { contains: search as string, mode: "insensitive" },
        },
      ];
    }

    const skip = (Number(page) - 1) * Number(limit);
    const [requests, total] = await Promise.all([
      prisma.stockApprovalRequest.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip,
        take: Number(limit),
        include: {
          product: {
            select: {
              id: true,
              name: true,
              sku: true,
              images: true,
              stockQuantity: true,
              isScalable: true,
              scaleUnit: true,
            },
          },
        },
      }),
      prisma.stockApprovalRequest.count({ where }),
    ]);

    res.status(200).json({
      success: true,
      data: {
        requests,
        pagination: {
          page: Number(page),
          limit: Number(limit),
          total,
          totalPages: Math.ceil(total / Number(limit)),
        },
      },
    });
  } catch (error) {
    next(error);
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/v1/stock-approvals/:id/approve
// Admin approves a single request — applies the stock change
// ─────────────────────────────────────────────────────────────────────────────
export const approveStockRequest = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const id = req.params.id as string;
    const { reviewNote } = req.body;

    const request = await prisma.stockApprovalRequest.findUnique({
      where: { id },
    });
    if (!request) throw new NotFoundError("Request not found");
    if (request.status !== "PENDING")
      throw new AppError("Request is no longer pending", 400);

    const admin = await prisma.user.findUnique({
      where: { id: req.user!.userId },
    });

    // Apply the requested change to the live stock + mark approved atomically.
    await applyApprovedRequest(
      request,
      { id: req.user!.userId, name: admin?.name || "Admin" },
      `Approved by ${admin?.name || "admin"} — ${request.reason || "stock adjustment"}`,
      reviewNote,
    );

    logActivity({
      userId: req.user!.userId,
      action: "approve stock change",
      entity: "product",
      entityId: request.productId,
      metadata: { productName: request.productName, productSku: request.productSku, from: request.currentQty, to: request.requestedQty, requestedBy: request.requestedByName },
      req,
    });

    res
      .status(200)
      .json({ success: true, message: "Request approved and stock updated" });
  } catch (error) {
    next(error);
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/v1/stock-approvals/:id/reject
// Admin rejects a request — stock is NOT changed
// ─────────────────────────────────────────────────────────────────────────────
export const rejectStockRequest = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const id = req.params.id as string;
    const { reviewNote } = req.body;

    const request = await prisma.stockApprovalRequest.findUnique({
      where: { id },
    });
    if (!request) throw new NotFoundError("Request not found");
    if (request.status !== "PENDING")
      throw new AppError("Request is no longer pending", 400);

    const admin = await prisma.user.findUnique({
      where: { id: req.user!.userId },
    });

    await prisma.stockApprovalRequest.update({
      where: { id },
      data: {
        status: "REJECTED",
        reviewedBy: req.user!.userId,
        reviewedByName: admin?.name || "Admin",
        reviewedAt: new Date(),
        reviewNote: reviewNote || null,
      },
    });

    logActivity({
      userId: req.user!.userId,
      action: "reject stock change",
      entity: "product",
      entityId: request.productId,
      metadata: { productName: request.productName, productSku: request.productSku, requestedBy: request.requestedByName, reviewNote },
      req,
    });

    res.status(200).json({ success: true, message: "Request rejected" });
  } catch (error) {
    next(error);
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/v1/stock-approvals/bulk-approve
// Admin bulk-approves a list of request IDs
// ─────────────────────────────────────────────────────────────────────────────
export const bulkApproveStockRequests = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const { ids, reviewNote } = req.body;
    if (!Array.isArray(ids) || ids.length === 0)
      throw new AppError("ids array required", 400);

    const admin = await prisma.user.findUnique({
      where: { id: req.user!.userId },
    });

    const requests = await prisma.stockApprovalRequest.findMany({
      where: { id: { in: ids }, status: "PENDING" },
    });

    let approved = 0;
    let skipped = 0;

    for (const request of requests) {
      try {
        await applyApprovedRequest(
          request,
          { id: req.user!.userId, name: admin?.name || "Admin" },
          `Bulk approved by ${admin?.name || "admin"}`,
          reviewNote,
        );
        approved++;
      } catch {
        skipped++;
      }
    }

    res.status(200).json({
      success: true,
      message: `${approved} request(s) approved${skipped > 0 ? `, ${skipped} skipped` : ""}`,
      data: { approved, skipped },
    });
  } catch (error) {
    next(error);
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/v1/stock-approvals/pending-count
// Returns count of pending requests — used for sidebar badge
// ─────────────────────────────────────────────────────────────────────────────
export const getPendingCount = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const count = await prisma.stockApprovalRequest.count({
      where: { status: "PENDING" },
    });
    res.status(200).json({ success: true, data: { count } });
  } catch (error) {
    next(error);
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/v1/stock-approvals/pending-product-ids
// Distinct productIds with a currently-PENDING stock request — the admin
// product list uses this to show a "Stock update pending approval" label
// per row, which disappears the next time the list is fetched after the
// request is approved/rejected (no live push; a manual refresh or
// revisiting the page picks up the change).
// ─────────────────────────────────────────────────────────────────────────────
export const getPendingProductIds = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const pending = await prisma.stockApprovalRequest.findMany({
      where: { status: "PENDING" },
      select: { productId: true },
      distinct: ["productId"],
    });
    res.status(200).json({
      success: true,
      data: { productIds: pending.map((p) => p.productId) },
    });
  } catch (error) {
    next(error);
  }
};
