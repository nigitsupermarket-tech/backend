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
