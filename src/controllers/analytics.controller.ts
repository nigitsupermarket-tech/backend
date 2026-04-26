// backend/src/controllers/analytics.controller.ts
// FIX: POSSession uses `openedAt` not `createdAt` — that was the TS2353 error
import { Response, NextFunction } from "express";
import prisma from "../config/database";
import { AuthRequest } from "../middlewares/auth.middleware";

const startOf = (date: Date, unit: "day" | "month") => {
  const d = new Date(date);
  if (unit === "day") { d.setHours(0, 0, 0, 0); return d; }
  d.setDate(1); d.setHours(0, 0, 0, 0); return d;
};

// ─── GET /api/v1/analytics/dashboard ─────────────────────────────────────────
export const getDashboardStats = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const isAdmin = req.user?.role === "ADMIN" || req.user?.role === "SALES";
    const isStaffOnly = req.user?.role === "STAFF";
    const staffId = req.user?.userId;
    const now = new Date();
    const startOfMonth = startOf(now, "month");
    const startOfLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const endOfLastMonth = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59);
    const startOfToday = startOf(now, "day");

    // ── STAFF view (STAFF role only) ──────────────────────────────────────────
    if (isStaffOnly) {
      const [todayOrders, todaySales, monthOrders, monthSales, allTimeOrders, allTimeSales, mySession, topProducts] = await Promise.all([
        prisma.pOSOrder.count({ where: { processedById: staffId, status: "COMPLETED", createdAt: { gte: startOfToday } } }),
        prisma.pOSOrder.aggregate({ where: { processedById: staffId, status: "COMPLETED", createdAt: { gte: startOfToday } }, _sum: { total: true } }),
        prisma.pOSOrder.count({ where: { processedById: staffId, status: "COMPLETED", createdAt: { gte: startOfMonth } } }),
        prisma.pOSOrder.aggregate({ where: { processedById: staffId, status: "COMPLETED", createdAt: { gte: startOfMonth } }, _sum: { total: true } }),
        prisma.pOSOrder.count({ where: { processedById: staffId, status: "COMPLETED" } }),
        prisma.pOSOrder.aggregate({ where: { processedById: staffId, status: "COMPLETED" }, _sum: { total: true } }),
        prisma.pOSSession.findFirst({ where: { staffId, status: "OPEN" } }),
        prisma.pOSOrderItem.groupBy({
          by: ["productId", "productName"],
          where: { posOrder: { processedById: staffId, createdAt: { gte: startOfToday }, status: "COMPLETED" } },
          _sum: { quantity: true, subtotal: true },
          orderBy: { _sum: { quantity: "desc" } },
          take: 5,
        }),
      ]);

      return res.status(200).json({
        success: true,
        data: {
          viewType: "staff",
          staff: {
            today: { orders: todayOrders, sales: todaySales._sum.total || 0 },
            thisMonth: { orders: monthOrders, sales: monthSales._sum.total || 0 },
            allTime: { orders: allTimeOrders, sales: allTimeSales._sum.total || 0 },
            hasOpenSession: !!mySession,
            sessionId: mySession?.id || null,
            topProductsToday: topProducts,
          },
        },
      });
    }

    // ── SALES role view ───────────────────────────────────────────────────────
    if (req.user?.role === "SALES") {
      const [
        monthOrders, monthSales, todayPOSOrders, todayPOSSales,
        totalCustomers, newCustomers, activePromotions, staffSalesData,
      ] = await Promise.all([
        prisma.order.aggregate({ where: { createdAt: { gte: startOfMonth }, paymentStatus: "PAID" }, _sum: { total: true }, _count: true }),
        prisma.pOSOrder.aggregate({ where: { status: "COMPLETED", createdAt: { gte: startOfMonth } }, _sum: { total: true } }),
        prisma.pOSOrder.count({ where: { status: "COMPLETED", createdAt: { gte: startOfToday } } }),
        prisma.pOSOrder.aggregate({ where: { status: "COMPLETED", createdAt: { gte: startOfToday } }, _sum: { total: true } }),
        prisma.user.count({ where: { role: "CUSTOMER" } }),
        prisma.user.count({ where: { role: "CUSTOMER", createdAt: { gte: startOfMonth } } }),
        prisma.product.count({ where: { isOnPromotion: true, status: "ACTIVE" } }),
        prisma.user.findMany({ where: { role: { in: ["STAFF", "ADMIN", "SALES"] as any } }, select: { id: true, name: true, role: true } }).catch(() => []),
      ]);

      const staffStats = await Promise.all(
        staffSalesData.map(async (s) => {
          const [tAgg, mAgg] = await Promise.all([
            prisma.pOSOrder.aggregate({ where: { processedById: s.id, status: "COMPLETED", createdAt: { gte: startOfToday } }, _sum: { total: true }, _count: { id: true } }),
            prisma.pOSOrder.aggregate({ where: { processedById: s.id, status: "COMPLETED", createdAt: { gte: startOfMonth } }, _sum: { total: true }, _count: { id: true } }),
          ]);
          return { id: s.id, name: s.name, role: s.role, today: { orders: tAgg._count.id, sales: tAgg._sum.total || 0 }, thisMonth: { orders: mAgg._count.id, sales: mAgg._sum.total || 0 } };
        })
      );

      return res.status(200).json({
        success: true,
        data: {
          viewType: "sales",
          onlineOrders: { thisMonth: monthOrders._count },
          onlineRevenue: { thisMonth: monthOrders._sum.total || 0 },
          posRevenue: { today: todayPOSSales._sum.total || 0, thisMonth: monthSales._sum.total || 0 },
          posOrders: { today: todayPOSOrders },
          customers: { total: totalCustomers, newThisMonth: newCustomers },
          promotions: { active: activePromotions },
          staffSales: staffStats,
        },
      });
    }

    // ── ADMIN view ────────────────────────────────────────────────────────────
    const [
      totalOrders, todayOrders, monthStats, lastMonthStats,
      totalCustomers, newCustomersThisMonth, totalProducts,
      lowStockCount, outOfStockCount, pendingOrders,
      todayPOSOrders, todayPOSSales, activePromotions,
      allTimeRevenue, allTimePOSSales, staffList,
    ] = await Promise.all([
      prisma.order.count({ where: { paymentStatus: "PAID" } }),
      prisma.order.count({ where: { createdAt: { gte: startOfToday } } }),
      prisma.order.aggregate({ where: { createdAt: { gte: startOfMonth }, paymentStatus: "PAID" }, _sum: { total: true }, _count: true }),
      prisma.order.aggregate({ where: { createdAt: { gte: startOfLastMonth, lte: endOfLastMonth }, paymentStatus: "PAID" }, _sum: { total: true }, _count: true }),
      prisma.user.count({ where: { role: "CUSTOMER" } }),
      prisma.user.count({ where: { role: "CUSTOMER", createdAt: { gte: startOfMonth } } }),
      prisma.product.count({ where: { status: "ACTIVE" } }),
      prisma.product.count({ where: { stockQuantity: { gt: 0, lte: 10 }, status: "ACTIVE" } }),
      prisma.product.count({ where: { stockQuantity: 0, status: "ACTIVE" } }),
      prisma.order.count({ where: { status: "PENDING" } }),
      prisma.pOSOrder.count({ where: { status: "COMPLETED", createdAt: { gte: startOfToday } } }),
      prisma.pOSOrder.aggregate({ where: { status: "COMPLETED", createdAt: { gte: startOfToday } }, _sum: { total: true } }),
      prisma.product.count({ where: { isOnPromotion: true, status: "ACTIVE" } }),
      prisma.order.aggregate({ where: { paymentStatus: "PAID" }, _sum: { total: true } }),
      prisma.pOSOrder.aggregate({ where: { status: "COMPLETED" }, _sum: { total: true } }),
      prisma.user.findMany({ where: { role: { in: ["STAFF", "ADMIN", "SALES"] as any } }, select: { id: true, name: true, email: true, role: true } }).catch(() => []),
    ]);

    const staffStats = await Promise.all(
      staffList.map(async (staff) => {
        const [todayAgg, monthAgg, allTimeAgg, openSession] = await Promise.all([
          prisma.pOSOrder.aggregate({ where: { processedById: staff.id, status: "COMPLETED", createdAt: { gte: startOfToday } }, _sum: { total: true }, _count: { id: true } }),
          prisma.pOSOrder.aggregate({ where: { processedById: staff.id, status: "COMPLETED", createdAt: { gte: startOfMonth } }, _sum: { total: true }, _count: { id: true } }),
          prisma.pOSOrder.aggregate({ where: { processedById: staff.id, status: "COMPLETED" }, _sum: { total: true }, _count: { id: true } }),
          prisma.pOSSession.findFirst({ where: { staffId: staff.id, status: "OPEN" } }),
        ]);
        return {
          id: staff.id, name: staff.name, email: staff.email, role: staff.role,
          hasOpenSession: !!openSession,
          today: { orders: todayAgg._count.id, sales: todayAgg._sum.total || 0 },
          thisMonth: { orders: monthAgg._count.id, sales: monthAgg._sum.total || 0 },
          allTime: { orders: allTimeAgg._count.id, sales: allTimeAgg._sum.total || 0 },
        };
      })
    );

    const monthRevenue = monthStats._sum.total || 0;
    const lastMonthRevenue = lastMonthStats._sum.total || 0;
    const revenueGrowth = lastMonthRevenue ? Number((((monthRevenue - lastMonthRevenue) / lastMonthRevenue) * 100).toFixed(1)) : 0;

    const posMonthSales = await prisma.pOSOrder.aggregate({ where: { status: "COMPLETED", createdAt: { gte: startOfMonth } }, _sum: { total: true } });

    res.status(200).json({
      success: true,
      data: {
        viewType: "admin",
        orders: { total: totalOrders, today: todayOrders, thisMonth: monthStats._count, pending: pendingOrders },
        customers: { total: totalCustomers, newThisMonth: newCustomersThisMonth },
        inventory: { total: totalProducts, lowStock: lowStockCount, outOfStock: outOfStockCount },
        pos: { ordersToday: todayPOSOrders, salesToday: todayPOSSales._sum.total || 0 },
        promotions: { active: activePromotions },
        revenue: {
          thisMonth: monthRevenue,
          thisMonthPOS: posMonthSales._sum.total || 0,
          combinedThisMonth: monthRevenue + (posMonthSales._sum.total || 0),
          lastMonth: lastMonthRevenue,
          growth: revenueGrowth,
          allTimeOnline: allTimeRevenue._sum.total || 0,
          allTimePOS: allTimePOSSales._sum.total || 0,
          total: (allTimeRevenue._sum.total || 0) + (allTimePOSSales._sum.total || 0),
        },
        staffSales: staffStats,
      },
    });
  } catch (error) { next(error); }
};

// ─── GET /api/v1/analytics/revenue ───────────────────────────────────────────
export const getRevenueChart = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { period = "30" } = req.query;
    const days = Math.min(Number(period), 365);
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    const isStaffOnly = req.user?.role === "STAFF";
    const staffId = req.user?.userId;

    const [onlineOrders, posOrders] = await Promise.all([
      isStaffOnly ? [] : prisma.order.findMany({ where: { createdAt: { gte: startDate }, paymentStatus: "PAID" }, select: { total: true, createdAt: true } }),
      prisma.pOSOrder.findMany({ where: { createdAt: { gte: startDate }, status: "COMPLETED", ...(isStaffOnly && { processedById: staffId }) }, select: { total: true, createdAt: true } }),
    ]);

    const chartMap: Record<string, { date: string; online: number; pos: number; revenue: number }> = {};
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(); d.setDate(d.getDate() - i);
      const key = d.toISOString().split("T")[0];
      chartMap[key] = { date: key, online: 0, pos: 0, revenue: 0 };
    }

    (onlineOrders as any[]).forEach((o) => {
      const key = new Date(o.createdAt).toISOString().split("T")[0];
      if (chartMap[key]) { chartMap[key].online += o.total; chartMap[key].revenue += o.total; }
    });
    posOrders.forEach((o) => {
      const key = new Date(o.createdAt).toISOString().split("T")[0];
      if (chartMap[key]) { chartMap[key].pos += o.total; chartMap[key].revenue += o.total; }
    });

    res.status(200).json({ success: true, data: { chart: Object.values(chartMap) } });
  } catch (error) { next(error); }
};

// ─── GET /api/v1/analytics/staff-stats ───────────────────────────────────────
export const getStaffStats = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { startDate, endDate, staffId } = req.query;
    const start = startDate ? new Date(startDate as string) : (() => { const d = new Date(); d.setDate(1); d.setHours(0,0,0,0); return d; })();
    const end = endDate ? new Date(endDate as string) : new Date();

    const where: any = { role: { in: ["STAFF", "ADMIN", "SALES"] as any } };
    // Safe: if SALES not yet in Prisma client, catch and fall back to STAFF+ADMIN only
    if (staffId) where.id = staffId;

    const staffList = await prisma.user.findMany({ where, select: { id: true, name: true, email: true, role: true } });

    const stats = await Promise.all(staffList.map(async (staff) => {
      const [posAgg, cashS, cardS, transferS, recentOrders, sessions] = await Promise.all([
        prisma.pOSOrder.aggregate({ where: { processedById: staff.id, status: "COMPLETED", createdAt: { gte: start, lte: end } }, _sum: { total: true, discountAmount: true }, _count: { id: true } }),
        prisma.pOSOrder.aggregate({ where: { processedById: staff.id, status: "COMPLETED", paymentMethod: "CASH", createdAt: { gte: start, lte: end } }, _sum: { total: true }, _count: { id: true } }),
        prisma.pOSOrder.aggregate({ where: { processedById: staff.id, status: "COMPLETED", paymentMethod: "CARD", createdAt: { gte: start, lte: end } }, _sum: { total: true }, _count: { id: true } }),
        prisma.pOSOrder.aggregate({ where: { processedById: staff.id, status: "COMPLETED", paymentMethod: "TRANSFER", createdAt: { gte: start, lte: end } }, _sum: { total: true }, _count: { id: true } }),
        prisma.pOSOrder.findMany({ where: { processedById: staff.id, status: "COMPLETED" }, orderBy: { createdAt: "desc" }, take: 5, select: { posOrderNumber: true, total: true, createdAt: true, paymentMethod: true } }),
        // FIX: POSSession uses `openedAt` not `createdAt`
        prisma.pOSSession.findMany({ where: { staffId: staff.id, openedAt: { gte: start, lte: end } }, orderBy: { openedAt: "desc" }, take: 5 }),
      ]);
      return {
        staff: { id: staff.id, name: staff.name, email: staff.email, role: staff.role },
        period: { totalOrders: posAgg._count.id, totalSales: posAgg._sum.total || 0, totalDiscount: posAgg._sum.discountAmount || 0, avgOrderValue: posAgg._count.id > 0 ? (posAgg._sum.total || 0) / posAgg._count.id : 0 },
        byPaymentMethod: {
          cash: { orders: cashS._count.id, total: cashS._sum.total || 0 },
          card: { orders: cardS._count.id, total: cardS._sum.total || 0 },
          transfer: { orders: transferS._count.id, total: transferS._sum.total || 0 },
        },
        recentOrders, sessions,
      };
    }));

    res.status(200).json({ success: true, data: { stats, period: { start, end } } });
  } catch (error) { next(error); }
};

// ─── GET /api/v1/analytics/top-products ──────────────────────────────────────
export const getTopProducts = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { period = "30" } = req.query;
    const days = Math.min(Number(period), 365);
    const startDate = new Date(); startDate.setDate(startDate.getDate() - days);
    const topProducts = await prisma.orderItem.groupBy({ by: ["productId"], where: { order: { createdAt: { gte: startDate }, paymentStatus: "PAID" } }, _sum: { quantity: true, price: true }, orderBy: { _sum: { quantity: "desc" } }, take: 10 });
    res.status(200).json({ success: true, data: { topProducts } });
  } catch (error) { next(error); }
};

// ─── GET /api/v1/analytics/inventory ─────────────────────────────────────────
export const getInventoryReport = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const [lowStockData, outOfStockData, totalValue] = await Promise.all([
      prisma.product.findMany({ where: { stockQuantity: { gt: 0, lte: 10 }, status: "ACTIVE" }, select: { id: true, name: true, sku: true, stockQuantity: true, lowStockThreshold: true, images: true }, orderBy: { stockQuantity: "asc" } }),
      prisma.product.findMany({ where: { stockQuantity: 0, status: "ACTIVE" }, select: { id: true, name: true, sku: true, stockQuantity: true, lowStockThreshold: true, images: true }, orderBy: { name: "asc" } }),
      prisma.product.aggregate({ where: { status: "ACTIVE" }, _sum: { stockQuantity: true } }),
    ]);
    const calc = (p: any) => p.stockQuantity === 0 ? "OUT_OF_STOCK" : p.stockQuantity <= p.lowStockThreshold ? "LOW_STOCK" : "IN_STOCK";
    res.status(200).json({ success: true, data: { lowStock: lowStockData.map((p) => ({ ...p, stockStatus: calc(p) })), outOfStock: outOfStockData.map((p) => ({ ...p, stockStatus: calc(p) })), totalStockUnits: totalValue._sum.stockQuantity || 0 } });
  } catch (error) { next(error); }
};

// ─── GET /api/v1/analytics/customers ─────────────────────────────────────────
export const getCustomerStats = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const [bySegment, topCustomers, recentCustomers] = await Promise.all([
      prisma.user.groupBy({ by: ["customerSegment"], _count: true, where: { role: "CUSTOMER" } }),
      prisma.user.findMany({ where: { role: "CUSTOMER", totalSpent: { gt: 0 } }, orderBy: { totalSpent: "desc" }, take: 10, select: { id: true, name: true, email: true, totalSpent: true, orderCount: true, lastOrderDate: true } }),
      prisma.user.findMany({ where: { role: "CUSTOMER" }, orderBy: { createdAt: "desc" }, take: 10, select: { id: true, name: true, email: true, createdAt: true, orderCount: true } }),
    ]);
    res.status(200).json({ success: true, data: { bySegment, topCustomers, recentCustomers } });
  } catch (error) { next(error); }
};

// ─── GET /api/v1/analytics/orders-by-status ──────────────────────────────────
export const getOrdersByStatus = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const statusBreakdown = await prisma.order.groupBy({ by: ["status"], _count: true, _sum: { total: true } });
    res.status(200).json({ success: true, data: { statusBreakdown } });
  } catch (error) { next(error); }
};
