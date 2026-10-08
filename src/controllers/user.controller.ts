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

    if (!isManagementRole && !isSelf) throw new AppError("Not authorized", 403);

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

// Cap on per-user order summaries stored in the archive snapshot. The orders
// themselves are NOT deleted (they stay in their own collections), so this
// only bounds the size of the archive document.
const ARCHIVE_ORDER_SUMMARY_LIMIT = 2000;

// DELETE /users/:id
//
// A user who has orders can't simply be removed (Order / POSOrder reference
// them). Instead of blocking the admin, we:
//   1. write an ArchivedUser snapshot (profile, addresses, reviews, cart,
//      wishlist, order summaries — never password/token hashes),
//   2. stamp the cashier's name onto POS orders they processed,
//   3. delete the user — Order.user / POSOrder.processedBy are SetNull, so the
//      orders are kept (online orders keep customerName/customerEmail).
// 2 and 3 plus the archive write happen in one transaction: if the delete
// fails, no archive row is left behind.
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

    const [
      addresses,
      reviews,
      cart,
      wishlist,
      draftCount,
      orderCount,
      posOrderCount,
      orders,
      posOrders,
      actor,
    ] = await Promise.all([
      prisma.address.findMany({ where: { userId: id } }),
      prisma.review.findMany({ where: { userId: id } }),
      prisma.cart.findFirst({ where: { userId: id } }),
      prisma.wishlist.findFirst({ where: { userId: id } }),
      prisma.userDraftState.count({ where: { userId: id } }),
      prisma.order.count({ where: { userId: id } }),
      prisma.pOSOrder.count({ where: { processedById: id } }),
      prisma.order.findMany({
        where: { userId: id },
        orderBy: { createdAt: "desc" },
        take: ARCHIVE_ORDER_SUMMARY_LIMIT,
        select: {
          id: true,
          orderNumber: true,
          status: true,
          total: true,
          createdAt: true,
        },
      }),
      prisma.pOSOrder.findMany({
        where: { processedById: id },
        orderBy: { createdAt: "desc" },
        take: ARCHIVE_ORDER_SUMMARY_LIMIT,
        select: {
          id: true,
          posOrderNumber: true,
          status: true,
          total: true,
          createdAt: true,
        },
      }),
      req.user?.userId
        ? prisma.user.findUnique({
            where: { id: req.user.userId },
            select: { name: true },
          })
        : Promise.resolve(null),
    ]);

    // Credentials/tokens must never be copied into the archive.
    const {
      password: _password,
      refreshToken: _refreshToken,
      previousRefreshToken: _previousRefreshToken,
      previousRefreshTokenExpiresAt: _previousRefreshTokenExpiresAt,
      ...profile
    } = user;

    const counts = {
      orders: orderCount,
      posOrdersProcessed: posOrderCount,
      reviews: reviews.length,
      addresses: addresses.length,
      draftStates: draftCount,
      hasCart: !!cart,
      hasWishlist: !!wishlist,
    };

    const archived = await prisma.$transaction(async (tx) => {
      const archive = await tx.archivedUser.create({
        data: {
          originalUserId: user.id,
          email: user.email,
          name: user.name,
          phone: user.phone,
          role: user.role,
          originalCreatedAt: user.createdAt,
          lastLogin: user.lastLogin,
          deletedById: req.user?.userId,
          deletedByName: actor?.name,
          deletedByRole: req.user?.role,
          counts,
          snapshot: JSON.parse(
            JSON.stringify({
              profile,
              addresses,
              reviews,
              cart,
              wishlist,
              orders,
              posOrders,
              summariesTruncated:
                orderCount > orders.length || posOrderCount > posOrders.length,
            }),
          ),
        },
      });

      // Keep who processed each POS sale once the relation is nulled.
      await tx.pOSOrder.updateMany({
        where: { processedById: id },
        data: { processedByName: user.name },
      });

      await tx.user.delete({ where: { id } });
      return archive;
    });

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
        archivedUserId: archived.id,
        counts,
      },
      req,
    });

    res.status(200).json({
      success: true,
      message: "User archived and deleted successfully",
      data: { archivedUserId: archived.id, counts },
    });
  } catch (error) {
    next(error);
  }
};

// GET /users/archived — ADMIN only. Paginated, searchable by name/email.
export const getArchivedUsers = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const { page = "1", limit = "20", search } = req.query;
    const skip = (Number(page) - 1) * Number(limit);
    const where: any = {};
    if (search) {
      where.OR = [
        { name: { contains: search as string, mode: "insensitive" } },
        { email: { contains: search as string, mode: "insensitive" } },
      ];
    }

    const [archivedUsers, total] = await Promise.all([
      prisma.archivedUser.findMany({
        where,
        skip,
        take: Number(limit),
        orderBy: { deletedAt: "desc" },
        // The full snapshot is large — fetch it via the detail endpoint.
        select: {
          id: true,
          originalUserId: true,
          name: true,
          email: true,
          phone: true,
          role: true,
          originalCreatedAt: true,
          deletedAt: true,
          deletedByName: true,
          deletedByRole: true,
          counts: true,
        },
      }),
      prisma.archivedUser.count({ where }),
    ]);

    res.status(200).json({
      success: true,
      data: {
        archivedUsers,
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

// GET /users/archived/:id — ADMIN only. Full snapshot.
export const getArchivedUser = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const archivedUser = await prisma.archivedUser.findUnique({
      where: { id: req.params.id as string },
    });
    if (!archivedUser) throw new NotFoundError("Archived user not found");
    res.status(200).json({ success: true, data: { archivedUser } });
  } catch (error) {
    next(error);
  }
};
