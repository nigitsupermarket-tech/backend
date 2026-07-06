// backend/src/controllers/report.controller.ts
//
// Unified, role-scoped report generator.
//
//   GET /api/v1/reports?type=<type>&interval=<interval>&from&to&userId&page&limit
//
//   type:      overview | stock | stock-approvals | sales | pos | activity
//   interval:  session | today | week | month | year | custom
//   userId:    optional — ADMIN/MANAGER/ACCOUNTANT may request any user's
//              report (or omit it for an org-wide report). SALES/STAFF are
//              always pinned to their own userId, no matter what is passed.
//   sessionId: required when interval=session — scopes the report to a
//              single POS session's window (open→close, or open→now).
//   from/to:   required when interval=custom (ISO date strings).
//   page/limit: pagination for the row-level detail tables (stock,
//              stock-approvals, activity). Ignored by sales/pos/overview,
//              which only return summary numbers.
//
// The endpoint is intentionally a single, generic entry point so every role
// hits the same route — "generate my report" for SALES/STAFF, and
// "generate a report for the business (or for user X)" for ADMIN/MANAGER/
// ACCOUNTANT — and the scoping rule lives in one place instead of being
// re-implemented per page.
import { Response, NextFunction } from "express";
import prisma from "../config/database";
import { AppError } from "../utils/appError";
import { AuthRequest } from "../middlewares/auth.middleware";

const PRIVILEGED_ROLES = ["ADMIN", "MANAGER", "ACCOUNTANT"];

type Interval = "session" | "today" | "week" | "month" | "year" | "custom";

function resolveRange(
  interval: Interval,
  from?: string,
  to?: string,
): { start: Date; end: Date } {
  const now = new Date();
  const end = new Date(now);

  switch (interval) {
    case "today": {
      const start = new Date(now);
      start.setHours(0, 0, 0, 0);
      return { start, end };
    }
    case "week": {
      const start = new Date(now);
      start.setDate(start.getDate() - 7);
      return { start, end };
    }
    case "month": {
      const start = new Date(now);
      start.setDate(start.getDate() - 30);
      return { start, end };
    }
    case "year": {
      const start = new Date(now);
      start.setFullYear(start.getFullYear() - 1);
      return { start, end };
    }
    case "custom": {
      if (!from || !to)
        throw new AppError(
          "from and to are required for a custom interval",
          400,
        );
      const start = new Date(from);
      const customEnd = new Date(to);
      if (isNaN(start.getTime()) || isNaN(customEnd.getTime()))
        throw new AppError("from/to must be valid dates", 400);
      return { start, end: customEnd };
    }
    case "session":
      // Handled separately via sessionId — range resolved by caller.
      return { start: new Date(0), end };
    default:
      throw new AppError(
        "interval must be one of: session, today, week, month, year, custom",
        400,
      );
  }
}

// Resolves the effective userId scope for the request, per the role rule
// described above. Returns undefined for an org-wide (no-filter) report.
function resolveUserScope(
  req: AuthRequest,
): { userId?: string; scope: "self" | "user" | "org" } {
  const role = req.user!.role;
  const requested = (req.query.userId as string | undefined)?.trim();

  if (!PRIVILEGED_ROLES.includes(role)) {
    // SALES / STAFF can only ever see their own report.
    return { userId: req.user!.userId, scope: "self" };
  }

  if (requested) return { userId: requested, scope: "user" };
  return { userId: undefined, scope: "org" };
}

// Reads & clamps page/limit query params shared by every paginated section.
function resolvePagination(req: AuthRequest): { page: number; limit: number } {
  const page = Math.max(1, parseInt((req.query.page as string) || "1", 10) || 1);
  const limit = Math.min(
    100,
    Math.max(1, parseInt((req.query.limit as string) || "20", 10) || 20),
  );
  return { page, limit };
}

// ─────────────────────────────────────────────────────────────────────────
// GET /api/v1/reports
// ─────────────────────────────────────────────────────────────────────────
export const generateReport = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const type = (req.query.type as string) || "overview";
    const interval = ((req.query.interval as string) || "month") as Interval;
    const { from, to, sessionId } = req.query as Record<string, string>;
    const { page, limit } = resolvePagination(req);

    const { userId, scope } = resolveUserScope(req);

    let start: Date;
    let end: Date;

    if (interval === "session") {
      if (!sessionId)
        throw new AppError("sessionId is required for interval=session", 400);
      const session = await prisma.pOSSession.findUnique({
        where: { id: sessionId },
      });
      if (!session) throw new AppError("Session not found", 404);
      if (
        !PRIVILEGED_ROLES.includes(req.user!.role) &&
        session.staffId !== req.user!.userId
      ) {
        throw new AppError("Not authorized to view this session", 403);
      }
      start = session.openedAt;
      end = session.closedAt ?? new Date();
    } else {
      const range = resolveRange(interval, from, to);
      start = range.start;
      end = range.end;
    }

    const dateWhere = { gte: start, lte: end };

    const sections: Record<string, unknown> = {};
    // "overview" now only drives the summary cards (sales/pos). Stock
    // movement, stock approvals, and activity are always-available tabs on
    // the frontend, fetched independently (each with its own pagination) so
    // switching between them — or narrowing the shared date/scope filters —
    // doesn't require re-picking a "type" and losing the other tabs' data.
    const types = type === "overview" ? ["sales", "pos"] : [type];

    for (const t of types) {
      switch (t) {
        case "stock":
          sections.stock = await buildStockSection(dateWhere, userId, page, limit);
          break;
        case "stock-approvals":
          sections.stockApprovals = await buildApprovalsSection(
            dateWhere,
            userId,
            page,
            limit,
          );
          break;
        case "sales":
          sections.sales = await buildSalesSection(dateWhere, userId);
          break;
        case "pos":
          sections.pos = await buildPosSection(dateWhere, userId);
          break;
        case "activity":
          sections.activity = await buildActivitySection(
            dateWhere,
            userId,
            page,
            limit,
          );
          break;
        default:
          throw new AppError(
            `Unknown report type "${t}". Use: overview, stock, stock-approvals, sales, pos, activity`,
            400,
          );
      }
    }

    res.status(200).json({
      success: true,
      data: {
        meta: {
          type,
          interval,
          range: { start, end },
          scope,
          userId: userId ?? null,
          generatedBy: req.user!.userId,
          generatedAt: new Date(),
        },
        ...sections,
      },
    });
  } catch (error) {
    next(error);
  }
};

// ── Section builders ────────────────────────────────────────────────────

// Batch-resolves a display name for a set of user IDs in one query, so
// per-row lookups never happen in a loop.
async function batchUserNames(ids: (string | undefined | null)[]) {
  const uniqueIds = [...new Set(ids.filter(Boolean))] as string[];
  if (uniqueIds.length === 0) return {} as Record<string, string>;
  const users = await prisma.user.findMany({
    where: { id: { in: uniqueIds } },
    select: { id: true, name: true },
  });
  return Object.fromEntries(users.map((u) => [u.id, u.name])) as Record<
    string,
    string
  >;
}

async function buildStockSection(
  dateWhere: { gte: Date; lte: Date },
  userId: string | undefined,
  page: number,
  limit: number,
) {
  // InventoryLog carries `performedBy` for anything logged after the
  // attribution fix; older rows only have it encoded in `reference`
  // (e.g. "admin:<userId>" or "approval:<requestId>"), so a per-user
  // filter has to match either shape.
  const where: any = { createdAt: dateWhere };
  if (userId) {
    where.OR = [{ performedBy: userId }, { reference: { contains: userId } }];
  }

  const [total, logs, byTypeRaw] = await Promise.all([
    prisma.inventoryLog.count({ where }),
    prisma.inventoryLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * limit,
      take: limit,
      include: { product: { select: { name: true, sku: true } } },
    }),
    prisma.inventoryLog.groupBy({
      by: ["type"],
      where,
      _count: { _all: true },
    }),
  ]);

  const byType: Record<string, number> = {};
  for (const g of byTypeRaw) byType[g.type] = g._count._all;

  // Resolve "who effected this" for the current page only.
  const directIds = logs.map((l) => l.performedBy).filter(Boolean) as string[];
  const approvalIds = logs
    .filter((l) => !l.performedBy && l.reference?.startsWith("approval:"))
    .map((l) => l.reference!.split(":")[1]);

  const [nameMap, approvals] = await Promise.all([
    batchUserNames(directIds),
    approvalIds.length
      ? prisma.stockApprovalRequest.findMany({
          where: { id: { in: approvalIds } },
          select: { id: true, reviewedByName: true, requestedByName: true },
        })
      : Promise.resolve([]),
  ]);
  const approvalMap = Object.fromEntries(
    approvals.map((a) => [a.id, a.reviewedByName || a.requestedByName || null]),
  );

  const entries = logs.map((l) => {
    let performedByName =
      l.performedByName || (l.performedBy ? nameMap[l.performedBy] : undefined);
    if (!performedByName && l.reference?.startsWith("approval:")) {
      performedByName = approvalMap[l.reference.split(":")[1]] || undefined;
    }
    if (!performedByName && l.reference?.startsWith("admin:")) {
      performedByName = nameMap[l.reference.split(":")[1]] || undefined;
    }
    return { ...l, performedByName: performedByName || "System" };
  });

  return {
    totalMovements: total,
    byType,
    entries,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    },
  };
}

async function buildApprovalsSection(
  dateWhere: { gte: Date; lte: Date },
  userId: string | undefined,
  page: number,
  limit: number,
) {
  const where: any = { createdAt: dateWhere };
  if (userId) where.requestedBy = userId;

  const [total, requests, statusCounts] = await Promise.all([
    prisma.stockApprovalRequest.count({ where }),
    prisma.stockApprovalRequest.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.stockApprovalRequest.groupBy({
      by: ["status"],
      where,
      _count: { _all: true },
    }),
  ]);

  const countByStatus = Object.fromEntries(
    statusCounts.map((s) => [s.status, s._count._all]),
  ) as Record<string, number>;

  // Reviewed requests' review time is a useful stat but only needs the
  // current page, not the full range.
  const avgReviewMs =
    requests
      .filter((r) => r.reviewedAt)
      .map((r) => r.reviewedAt!.getTime() - r.createdAt.getTime())
      .reduce((a, b, _, arr) => a + b / arr.length, 0) || 0;

  return {
    total,
    pending: countByStatus.PENDING || 0,
    approved: countByStatus.APPROVED || 0,
    rejected: countByStatus.REJECTED || 0,
    avgReviewTimeMinutes: Math.round(avgReviewMs / 60000),
    entries: requests,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    },
  };
}

async function buildSalesSection(
  dateWhere: { gte: Date; lte: Date },
  userId?: string,
) {
  const where: any = { createdAt: dateWhere };
  if (userId) where.userId = userId;

  const orders = await prisma.order.findMany({
    where,
    select: {
      id: true,
      orderNumber: true,
      total: true,
      status: true,
      paymentStatus: true,
      createdAt: true,
      userId: true,
    },
  });

  const revenue = orders.reduce((s, o) => s + o.total, 0);
  const byStatus: Record<string, number> = {};
  for (const o of orders) byStatus[o.status] = (byStatus[o.status] || 0) + 1;

  return {
    orderCount: orders.length,
    revenue,
    averageOrderValue: orders.length ? revenue / orders.length : 0,
    byStatus,
  };
}

async function buildPosSection(
  dateWhere: { gte: Date; lte: Date },
  userId?: string,
) {
  const where: any = { createdAt: dateWhere, status: { not: "SUSPENDED" } };
  if (userId) where.processedById = userId;

  const orders = await prisma.pOSOrder.findMany({
    where,
    select: {
      id: true,
      posOrderNumber: true,
      total: true,
      status: true,
      paymentMethod: true,
      createdAt: true,
      processedById: true,
    },
  });

  const completed = orders.filter((o) => o.status === "COMPLETED");
  const voided = orders.filter((o) => o.status === "VOIDED");
  const revenue = completed.reduce((s, o) => s + o.total, 0);

  const byPaymentMethod: Record<string, number> = {};
  for (const o of completed)
    byPaymentMethod[o.paymentMethod] =
      (byPaymentMethod[o.paymentMethod] || 0) + o.total;

  return {
    orderCount: completed.length,
    voidedCount: voided.length,
    revenue,
    averageOrderValue: completed.length ? revenue / completed.length : 0,
    byPaymentMethod,
  };
}

async function buildActivitySection(
  dateWhere: { gte: Date; lte: Date },
  userId: string | undefined,
  page: number,
  limit: number,
) {
  const where: any = { createdAt: dateWhere };
  if (userId) where.userId = userId;

  const [total, logs, actionCountsRaw] = await Promise.all([
    prisma.activityLog.count({ where }),
    prisma.activityLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.activityLog.groupBy({ by: ["action"], where, _count: { _all: true } }),
  ]);

  const byAction: Record<string, number> = {};
  for (const g of actionCountsRaw) byAction[g.action] = g._count._all;

  // ActivityLog has no relation to User, so hydrate names for the page in
  // one batched lookup rather than per-row.
  const nameMap = await batchUserNames(logs.map((l) => l.userId));
  const entries = logs.map((l) => ({
    ...l,
    userName: (l.userId && nameMap[l.userId]) || "System",
  }));

  return {
    total,
    byAction,
    entries,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    },
  };
}
