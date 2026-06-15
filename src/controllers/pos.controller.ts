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

    // ── Require an open POS session ──────────────────────────────────────
    // ADMIN/MANAGER can ring up sales without opening a shift session (e.g.
    // covering a till briefly). Regular STAFF/SALES must have an open
    // session — this is what ties their sales to a shift for cash
    // reconciliation, and is what was missing for accounts like Patrick's
    // (15 completed sales with no session, so they never showed up
    // correctly on the POS Sessions page).
    //
    // `activeSessionId` is stored on the order itself (POSOrder.sessionId)
    // so session totals can be computed by an exact FK match instead of
    // guessing from a createdAt timestamp range.
    let activeSessionId: string | undefined;
    const openSession = await prisma.pOSSession.findFirst({
      where: { staffId, status: "OPEN" },
    });

    if (req.user.role !== "ADMIN" && req.user.role !== "MANAGER") {
      if (!openSession) {
        throw new AppError(
          "You must open a POS session before processing sales. Tap 'Open Session' to start your shift.",
          403,
        );
      }
    }
    activeSessionId = openSession?.id;

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

    // ── Order creation transaction ────────────────────────────────────────
    // PERF FIX: previously this looped through every cart item with two
    // sequential `await`s each (product.update + inventoryLog.create) inside
    // a single $transaction. With many items and a remote MongoDB connection
    // (Atlas/Neon over a Nigerian network), the cumulative round-trip time
    // could exceed Prisma's default 5000ms interactive-transaction timeout —
    // producing "Transaction already closed: A query cannot be executed on
    // an expired transaction" errors exactly like the one reported.
    //
    // Fix: (1) run all per-item updates concurrently with Promise.all instead
    // of sequentially, cutting wall-clock time roughly in half for
    // multi-item carts, and (2) explicitly raise the transaction's timeout
    // and maxWait as a safety margin for larger orders / slower networks.
    const posOrder = await prisma.$transaction(
      async (tx) => {
        const order = await tx.pOSOrder.create({
          data: {
            posOrderNumber,
            processedById: staffId,
            status: "COMPLETED",
            sessionId: activeSessionId ?? null,
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

        // Run all per-item stock updates + inventory logs concurrently
        // instead of one-by-one — this is the main time saver for
        // multi-item carts.
        await Promise.all(
          validatedItems
            .filter(({ product }) => product.trackInventory)
            .map(({ product, item }) =>
              Promise.all([
                tx.product.update({
                  where: { id: product.id },
                  data: {
                    stockQuantity: { decrement: item.quantity },
                    salesCount: { increment: item.quantity },
                  },
                }),
                tx.inventoryLog.create({
                  data: {
                    productId: product.id,
                    type: "POS_SALE",
                    quantity: -item.quantity,
                    previousQty: product.stockQuantity,
                    newQty: product.stockQuantity - item.quantity,
                    reason: "POS sale",
                    reference: posOrderNumber,
                  },
                }),
              ]),
            ),
        );

        if (discountCode) {
          await tx.discount.updateMany({
            where: { code: discountCode.toUpperCase() },
            data: { usageCount: { increment: 1 } },
          });
        }

        return order;
      },
      {
        maxWait: 10_000, // time allowed waiting for a transaction slot
        timeout: 20_000, // time allowed for the transaction body to run
      },
    );

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

    await prisma.$transaction(
      async (tx) => {
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

        // 3. Restore stock — only for COMPLETED orders (hold/suspended
        //    orders never had stock deducted, so no restoration needed).
        // PERF FIX: per-item product lookup + update + inventory log are
        // now run concurrently (Promise.all) instead of sequentially, to
        // avoid hitting Prisma's interactive-transaction timeout on larger
        // orders — same fix applied to createPOSOrder.
        if (restoreStock && orderItems.length > 0) {
          await Promise.all(
            orderItems.map(async (item) => {
              const product = await tx.product.findUnique({
                where: { id: item.productId },
              });
              if (!product) return;
              await Promise.all([
                tx.product.update({
                  where: { id: item.productId },
                  data: {
                    stockQuantity: { increment: item.quantity },
                    salesCount: { decrement: item.quantity },
                  },
                }),
                tx.inventoryLog.create({
                  data: {
                    productId: item.productId,
                    type: "RETURN",
                    quantity: item.quantity,
                    previousQty: product.stockQuantity,
                    newQty: product.stockQuantity + item.quantity,
                    reason: `POS void: ${reason || "no reason"}`,
                    reference: order.posOrderNumber,
                  },
                }),
              ]);
            }),
          );
        }
      },
      {
        maxWait: 10_000,
        timeout: 20_000,
      },
    );

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

    // Exact match via sessionId FK — replaces the old createdAt-range
    // guess, which could mis-attribute orders if sessions overlapped or a
    // cashier's clock/timestamps were off.
    const sessionWhere = {
      sessionId: session.id,
      status: "COMPLETED" as const,
    };

    const salesStats = await prisma.pOSOrder.aggregate({
      where: sessionWhere,
      _sum: { total: true },
      _count: { id: true },
    });

    const cashStats = await prisma.pOSOrder.aggregate({
      where: { ...sessionWhere, paymentMethod: "CASH" },
      _sum: { total: true },
    });

    const cardStats = await prisma.pOSOrder.aggregate({
      where: { ...sessionWhere, paymentMethod: "CARD" },
      _sum: { total: true },
    });

    const transferStats = await prisma.pOSOrder.aggregate({
      where: { ...sessionWhere, paymentMethod: "TRANSFER" },
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
    const role = req.user?.role;

    // ── Helper: build the enriched session object for a given user ─────────
    // Returns the user's most relevant POSSession (preferring an OPEN one,
    // else their most recently CLOSED one), enriched with live stats. If the
    // user has never opened a session, returns a "NO_SESSION" placeholder so
    // they still appear in the roster.
    const buildSessionForUser = async (u: {
      id: string;
      name: string;
      email: string;
      role: string;
    }) => {
      const session =
        (await prisma.pOSSession.findFirst({
          where: { staffId: u.id, status: "OPEN" },
        })) ||
        (await prisma.pOSSession.findFirst({
          where: { staffId: u.id, status: "CLOSED" },
          orderBy: { openedAt: "desc" },
        }));

      const staff = { name: u.name, email: u.email, role: u.role };

      if (!session) {
        // No session record exists for this staff member, but they may
        // still have processed COMPLETED orders (e.g. via a role/account
        // that doesn't use session-gated POS access). Show their real
        // all-time totals instead of hardcoded zeros — this is what the
        // dashboard's "All-Time" column reflects too.
        const allTimeWhere = {
          processedById: u.id,
          status: "COMPLETED" as const,
        };

        const [liveStats, cashStats, cardStats, transferStats, recentOrders] =
          await Promise.all([
            prisma.pOSOrder.aggregate({
              where: allTimeWhere,
              _sum: { total: true },
              _count: { id: true },
            }),
            prisma.pOSOrder.aggregate({
              where: { ...allTimeWhere, paymentMethod: "CASH" },
              _sum: { total: true },
            }),
            prisma.pOSOrder.aggregate({
              where: { ...allTimeWhere, paymentMethod: "CARD" },
              _sum: { total: true },
            }),
            prisma.pOSOrder.aggregate({
              where: { ...allTimeWhere, paymentMethod: "TRANSFER" },
              _sum: { total: true },
            }),
            prisma.pOSOrder.findMany({
              where: allTimeWhere,
              orderBy: { createdAt: "desc" },
              take: 10,
              select: {
                id: true,
                posOrderNumber: true,
                receiptNumber: true,
                total: true,
                paymentMethod: true,
                customerName: true,
                createdAt: true,
              },
            }),
          ]);

        return {
          id: `no-session-${u.id}`,
          staffId: u.id,
          openedAt: null,
          closedAt: null,
          status: "NO_SESSION",
          openingFloat: 0,
          closingFloat: undefined,
          expectedCash: undefined,
          variance: undefined,
          totalSales: liveStats._sum.total || 0,
          totalOrders: liveStats._count.id,
          cashSales: cashStats._sum.total || 0,
          cardSales: cardStats._sum.total || 0,
          transferSales: transferStats._sum.total || 0,
          notes: undefined,
          recentOrders,
          staff,
        };
      }

      // CLOSED sessions already have their final totals persisted by
      // closePOSSession — use those, plus a recent-transactions list.
      if (session.status === "CLOSED") {
        const recentOrders = await prisma.pOSOrder.findMany({
          where: { sessionId: session.id, status: "COMPLETED" },
          orderBy: { createdAt: "desc" },
          take: 10,
          select: {
            id: true,
            posOrderNumber: true,
            receiptNumber: true,
            total: true,
            paymentMethod: true,
            customerName: true,
            createdAt: true,
          },
        });
        return { ...session, recentOrders, staff };
      }

      // OPEN session — compute live totals, payment-method breakdown, and a
      // recent-transactions list so the expanded panel shows real data.
      const baseWhere = {
        sessionId: session.id,
        status: "COMPLETED" as const,
      };

      const [liveStats, cashStats, cardStats, transferStats, recentOrders] =
        await Promise.all([
          prisma.pOSOrder.aggregate({
            where: baseWhere,
            _sum: { total: true },
            _count: { id: true },
          }),
          prisma.pOSOrder.aggregate({
            where: { ...baseWhere, paymentMethod: "CASH" },
            _sum: { total: true },
          }),
          prisma.pOSOrder.aggregate({
            where: { ...baseWhere, paymentMethod: "CARD" },
            _sum: { total: true },
          }),
          prisma.pOSOrder.aggregate({
            where: { ...baseWhere, paymentMethod: "TRANSFER" },
            _sum: { total: true },
          }),
          prisma.pOSOrder.findMany({
            where: baseWhere,
            orderBy: { createdAt: "desc" },
            take: 10,
            select: {
              id: true,
              posOrderNumber: true,
              receiptNumber: true,
              total: true,
              paymentMethod: true,
              customerName: true,
              createdAt: true,
            },
          }),
        ]);

      return {
        ...session,
        totalOrders: liveStats._count.id,
        totalSales: liveStats._sum.total || 0,
        cashSales: cashStats._sum.total || 0,
        cardSales: cardStats._sum.total || 0,
        transferSales: transferStats._sum.total || 0,
        recentOrders,
        staff,
      };
    };

    // ── Role-based roster ────────────────────────────────────────────────
    // ADMIN          → every user with role ADMIN/MANAGER/STAFF/SALES (i.e.
    //                  the full staff roster, including admins).
    // MANAGER        → every user EXCEPT admins (MANAGER/STAFF/SALES).
    // STAFF / SALES  → just themselves — covers the POS terminal's
    //                  "?limit=1" call used to check for an open session.
    let visibleRoles: string[];
    if (role === "ADMIN") {
      visibleRoles = ["ADMIN", "MANAGER", "STAFF", "SALES"];
    } else if (role === "MANAGER") {
      visibleRoles = ["MANAGER", "STAFF", "SALES"];
    } else {
      visibleRoles = [];
    }

    let total: number;
    let sessions: any[];

    if (visibleRoles.length > 0) {
      const [users, userCount] = await Promise.all([
        prisma.user.findMany({
          where: { role: { in: visibleRoles as any } },
          select: { id: true, name: true, email: true, role: true },
          orderBy: { name: "asc" },
          skip,
          take: Number(limit),
        }),
        prisma.user.count({ where: { role: { in: visibleRoles as any } } }),
      ]);

      total = userCount;
      sessions = await Promise.all(users.map(buildSessionForUser));
    } else {
      // Regular STAFF/SALES — only their own session, if any.
      const userId = req.user?.userId as string;
      const me = await prisma.user.findUnique({
        where: { id: userId },
        select: { id: true, name: true, email: true, role: true },
      });
      const own = me ? [await buildSessionForUser(me)] : [];
      total = own.length;
      sessions = own;
    }

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

    // Same session requirement as createPOSOrder — see comment there.
    let activeSessionId: string | undefined;
    const openSession = await prisma.pOSSession.findFirst({
      where: { staffId, status: "OPEN" },
    });
    if (req.user.role !== "ADMIN" && req.user.role !== "MANAGER") {
      if (!openSession) {
        throw new AppError(
          "You must open a POS session before processing sales. Tap 'Open Session' to start your shift.",
          403,
        );
      }
    }
    activeSessionId = openSession?.id;

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
        sessionId: activeSessionId ?? null,
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
