// backend/src/controllers/activity.controller.ts
import { Response, NextFunction } from "express";
import prisma from "../config/database";
import { AuthRequest } from "../middlewares/auth.middleware";

// GET /api/v1/activities
export const getActivities = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { page = "1", limit = "30", userId, entity, action, search } = req.query;
    const skip = (parseInt(page as string) - 1) * parseInt(limit as string);
    const take = Math.min(parseInt(limit as string), 100);

    const where: any = {};
    if (userId) where.userId = userId;
    if (entity) where.entity = entity;
    if (action) where.action = { contains: action as string, mode: "insensitive" };
    if (search) where.OR = [
      { action: { contains: search as string, mode: "insensitive" } },
      { entity: { contains: search as string, mode: "insensitive" } },
    ];

    const [total, logs] = await Promise.all([
      prisma.activityLog.count({ where }),
      prisma.activityLog.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip,
        take,
      }),
    ]);

    // Hydrate user info separately (no relation on ActivityLog model)
    const userIds = [...new Set(logs.map((l) => l.userId).filter(Boolean))] as string[];
    const users = userIds.length
      ? await prisma.user.findMany({
          where: { id: { in: userIds } },
          select: { id: true, name: true, email: true, role: true },
        })
      : [];
    const userMap = Object.fromEntries(users.map((u) => [u.id, u]));

    const enriched = logs.map((log) => ({
      ...log,
      user: log.userId ? userMap[log.userId] || null : null,
    }));

    res.status(200).json({
      success: true,
      data: {
        logs: enriched,
        pagination: {
          total,
          page: parseInt(page as string),
          limit: take,
          totalPages: Math.ceil(total / take),
        },
      },
    });
  } catch (error) {
    next(error);
  }
};

// GET /api/v1/activities/recent  (used by admin dashboard widget)
export const getRecentActivities = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const logs = await prisma.activityLog.findMany({
      orderBy: { createdAt: "desc" },
      take: 8,
    });

    const userIds = [...new Set(logs.map((l) => l.userId).filter(Boolean))] as string[];
    const users = userIds.length
      ? await prisma.user.findMany({
          where: { id: { in: userIds } },
          select: { id: true, name: true, email: true, role: true },
        })
      : [];
    const userMap = Object.fromEntries(users.map((u) => [u.id, u]));

    const enriched = logs.map((log) => ({
      ...log,
      user: log.userId ? userMap[log.userId] || null : null,
    }));

    res.status(200).json({ success: true, data: { logs: enriched } });
  } catch (error) {
    next(error);
  }
};

// POST /api/v1/activities  — internal helper used by other controllers to log actions
export const logActivity = async (data: {
  userId?: string;
  action: string;
  entity?: string;
  entityId?: string;
  metadata?: Record<string, any>;
  ipAddress?: string;
}) => {
  try {
    await prisma.activityLog.create({ data });
  } catch {
    // Logging should never crash the main flow
  }
};
