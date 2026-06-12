// backend/src/controllers/pos.controller.ts
import { Response, NextFunction } from "express";
import prisma from "../config/database";
import { AppError, NotFoundError } from "../utils/appError";
import { AuthRequest } from "../middlewares/auth.middleware";
import { log as logActivity } from "../utils/activityLogger";

// ── helpers ──────────────────────────────────────────────────────────────────

const generatePOSOrderNumber = () => {
  const date = new Date();
  const yy = String(date.getFullYear()).slice(2);
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  const rand = Math.floor(Math.random() * 9999)
    .toString()
    .padStart(4, "0");
  return `POS-${yy}${mm}${dd}-${rand}`;
};

const generateReceiptNumber = () => `RCT-${Date.now().toString().slice(-8)}`;

// ── POST /api/v1/pos/orders ───────────────────────────────────────────────────
export const createPOSOrder = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    if (!req.user) throw new AppError("Authentication required", 401);
    const staffId = req.user.userId;

    const {
      items,
      subtotal,
      discountAmount,
      discountCode,
      total,
      paymentMethod,
      amountTendered,
      changeGiven,
      splitPayments,
      paymentReference,
      customerName,
      customerPhone,
      notes,
    } = req.body;

    if (!items || items.length === 0) {
      throw new AppError("Order must have at least one item", 400);
    }

    const validatedItems: any[] = [];
    for (const item of items) {
      const product = await prisma.product.findUnique({
        where: { id: item.productId },
      });
      if (!product)
        throw new NotFoundError(`Product ${item.productId} not found`);
      if (product.status !== "ACTIVE") {
        throw new AppError(`${product.name} is not currently available`, 400);
      }
      if (product.trackInventory && product.stockQuantity < item.quantity) {
        // For scalable products, stockQuantity is in scale units (e.g. kg)
        const unit = product.isScalable
          ? ` ${product.scaleUnit || "unit"}`
          : "";
        throw new AppError(
          `Insufficient stock for ${product.name} (available: ${product.stockQuantity}${unit})`,
          400,
        );
      }
      validatedItems.push({ product, item });
    }

    const posOrderNumber = generatePOSOrderNumber();
    const receiptNumber = generateReceiptNumber();

    const posOrder = await prisma.$transaction(async (tx) => {
      const order = await tx.pOSOrder.create({
        data: {
          posOrderNumber,
          processedById: staffId,
          status: "COMPLETED",
          subtotal,
          discountAmount: discountAmount || 0,
          discountCode: discountCode || null,
          total,
          paymentMethod,
          amountTendered: amountTendered ?? null,
          changeGiven: changeGiven ?? null,
          splitPayments: splitPayments ?? undefined,
          paymentReference: paymentReference ?? null,
          customerName: customerName ?? null,
          customerPhone: customerPhone ?? null,
          notes: notes ?? null,
          receiptNumber,
          completedAt: new Date(),
          items: {
            create: items.map((item: any) => ({
              productId: item.productId,
              productName: item.productName,
              productSku: item.productSku,
              barcode: item.barcode ?? null,
              netWeight: item.netWeight ?? null,
              scaleUnit: item.scaleUnit ?? null,
              quantity: item.quantity,
              unitPrice: item.unitPrice,
              subtotal: item.subtotal,
              discountApplied: item.discountApplied ?? 0,
            })),
          },
        },
        include: { items: true },
      });

      for (const { product, item } of validatedItems) {
        if (product.trackInventory) {
          await tx.product.update({
            where: { id: product.id },
            data: {
              stockQuantity: { decrement: item.quantity },
              salesCount: { increment: item.quantity },
            },
          });
          await tx.inventoryLog.create({
            data: {
              productId: product.id,
              type: "POS_SALE",
              quantity: -item.quantity,
              previousQty: product.stockQuantity,
              newQty: product.stockQuantity - item.quantity,
              reason: "POS sale",
              reference: posOrderNumber,
            },
          });
        }
      }

      if (discountCode) {
        await tx.discount.updateMany({
          where: { code: discountCode.toUpperCase() },
          data: { usageCount: { increment: 1 } },
        });
      }

      return order;
    });

    logActivity({
      userId: req.user?.userId,
      action: "create POS sale",
      entity: "order",
      entityId: posOrder.id,
      metadata: {
        posOrderNumber,
        total: posOrder.total,
        paymentMethod: posOrder.paymentMethod,
        customerName: posOrder.customerName || "Walk-In",
      },
      req,
    });

    res.status(201).json({
      success: true,
      message: "POS order created successfully",
      data: { order: { ...posOrder, posOrderNumber, receiptNumber } },
    });
  } catch (error) {
    next(error);
  }
};

// ── GET /api/v1/pos/orders ────────────────────────────────────────────────────
export const getPOSOrders = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const {
      page = "1",
      limit = "20",
      status,
      staffId,
      startDate,
      endDate,
      search,
    } = req.query;
    const skip = (Number(page) - 1) * Number(limit);

    const where: any = {};
    if (status) where.status = status;
    if (staffId) where.processedById = staffId;
    if (startDate || endDate) {
      where.createdAt = {};
      if (startDate) where.createdAt.gte = new Date(startDate as string);
      if (endDate) {
        const end = new Date(endDate as string);
        end.setHours(23, 59, 59, 999);
        where.createdAt.lte = end;
      }
    }
    if (search) {
      where.OR = [
        { posOrderNumber: { contains: search as string, mode: "insensitive" } },
        { customerName: { contains: search as string, mode: "insensitive" } },
        { customerPhone: { contains: search as string, mode: "insensitive" } },
        { receiptNumber: { contains: search as string, mode: "insensitive" } },
      ];
    }

    const [orders, total] = await Promise.all([
      prisma.pOSOrder.findMany({
        where,
        skip,
        take: Number(limit),
        orderBy: { createdAt: "desc" },
        include: {
          items: true,
          processedBy: { select: { id: true, name: true, role: true } },
        },
      }),
      prisma.pOSOrder.count({ where }),
    ]);

    res.status(200).json({
      success: true,
      data: {
        orders,
        pagination: {
          page: Number(page),
          limit: Number(limit),
          total,
          totalPages: Math.ceil(total / Number(limit)),
          hasMore: skip + orders.length < total,
        },
      },
    });
  } catch (error) {
    next(error);
  }
};

// ── GET /api/v1/pos/orders/:id ────────────────────────────────────────────────
// FIX: `const id = req.params.id as string` — Express types params as
//      Record<string, string | string[]>, but route params are always string.
export const getPOSOrder = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const id = req.params.id as string; // ✅ was: const { id } = req.params
    const order = await prisma.pOSOrder.findUnique({
      where: { id },
      include: {
        items: {
          include: {
            product: {
              select: { id: true, name: true, images: true, netWeight: true },
            },
          },
        },
        processedBy: { select: { id: true, name: true, role: true } },
      },
    });
    if (!order) throw new NotFoundError("POS order not found");
    res.status(200).json({ success: true, data: { order } });
  } catch (error) {
    next(error);
  }
};

// ── PUT /api/v1/pos/orders/:id/void ──────────────────────────────────────────

export const voidPOSOrder = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const id = req.params.id as string; // ✅ fixes lines 276 & 287
    const { reason } = req.body;

    // Fetch the order (no include needed here — we get items inside tx below)
    const order = await prisma.pOSOrder.findUnique({ where: { id } });
    if (!order) throw new NotFoundError("POS order not found");
    if (order.status === "VOIDED") {
      throw new AppError("Order is already voided", 400);
    }
    if (order.status === "REFUNDED") {
      throw new AppError("Cannot void a refunded order", 400);
    }
    // Only COMPLETED orders have stock deducted, so only restore stock for those
    const restoreStock = order.status === "COMPLETED";

    await prisma.$transaction(async (tx) => {
      // 1. Mark voided
      await tx.pOSOrder.update({
        where: { id },
        data: {
          status: "VOIDED",
          voidedAt: new Date(),
          notes: reason ?? order.notes,
        },
      });

      // 2. Fetch order items
      const orderItems = await tx.pOSOrderItem.findMany({
        where: { posOrderId: id },
      });

      // 3. Restore stock — only for COMPLETED orders (hold/suspended orders
      //    never had stock deducted, so no restoration needed)
      if (restoreStock) {
        for (const item of orderItems) {
          const product = await tx.product.findUnique({
            where: { id: item.productId },
          });
          if (!product) continue;
          await tx.product.update({
            where: { id: item.productId },
            data: {
              stockQuantity: { increment: item.quantity },
              salesCount: { decrement: item.quantity },
            },
          });
          await tx.inventoryLog.create({
            data: {
              productId: item.productId,
              type: "RETURN",
              quantity: item.quantity,
              previousQty: product.stockQuantity,
              newQty: product.stockQuantity + item.quantity,
              reason: `POS void: ${reason || "no reason"}`,
              reference: order.posOrderNumber,
            },
          });
        }
      }
    });

    res
      .status(200)
      .json({ success: true, message: "Order voided successfully" });
  } catch (error) {
    next(error);
  }
};

// ── GET /api/v1/pos/stats ─────────────────────────────────────────────────────
export const getPOSStats = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const { date } = req.query;
    const targetDate = date ? new Date(date as string) : new Date();
    const startOfDay = new Date(targetDate);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(targetDate);
    endOfDay.setHours(23, 59, 59, 999);

    const where = {
      status: "COMPLETED" as const,
      createdAt: { gte: startOfDay, lte: endOfDay },
    };

    const [stats, recentOrders, topProducts] = await Promise.all([
      prisma.pOSOrder.aggregate({
        where,
        _sum: { total: true, discountAmount: true },
        _count: { id: true },
      }),
      prisma.pOSOrder.findMany({
        where,
        take: 10,
        orderBy: { createdAt: "desc" },
        include: {
          processedBy: { select: { name: true } },
          items: { select: { productName: true, quantity: true } },
        },
      }),
      prisma.pOSOrderItem.groupBy({
        by: ["productId", "productName"],
        where: {
          posOrder: {
            createdAt: { gte: startOfDay, lte: endOfDay },
            status: "COMPLETED",
          },
        },
        _sum: { quantity: true, subtotal: true },
        orderBy: { _sum: { quantity: "desc" } },
        take: 5,
      }),
    ]);

    const cashStats = await prisma.pOSOrder.aggregate({
      where: { ...where, paymentMethod: "CASH" },
      _sum: { total: true },
      _count: { id: true },
    });
    const cardStats = await prisma.pOSOrder.aggregate({
      where: { ...where, paymentMethod: "CARD" },
      _sum: { total: true },
      _count: { id: true },
    });
    const transferStats = await prisma.pOSOrder.aggregate({
      where: { ...where, paymentMethod: "TRANSFER" },
      _sum: { total: true },
      _count: { id: true },
    });

    res.status(200).json({
      success: true,
      data: {
        date: targetDate.toISOString().split("T")[0],
        totalOrders: stats._count.id,
        totalSales: stats._sum.total || 0,
        totalDiscount: stats._sum.discountAmount || 0,
        cashSales: cashStats._sum.total || 0,
        cashOrders: cashStats._count.id,
        cardSales: cardStats._sum.total || 0,
        cardOrders: cardStats._count.id,
        transferSales: transferStats._sum.total || 0,
        transferOrders: transferStats._count.id,
        recentOrders,
        topProducts,
      },
    });
  } catch (error) {
    next(error);
  }
};

// ── POST /api/v1/pos/sessions ─────────────────────────────────────────────────
export const openPOSSession = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    if (!req.user) throw new AppError("Authentication required", 401);
    const { openingFloat = 0 } = req.body;

    const existingOpen = await prisma.pOSSession.findFirst({
      where: { staffId: req.user.userId, status: "OPEN" },
    });
    if (existingOpen) {
      return res.status(200).json({
        success: true,
        message: "Session already open",
        data: { session: existingOpen },
      });
    }

    const session = await prisma.pOSSession.create({
      data: { staffId: req.user.userId, openingFloat, status: "OPEN" },
    });

    logActivity({
      userId: req.user?.userId,
      action: "open POS session",
      entity: "session",
      entityId: session.id,
      metadata: { openingFloat },
      req,
    });

    res.status(201).json({
      success: true,
      message: "POS session opened",
      data: { session },
    });
  } catch (error) {
    next(error);
  }
};

// ── PUT /api/v1/pos/sessions/:id/close ───────────────────────────────────────
// FIX: cast req.params.id to string — fixes lines 468 and 520
export const closePOSSession = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const id = req.params.id as string; // ✅ was: const { id } = req.params
    const { closingFloat, notes } = req.body;

    const session = await prisma.pOSSession.findUnique({ where: { id } });
    if (!session) throw new NotFoundError("Session not found");
    if (session.status === "CLOSED")
      throw new AppError("Session already closed", 400);

    const salesStats = await prisma.pOSOrder.aggregate({
      where: {
        processedById: session.staffId,
        status: "COMPLETED",
        createdAt: { gte: session.openedAt },
      },
      _sum: { total: true },
      _count: { id: true },
    });

    const cashStats = await prisma.pOSOrder.aggregate({
      where: {
        processedById: session.staffId,
        status: "COMPLETED",
        paymentMethod: "CASH",
        createdAt: { gte: session.openedAt },
      },
      _sum: { total: true },
    });

    const cardStats = await prisma.pOSOrder.aggregate({
      where: {
        processedById: session.staffId,
        status: "COMPLETED",
        paymentMethod: "CARD",
        createdAt: { gte: session.openedAt },
      },
      _sum: { total: true },
    });

    const transferStats = await prisma.pOSOrder.aggregate({
      where: {
        processedById: session.staffId,
        status: "COMPLETED",
        paymentMethod: "TRANSFER",
        createdAt: { gte: session.openedAt },
      },
      _sum: { total: true },
    });

    const cashSales = cashStats._sum.total || 0;
    const expectedCash = session.openingFloat + cashSales;
    const variance =
      closingFloat !== undefined ? closingFloat - expectedCash : undefined;

    const updated = await prisma.pOSSession.update({
      where: { id }, // ✅ id is now `string`, not `string | string[]`
      data: {
        closedAt: new Date(),
        closingFloat: closingFloat ?? null,
        expectedCash,
        variance: variance ?? null,
        totalSales: salesStats._sum.total || 0,
        totalOrders: salesStats._count.id,
        cashSales,
        cardSales: cardStats._sum.total || 0,
        transferSales: transferStats._sum.total || 0,
        notes: notes ?? null,
        status: "CLOSED",
      },
    });

    logActivity({
      userId: req.user?.userId,
      action: "close POS session",
      entity: "session",
      entityId: id,
      metadata: {
        totalOrders: updated.totalOrders,
        totalSales: updated.totalSales,
        closingFloat: updated.closingFloat,
        variance: updated.variance,
      },
      req,
    });

    res.status(200).json({
      success: true,
      message: "POS session closed",
      data: { session: updated },
    });
  } catch (error) {
    next(error);
  }
};

// ── GET /api/v1/pos/sessions ──────────────────────────────────────────────────
export const getPOSSessions = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const { page = "1", limit = "20" } = req.query;
    const skip = (Number(page) - 1) * Number(limit);

    // ── Role-based scoping ─────────────────────────────────────────────────
    // ADMIN          → every session, any role
    // MANAGER        → sessions for MANAGER/STAFF/SALES only (never ADMIN)
    // STAFF / SALES  → only their own session(s) — covers the POS terminal's
    //                  "?limit=1" call used to check for an open session
    const role = req.user?.role;
    const where: any = {};

    if (role === "ADMIN") {
      // no filter — everything
    } else if (role === "MANAGER") {
      const visibleStaff = await prisma.user.findMany({
        where: { role: { in: ["MANAGER", "STAFF", "SALES"] as any } },
        select: { id: true },
      });
      where.staffId = { in: visibleStaff.map((u) => u.id) };
    } else {
      where.staffId = req.user?.userId;
    }

    const [rawSessions, total] = await Promise.all([
      prisma.pOSSession.findMany({
        where,
        skip,
        take: Number(limit),
        orderBy: { openedAt: "desc" },
      }),
      prisma.pOSSession.count({ where }),
    ]);

    // ── Manual staff join ──────────────────────────────────────────────────────
    // POSSession has no Prisma relation to User (just a plain staffId string),
    // so we fetch the relevant User records in one extra query and stitch them in.
    const uniqueStaffIds = [
      ...new Set(rawSessions.map((s) => s.staffId).filter(Boolean)),
    ];

    const staffMap: Record<
      string,
      { name: string; email: string; role: string }
    > = {};

    if (uniqueStaffIds.length > 0) {
      const users = await prisma.user.findMany({
        where: { id: { in: uniqueStaffIds } },
        select: { id: true, name: true, email: true, role: true },
      });
      users.forEach((u) => {
        staffMap[u.id] = { name: u.name, email: u.email, role: u.role };
      });
    }

    const sessions = await Promise.all(
      rawSessions.map(async (s) => {
        // CLOSED sessions already have their final totals persisted by
        // closePOSSession — use those directly.
        if (s.status === "CLOSED") {
          return { ...s, staff: staffMap[s.staffId] ?? null };
        }

        // OPEN sessions never had totals written, so compute them live —
        // same query shape as closePOSSession — so the admin can see
        // real-time progress (matches the Staff POS Performance dashboard).
        const liveStats = await prisma.pOSOrder.aggregate({
          where: {
            processedById: s.staffId,
            status: "COMPLETED",
            createdAt: { gte: s.openedAt },
          },
          _sum: { total: true },
          _count: { id: true },
        });

        return {
          ...s,
          totalOrders: liveStats._count.id,
          totalSales: liveStats._sum.total || 0,
          staff: staffMap[s.staffId] ?? null,
        };
      }),
    );

    res.status(200).json({
      success: true,
      data: {
        sessions,
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

// ── POST /api/v1/pos/orders/:id/suspend ──────────────────────────────────────
// Pauses an OPEN transaction so the cashier can serve another customer.
// The cart items are preserved in the order; stock is NOT yet deducted.
export const suspendPOSOrder = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    if (!req.user) throw new AppError("Authentication required", 401);
    const id = req.params.id as string;
    const { label } = req.body; // optional cashier note, e.g. "Customer checking wallet"

    const order = await prisma.pOSOrder.findUnique({ where: { id } });
    if (!order) throw new NotFoundError("POS order not found");
    if (order.status !== "OPEN") {
      throw new AppError(
        `Cannot suspend an order with status "${order.status}". Only OPEN orders can be suspended.`,
        400,
      );
    }

    const updated = await prisma.pOSOrder.update({
      where: { id },
      data: {
        status: "SUSPENDED",
        suspendedAt: new Date(),
        suspendLabel: label ?? null,
      },
      include: { items: true },
    });

    logActivity({
      userId: req.user.userId,
      action: "suspend POS order",
      entity: "order",
      entityId: id,
      metadata: {
        posOrderNumber: updated.posOrderNumber,
        label: label ?? null,
        itemCount: updated.items.length,
        total: updated.total,
      },
      req,
    });

    res.status(200).json({
      success: true,
      message: "Order suspended. You can resume it at any time.",
      data: { order: updated },
    });
  } catch (error) {
    next(error);
  }
};

// ── GET /api/v1/pos/orders/suspended ─────────────────────────────────────────
// Returns all currently-suspended orders for the active session / staff member.
export const getSuspendedOrders = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    if (!req.user) throw new AppError("Authentication required", 401);

    const orders = await prisma.pOSOrder.findMany({
      where: {
        status: "SUSPENDED",
        processedById: req.user.userId, // only show the cashier their own holds
      },
      orderBy: { suspendedAt: "asc" }, // oldest first — FIFO
      include: { items: true },
    });

    res.status(200).json({ success: true, data: { orders } });
  } catch (error) {
    next(error);
  }
};

// ── PUT /api/v1/pos/orders/:id/resume ────────────────────────────────────────
// Moves a SUSPENDED order back to OPEN so the cashier can complete it.
export const resumePOSOrder = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    if (!req.user) throw new AppError("Authentication required", 401);
    const id = req.params.id as string;

    const order = await prisma.pOSOrder.findUnique({
      where: { id },
      include: { items: true },
    });
    if (!order) throw new NotFoundError("POS order not found");
    if (order.status !== "SUSPENDED") {
      throw new AppError(
        `Cannot resume an order with status "${order.status}". Only SUSPENDED orders can be resumed.`,
        400,
      );
    }

    // Re-validate stock before resuming (items may have sold out while suspended)
    for (const item of order.items) {
      const product = await prisma.product.findUnique({
        where: { id: item.productId },
      });
      if (!product) continue;
      if (product.trackInventory && product.stockQuantity < item.quantity) {
        const unit = product.isScalable
          ? ` ${product.scaleUnit || "unit"}`
          : "";
        throw new AppError(
          `Stock changed while order was suspended — ${product.name} now only has ${product.stockQuantity}${unit} available (cart has ${item.quantity}${unit}).`,
          400,
        );
      }
    }

    const updated = await prisma.pOSOrder.update({
      where: { id },
      data: {
        status: "OPEN",
        suspendedAt: null,
        suspendLabel: null,
      },
      include: { items: true },
    });

    logActivity({
      userId: req.user.userId,
      action: "resume POS order",
      entity: "order",
      entityId: id,
      metadata: {
        posOrderNumber: updated.posOrderNumber,
        itemCount: updated.items.length,
        total: updated.total,
      },
      req,
    });

    res.status(200).json({
      success: true,
      message: "Order resumed.",
      data: { order: updated },
    });
  } catch (error) {
    next(error);
  }
};

// ── POST /api/v1/pos/orders/hold ─────────────────────────────────────────────
// Creates an order directly in SUSPENDED status without touching stock.
// Used by the frontend "Hold Transaction" button.
export const holdNewPOSOrder = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    if (!req.user) throw new AppError("Authentication required", 401);
    const staffId = req.user.userId;

    const {
      items,
      subtotal,
      discountAmount,
      discountCode,
      total,
      customerName,
      customerPhone,
      label,
    } = req.body;

    if (!items || items.length === 0) {
      throw new AppError("Order must have at least one item", 400);
    }

    const posOrderNumber = generatePOSOrderNumber();

    const posOrder = await prisma.pOSOrder.create({
      data: {
        posOrderNumber,
        processedById: staffId,
        status: "SUSPENDED",
        subtotal,
        discountAmount: discountAmount || 0,
        discountCode: discountCode || null,
        // paymentMethod is unknown yet — use a placeholder
        paymentMethod: "CASH",
        total,
        customerName: customerName ?? null,
        customerPhone: customerPhone ?? null,
        suspendedAt: new Date(),
        suspendLabel: label ?? null,
        items: {
          create: items.map((item: any) => ({
            productId: item.productId,
            productName: item.productName,
            productSku: item.productSku,
            barcode: item.barcode ?? null,
            netWeight: item.netWeight ?? null,
            scaleUnit: item.scaleUnit ?? null,
            quantity: item.quantity,
            unitPrice: item.unitPrice,
            subtotal: item.subtotal,
            discountApplied: item.discountApplied ?? 0,
          })),
        },
      },
      include: { items: true },
    });

    logActivity({
      userId: req.user.userId,
      action: "hold POS order",
      entity: "order",
      entityId: posOrder.id,
      metadata: {
        posOrderNumber,
        label: label ?? null,
        total: posOrder.total,
        itemCount: posOrder.items.length,
      },
      req,
    });

    res.status(201).json({
      success: true,
      message: "Transaction held successfully.",
      data: { order: posOrder },
    });
  } catch (error) {
    next(error);
  }
};
