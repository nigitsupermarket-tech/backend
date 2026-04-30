// backend/src/controllers/stockApproval.controller.ts
import { Response, NextFunction } from "express";
import prisma from "../config/database";
import { AppError, NotFoundError } from "../utils/appError";
import { AuthRequest } from "../middlewares/auth.middleware";

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
    const { productId, requestedQty, reason, source } = req.body;

    if (requestedQty === undefined || requestedQty < 0)
      throw new AppError("requestedQty must be >= 0", 400);

    const product = await prisma.product.findUnique({
      where: { id: productId },
    });
    if (!product) throw new NotFoundError("Product not found");

    const user = await prisma.user.findUnique({
      where: { id: req.user!.userId },
    });
    if (!user) throw new NotFoundError("User not found");

    // Admin requests are auto-approved and applied immediately
    if (req.user!.role === "ADMIN") {
      await prisma.product.update({
        where: { id: productId },
        data: { stockQuantity: requestedQty },
      });
      await prisma.inventoryLog.create({
        data: {
          productId,
          type: "ADJUSTMENT",
          quantity: Math.abs(requestedQty - product.stockQuantity),
          previousQty: product.stockQuantity,
          newQty: requestedQty,
          reason: reason || "Admin stock adjustment",
          reference: `admin:${req.user!.userId}`,
        },
      });
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
        requestedBy: req.user!.userId,
        requestedByName: user.name,
        currentQty: product.stockQuantity,
        requestedQty,
        reason,
        source: source || "INVENTORY",
        status: "PENDING",
      },
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

    // Apply the stock change + mark approved atomically
    await prisma.$transaction([
      prisma.product.update({
        where: { id: request.productId },
        data: { stockQuantity: request.requestedQty },
      }),
      prisma.inventoryLog.create({
        data: {
          productId: request.productId,
          type: "ADJUSTMENT",
          quantity: Math.abs(request.requestedQty - request.currentQty),
          previousQty: request.currentQty,
          newQty: request.requestedQty,
          reason: `Approved by ${admin?.name || "admin"} — ${request.reason || "stock adjustment"}`,
          reference: `approval:${id}`,
        },
      }),
      prisma.stockApprovalRequest.update({
        where: { id },
        data: {
          status: "APPROVED",
          reviewedBy: req.user!.userId,
          reviewedByName: admin?.name || "Admin",
          reviewedAt: new Date(),
          reviewNote: reviewNote || null,
        },
      }),
    ]);

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
        await prisma.$transaction([
          prisma.product.update({
            where: { id: request.productId },
            data: { stockQuantity: request.requestedQty },
          }),
          prisma.inventoryLog.create({
            data: {
              productId: request.productId,
              type: "ADJUSTMENT",
              quantity: Math.abs(request.requestedQty - request.currentQty),
              previousQty: request.currentQty,
              newQty: request.requestedQty,
              reason: `Bulk approved by ${admin?.name || "admin"}`,
              reference: `approval:${request.id}`,
            },
          }),
          prisma.stockApprovalRequest.update({
            where: { id: request.id },
            data: {
              status: "APPROVED",
              reviewedBy: req.user!.userId,
              reviewedByName: admin?.name || "Admin",
              reviewedAt: new Date(),
              reviewNote: reviewNote || null,
            },
          }),
        ]);
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
