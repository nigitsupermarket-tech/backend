import { Request, Response, NextFunction } from "express";
import bcrypt from "bcryptjs";
import prisma from "../config/database";
import { AppError, NotFoundError, ConflictError } from "../utils/appError";
import { AuthRequest } from "../middlewares/auth.middleware";
import { log as logActivity } from "../utils/activityLogger";

export const getUsers = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const { page = "1", limit = "10", role, search } = req.query;
    const skip = (Number(page) - 1) * Number(limit);
    const where: any = {};
    if (role) where.role = role;
    if (search) {
      where.OR = [
        { name: { contains: search as string, mode: "insensitive" } },
        { email: { contains: search as string, mode: "insensitive" } },
      ];
    }

    // MANAGER can see/manage everyone except ADMIN accounts — they should
    // never see admin users in user management.
    if (req.user?.role === "MANAGER") {
      if (where.role === "ADMIN") {
        // Explicitly asked for admins — return empty rather than leaking them
        where.role = "__NONE__";
      } else if (!where.role) {
        where.role = { not: "ADMIN" };
      }
    }

    const [users, total] = await Promise.all([
      prisma.user.findMany({
        where,
        skip,
        take: Number(limit),
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          name: true,
          email: true,
          phone: true,
          role: true,
          image: true,
          emailVerified: true,
          customerSegment: true,
          totalSpent: true,
          orderCount: true,
          lastOrderDate: true,
          createdAt: true,
        },
      }),
      prisma.user.count({ where }),
    ]);

    res.status(200).json({
      success: true,
      data: {
        users,
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

export const getUser = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const id = req.params.id as string;

    const isStaffSide = ["ADMIN", "STAFF", "SALES", "MANAGER"].includes(
      req.user?.role || "",
    );
    if (!isStaffSide && req.user?.userId !== id)
      throw new AppError("Not authorized", 403);

    const user = await prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        role: true,
        image: true,
        emailVerified: true,
        customerSegment: true,
        totalSpent: true,
        orderCount: true,
        lastOrderDate: true,
        createdAt: true,
        addresses: true,
        orders: {
          select: {
            id: true,
            orderNumber: true,
            total: true,
            status: true,
            createdAt: true,
          },
          take: 5,
          orderBy: { createdAt: "desc" },
        },
      },
    });
    if (!user) throw new NotFoundError("User not found");
    if (req.user?.role === "MANAGER" && user.role === "ADMIN") {
      throw new AppError("Not authorized", 403);
    }

    res.status(200).json({ success: true, data: { user } });
  } catch (error) {
    next(error);
  }
};

export const createUser = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const { name, email, phone, password, role } = req.body;

    // MANAGER can create staff/sales/manager accounts, but never ADMIN.
    if (req.user?.role === "MANAGER" && role === "ADMIN") {
      throw new AppError("Managers cannot create admin accounts", 403);
    }

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing)
      throw new ConflictError("User with this email already exists");

    const hashed = await bcrypt.hash(password, 12);

    const user = await prisma.user.create({
      data: {
        name,
        email,
        phone,
        password: hashed,
        role: role || "STAFF",
        emailVerified: true,
      },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        role: true,
        createdAt: true,
      },
    });

    logActivity({
      userId: req.user?.userId,
      action: "create user",
      entity: "user",
      entityId: user.id,
      metadata: { name: user.name, email: user.email, role: user.role },
      req,
    });

    res.status(201).json({
      success: true,
      message: "User created successfully",
      data: { user },
    });
  } catch (error) {
    next(error);
  }
};

export const updateUser = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const id = req.params.id as string;

    const isAdmin = req.user?.role === "ADMIN";
    const isManager = req.user?.role === "MANAGER";
    const isSelf = req.user?.userId === id;
    if (!isAdmin && !isManager && !isSelf)
      throw new AppError("Not authorized", 403);

    const { name, phone, image, role, customerSegment } = req.body;
    const updates: any = {};
    if (name) updates.name = name;
    if (phone) updates.phone = phone;
    if (image) updates.image = image;

    // ── Role assignment ──────────────────────────────────────────────────
    // ADMIN: can assign any role to anyone.
    // MANAGER: can assign any role EXCEPT "ADMIN", and cannot modify a user
    //          who currently holds the ADMIN role (no demoting admins).
    if (role && (isAdmin || isManager)) {
      if (isManager) {
        if (role === "ADMIN") {
          throw new AppError("Managers cannot assign the ADMIN role", 403);
        }
        const target = await prisma.user.findUnique({
          where: { id },
          select: { role: true },
        });
        if (target?.role === "ADMIN") {
          throw new AppError("Managers cannot modify an admin account", 403);
        }
      }
      updates.role = role;
    }
    if (customerSegment && (isAdmin || isManager))
      updates.customerSegment = customerSegment;

    const user = await prisma.user.update({
      where: { id },
      data: updates,
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        role: true,
        image: true,
        customerSegment: true,
      },
    });

    logActivity({
      userId: req.user?.userId,
      action: "update user",
      entity: "user",
      entityId: user.id,
      metadata: { changedFields: Object.keys(updates), targetName: user.name },
      req,
    });

    res
      .status(200)
      .json({ success: true, message: "User updated", data: { user } });
  } catch (error) {
    next(error);
  }
};

export const deleteUser = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const id = req.params.id as string;

    if (req.user?.userId === id)
      throw new AppError("Cannot delete your own account", 400);

    const user = await prisma.user.findUnique({ where: { id } });
    if (!user) throw new NotFoundError("User not found");

    logActivity({
      userId: req.user?.userId,
      action: "delete user",
      entity: "user",
      entityId: id,
      metadata: { name: user.name, email: user.email, role: user.role },
      req,
    });

    await prisma.user.delete({ where: { id } });
    res
      .status(200)
      .json({ success: true, message: "User deleted successfully" });
  } catch (error) {
    next(error);
  }
};
