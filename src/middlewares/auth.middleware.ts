// backend/src/middlewares/auth.middleware.ts
// Added SALES role — has same API access as STAFF for sales-related routes
import { Request, Response, NextFunction } from "express";
import { verifyAccessToken } from "../utils/jwt";
import { AppError } from "../utils/appError";
import prisma from "../config/database";

export interface TokenPayload {
  userId: string;
  email: string;
  role: string;
}

export interface AuthRequest extends Request {
  user?: TokenPayload;
}

export const protect = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    let token: string | undefined;
    if (req.headers.authorization?.startsWith("Bearer")) {
      token = req.headers.authorization.split(" ")[1];
    } else if (req.cookies?.accessToken) {
      token = req.cookies.accessToken;
    }

    if (!token) throw new AppError("Not authorized, no token provided", 401);

    const decoded = verifyAccessToken(token) as TokenPayload;
    req.user = decoded;
    next();
  } catch (error) {
    next(new AppError("Not authorized, token invalid", 401));
  }
};

export const restrictTo = (...roles: string[]) => {
  return (req: AuthRequest, res: Response, next: NextFunction): void => {
    if (!req.user) return next(new AppError("Not authorized", 401));
    if (!roles.includes(req.user.role))
      return next(new AppError("You do not have permission", 403));
    next();
  };
};

export const adminOnly = restrictTo("ADMIN");

// STAFF, ADMIN, SALES, and MANAGER can all access sales-related routes.
// MANAGER has all STAFF capabilities (plus extra access granted via
// adminOrManager below for POS sessions / user management).
export const staffOrAdmin = restrictTo("ADMIN", "STAFF", "SALES", "MANAGER");

// Admin + Sales manager (not regular staff)
export const salesOrAdmin = restrictTo("ADMIN", "SALES");

// Admin + Manager — used for POS session oversight and user-management routes
// that MANAGER is allowed into (but regular STAFF/SALES are not).
export const adminOrManager = restrictTo("ADMIN", "MANAGER");

// User management — ADMIN, MANAGER, and STAFF only. SALES and ACCOUNTANT
// never get a seat in user management; each role's actual capabilities
// within it (who they can see/upgrade/demote) are scoped further in
// user.controller.ts via backend/src/utils/roleHierarchy.ts.
export const userManagementAccess = restrictTo("ADMIN", "MANAGER", "STAFF");

// Finance/accounting routes — ADMIN, MANAGER, and the new ACCOUNTANT role.
// ACCOUNTANT owns the finance dashboard (payments, reconciliation, reports)
// but is never given POS/inventory write access.
export const financeAccess = restrictTo("ADMIN", "MANAGER", "ACCOUNTANT");

// Read-only visibility into stock movement/approval history — everyone who
// needs oversight of stock changes, but not necessarily the power to
// approve/reject them.
export const stockHistoryAccess = restrictTo(
  "ADMIN",
  "MANAGER",
  "ACCOUNTANT",
);

// Universal report-generation access — every authenticated staff-side role
// may generate reports; the controller itself scopes *what* each role can
// see (e.g. SALES/STAFF can only ever pull their own activity).
export const reportsAccess = restrictTo(
  "ADMIN",
  "MANAGER",
  "ACCOUNTANT",
  "SALES",
  "STAFF",
);

// Read access for the dashboard/analytics screens — all staff-side roles
// plus ACCOUNTANT (finance needs visibility into revenue/analytics without
// gaining POS or inventory write access).
export const analyticsAccess = restrictTo(
  "ADMIN",
  "STAFF",
  "SALES",
  "MANAGER",
  "ACCOUNTANT",
);

export const optionalAuth = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    let token: string | undefined;
    if (req.headers.authorization?.startsWith("Bearer"))
      token = req.headers.authorization.split(" ")[1];
    else if (req.cookies?.accessToken) token = req.cookies.accessToken;
    if (token) req.user = verifyAccessToken(token) as TokenPayload;
    next();
  } catch {
    next();
  }
};
