import { Request, Response, NextFunction } from "express";
import bcrypt from "bcryptjs";
import prisma from "../config/database";
import { AppError, NotFoundError, ConflictError } from "../utils/appError";
import { AuthRequest } from "../middlewares/auth.middleware";
import { log as logActivity } from "../utils/activityLogger";
import {
  canAssignRole,
  canViewRole,
  rolesAbove,
  USER_MANAGEMENT_ROLES,
} from "../utils/roleHierarchy";

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

    // Hierarchy-scoped visibility: nobody sees roles more senior than
    // themselves (ADMIN is unrestricted). STAFF never sees MANAGER/ADMIN;
    // MANAGER never sees ADMIN. Peers and anything below remain visible.
    const actorRole = req.user?.role || "";
    const hiddenRoles = rolesAbove(actorRole);
    if (hiddenRoles.length > 0) {
      if (where.role && hiddenRoles.includes(where.role)) {
        // Explicitly asked for a role they can't see — return empty rather
        // than leaking it.
        where.role = "__NONE__";
      } else if (!where.role) {
        where.role = { notIn: hiddenRoles };
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
    const actorRole = req.user?.role || "";

    const isManagementRole = USER_MANAGEMENT_ROLES.includes(actorRole);
    if (!isManagementRole && req.user?.userId !== id)
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
    // Hierarchy-scoped visibility: STAFF can't view MANAGER/ADMIN accounts,
    // MANAGER can't view ADMIN accounts, ADMIN can view anyone.
    if (
      isManagementRole &&
      req.user?.userId !== id &&
      !canViewRole(actorRole, user.role)
    ) {
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
    const assignedRole = role || "STAFF";

    // A brand-new account has no prior role, so this only checks the
    // requested role against the actor's own rank — same rule as
    // updateUser, just without a "current role" to compare.
    if (!canAssignRole(req.user?.role || "", "CUSTOMER", assignedRole)) {
      throw new AppError(
        `You do not have permission to create a ${assignedRole} account`,
        403,
      );
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
        role: assignedRole,
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
      metadata: {
        name: user.name,
        email: user.email,
        role: user.role,
        performedByRole: req.user?.role,
      },
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
    const actorRole = req.user?.role || "";
    const isSelf = req.user?.userId === id;
    const isManagementRole = USER_MANAGEMENT_ROLES.includes(actorRole);

    if (!isManagementRole && !isSelf)
      throw new AppError("Not authorized", 403);

    const target = await prisma.user.findUnique({
      where: { id },
      select: { role: true, name: true, email: true },
    });
    if (!target) throw new NotFoundError("User not found");

    // A management-role actor editing someone else must be allowed to even
    // SEE that account first (STAFF can't touch a MANAGER's record just
    // because they hit the right URL).
    if (isManagementRole && !isSelf && !canViewRole(actorRole, target.role)) {
      throw new AppError("Not authorized", 403);
    }

    const { name, phone, image, role, customerSegment } = req.body;
    const updates: any = {};
    if (name) updates.name = name;
    if (phone) updates.phone = phone;
    if (image) updates.image = image;

    // ── Role assignment (upgrade/demote) ───────────────────────────────────
    // ADMIN: can assign any role to anyone.
    // MANAGER: can assign anything below MANAGER (STAFF, ACCOUNTANT, SALES,
    //          CUSTOMER) to a target currently below MANAGER — never ADMIN,
    //          never another MANAGER.
    // STAFF:   can assign ACCOUNTANT/SALES/CUSTOMER to a target currently at
    //          ACCOUNTANT/SALES/CUSTOMER — never STAFF, MANAGER, or ADMIN,
    //          and never touches a target who already holds one of those.
    // See backend/src/utils/roleHierarchy.ts for the shared rule.
    let roleChange: { from: string; to: string } | null = null;
    if (role && role !== target.role) {
      if (!isManagementRole) {
        throw new AppError(
          "You do not have permission to change user roles",
          403,
        );
      }
      if (!canAssignRole(actorRole, target.role, role)) {
        throw new AppError(
          `${actorRole.charAt(0) + actorRole.slice(1).toLowerCase()}s cannot change a ${target.role} account to ${role}`,
          403,
        );
      }
      updates.role = role;
      roleChange = { from: target.role, to: role };
    }

    if (customerSegment && isManagementRole)
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

    // Always record what changed. Role changes get their own action name
    // and explicit before/after values so the activity log doubles as an
    // audit trail for who upgraded/demoted whom.
    logActivity({
      userId: req.user?.userId,
      action: roleChange ? "update user role" : "update user",
      entity: "user",
      entityId: user.id,
      metadata: {
        changedFields: Object.keys(updates),
        targetName: user.name,
        targetEmail: target.email,
        performedByRole: actorRole,
        ...(roleChange && {
          roleChangedFrom: roleChange.from,
          roleChangedTo: roleChange.to,
        }),
      },
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
      metadata: {
        name: user.name,
        email: user.email,
        role: user.role,
        performedByRole: req.user?.role,
      },
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
