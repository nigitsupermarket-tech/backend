import { Request, Response, NextFunction } from "express";
import bcrypt from "bcryptjs";
import { v4 as uuidv4 } from "uuid";
import prisma from "../config/database";
import { generateTokens, verifyRefreshToken } from "../utils/jwt";
import {
  AppError,
  UnauthorizedError,
  ConflictError,
  NotFoundError,
} from "../utils/appError";
import {
  sendVerificationEmail,
  sendPasswordResetEmail,
  sendWelcomeEmail,
} from "../services/email.service";
import { AuthRequest } from "../middlewares/auth.middleware";

// ─── Cookie helpers ───────────────────────────────────────────────────────────

const IS_PROD = process.env.NODE_ENV === "production";

// ✅ SESSION PERSISTENCE: Access token cookie — 15 minutes (short window; the
// refresh interceptor on the frontend will silently replace it before it's noticed)
const ACCESS_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: IS_PROD,
  sameSite: "strict" as const,
  maxAge: 15 * 60 * 1000,
};

// ✅ SESSION PERSISTENCE: Refresh token cookie — 30 days, rolling.
// Every time a refresh happens the cookie is re-set to another 30 days,
// so users who open the site regularly are effectively always logged in.
const REFRESH_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: IS_PROD,
  sameSite: "strict" as const,
  maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
};

function setAuthCookies(
  res: Response,
  accessToken: string,
  refreshToken: string,
) {
  res.cookie("accessToken", accessToken, ACCESS_COOKIE_OPTIONS);
  res.cookie("refreshToken", refreshToken, REFRESH_COOKIE_OPTIONS);
}

function clearAuthCookies(res: Response) {
  res.clearCookie("accessToken");
  res.clearCookie("refreshToken");
}

// ─── Register ─────────────────────────────────────────────────────────────────

export const register = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const { name, email, phone, password } = req.body;

    const existingUser = await prisma.user.findUnique({ where: { email } });

    if (existingUser) {
      if (!existingUser.emailVerified) {
        await prisma.verificationToken.deleteMany({
          where: { email, type: "email_verification" },
        });

        const verificationToken = uuidv4();
        const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
        await prisma.verificationToken.create({
          data: {
            email,
            token: verificationToken,
            type: "email_verification",
            expiresAt,
          },
        });

        await sendVerificationEmail(
          email,
          existingUser.name,
          verificationToken,
        );

        res.status(200).json({
          success: true,
          message:
            "A new verification email has been sent. Please check your inbox.",
        });
        return;
      }

      throw new ConflictError("User with this email already exists");
    }

    const hashedPassword = await bcrypt.hash(password, 12);

    const user = await prisma.user.create({
      data: { name, email, phone, password: hashedPassword, role: "CUSTOMER" },
    });

    await prisma.verificationToken.deleteMany({
      where: { email: user.email, type: "email_verification" },
    });

    const verificationToken = uuidv4();
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

    await prisma.verificationToken.create({
      data: {
        email: user.email,
        token: verificationToken,
        type: "email_verification",
        expiresAt,
      },
    });

    await sendVerificationEmail(user.email, user.name, verificationToken);

    res.status(201).json({
      success: true,
      message:
        "Registration successful. Please check your email to verify your account.",
      data: {
        user: {
          id: user.id,
          name: user.name,
          email: user.email,
          role: user.role,
        },
      },
    });
  } catch (error) {
    next(error);
  }
};

// ─── Login ────────────────────────────────────────────────────────────────────

export const login = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const { email, password } = req.body;

    const user = await prisma.user.findUnique({ where: { email } });

    if (!user) throw new UnauthorizedError("Invalid email or password");

    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid)
      throw new UnauthorizedError("Invalid email or password");

    if (!user.emailVerified) {
      throw new UnauthorizedError(
        "Please verify your email before logging in. Check your inbox or request a new link at /verify-email",
      );
    }

    const { accessToken, refreshToken } = generateTokens({
      userId: user.id,
      email: user.email,
      role: user.role,
    });

    // Persist the new refresh token in DB
    await prisma.user.update({
      where: { id: user.id },
      data: { refreshToken, lastLogin: new Date() },
    });

    // ✅ Set both tokens as httpOnly cookies (30-day refresh)
    setAuthCookies(res, accessToken, refreshToken);

    res.status(200).json({
      success: true,
      message: "Login successful",
      data: {
        user: {
          id: user.id,
          name: user.name,
          email: user.email,
          role: user.role,
          image: user.image,
        },
        accessToken,
        refreshToken,
      },
    });
  } catch (error) {
    next(error);
  }
};

// ─── Logout ───────────────────────────────────────────────────────────────────

export const logout = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    if (!req.user) throw new UnauthorizedError();

    await prisma.user.update({
      where: { id: req.user.userId },
      data: { refreshToken: null },
    });

    clearAuthCookies(res);

    res.status(200).json({ success: true, message: "Logout successful" });
  } catch (error) {
    next(error);
  }
};

// ─── Refresh Token ────────────────────────────────────────────────────────────

/**
 * ✅ SESSION PERSISTENCE: Rolling refresh token strategy.
 * Every call to this endpoint:
 *   1. Validates the incoming refresh token.
 *   2. Issues a brand-new access token (15 min).
 *   3. Issues a brand-new refresh token (30 days) — "rolling".
 *   4. Saves the new refresh token to DB and re-sets the cookies.
 *
 * This means: as long as the user opens the app within 30 days of their
 * last visit, they are silently re-authenticated — no login screen ever.
 */
export const refreshToken = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    // Accept token from cookie (preferred) or request body (fallback for mobile)
    const token = req.cookies?.refreshToken || req.body?.refreshToken;

    if (!token) throw new UnauthorizedError("Refresh token not provided");

    const decoded = verifyRefreshToken(token);

    const user = await prisma.user.findUnique({
      where: { id: decoded.userId },
    });

    if (!user || user.refreshToken !== token) {
      throw new UnauthorizedError("Invalid refresh token");
    }

    const tokens = generateTokens({
      userId: user.id,
      email: user.email,
      role: user.role,
    });

    // ✅ Rolling: save the new refresh token, invalidating the old one
    await prisma.user.update({
      where: { id: user.id },
      data: { refreshToken: tokens.refreshToken },
    });

    // ✅ Re-set cookies with fresh 30-day window
    setAuthCookies(res, tokens.accessToken, tokens.refreshToken);

    res.status(200).json({
      success: true,
      message: "Token refreshed successfully",
      data: tokens,
    });
  } catch (error) {
    next(error);
  }
};

// ─── Silent Refresh (GET) ─────────────────────────────────────────────────────

/**
 * ✅ SESSION PERSISTENCE: Called by the frontend on every app load.
 * Unlike POST /refresh-token (which the axios interceptor fires on 401s),
 * this is a proactive call made during app boot to silently re-hydrate
 * the session without the user having to trigger an API error first.
 *
 * Returns the user profile + new tokens if the refresh cookie is valid.
 * Returns 401 if the refresh cookie is missing/expired (user must log in).
 *
 * @route GET /api/v1/auth/silent-refresh
 * @access Public (reads httpOnly cookie)
 */
export const silentRefresh = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const token = req.cookies?.refreshToken;

    if (!token) {
      res.status(401).json({ success: false, message: "No session found" });
      return;
    }

    let decoded;
    try {
      decoded = verifyRefreshToken(token);
    } catch {
      clearAuthCookies(res);
      res.status(401).json({ success: false, message: "Session expired" });
      return;
    }

    const user = await prisma.user.findUnique({
      where: { id: decoded.userId },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        image: true,
        role: true,
        emailVerified: true,
        refreshToken: true,
        customerSegment: true,
        totalSpent: true,
        orderCount: true,
        createdAt: true,
      },
    });

    if (!user || user.refreshToken !== token) {
      clearAuthCookies(res);
      res.status(401).json({ success: false, message: "Session invalid" });
      return;
    }

    const tokens = generateTokens({
      userId: user.id,
      email: user.email,
      role: user.role,
    });

    // Rolling: save new refresh token
    await prisma.user.update({
      where: { id: user.id },
      data: { refreshToken: tokens.refreshToken },
    });

    setAuthCookies(res, tokens.accessToken, tokens.refreshToken);

    const { refreshToken: _rt, ...safeUser } = user;

    res.status(200).json({
      success: true,
      message: "Session restored",
      data: {
        user: safeUser,
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
      },
    });
  } catch (error) {
    next(error);
  }
};

// ─── Verify Email ─────────────────────────────────────────────────────────────

export const verifyEmail = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const { token } = req.body;

    if (!token) throw new AppError("Verification token is required", 400);

    const verificationToken = await prisma.verificationToken.findUnique({
      where: { token },
    });

    if (!verificationToken || verificationToken.type !== "email_verification") {
      throw new NotFoundError("Invalid verification token");
    }

    if (verificationToken.expiresAt < new Date()) {
      await prisma.verificationToken.delete({
        where: { id: verificationToken.id },
      });
      throw new AppError("Verification token has expired", 400);
    }

    const user = await prisma.user.update({
      where: { email: verificationToken.email },
      data: { emailVerified: true, emailVerifiedAt: new Date() },
    });

    await prisma.verificationToken.delete({
      where: { id: verificationToken.id },
    });

    try {
      await sendWelcomeEmail(user.email, user.name);
    } catch (emailErr) {
      console.error("Welcome email failed (non-fatal):", emailErr);
    }

    res
      .status(200)
      .json({ success: true, message: "Email verified successfully" });
  } catch (error) {
    next(error);
  }
};

// ─── Resend Verification ──────────────────────────────────────────────────────

export const resendVerification = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const { email } = req.body;

    if (!email) throw new AppError("Email is required", 400);

    const user = await prisma.user.findUnique({ where: { email } });

    if (!user || user.emailVerified) {
      res.status(200).json({
        success: true,
        message:
          "If that email is registered and unverified, a new link has been sent.",
      });
      return;
    }

    await prisma.verificationToken.deleteMany({
      where: { email, type: "email_verification" },
    });

    const verificationToken = uuidv4();
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

    await prisma.verificationToken.create({
      data: {
        email,
        token: verificationToken,
        type: "email_verification",
        expiresAt,
      },
    });

    await sendVerificationEmail(email, user.name, verificationToken);

    res.status(200).json({
      success: true,
      message: "Verification email sent. Please check your inbox.",
    });
  } catch (error) {
    next(error);
  }
};

// ─── Forgot Password ──────────────────────────────────────────────────────────

export const forgotPassword = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const { email } = req.body;

    const user = await prisma.user.findUnique({ where: { email } });

    if (!user) {
      res.status(200).json({
        success: true,
        message: "If the email exists, a password reset link has been sent.",
      });
      return;
    }

    await prisma.verificationToken.deleteMany({
      where: { email: user.email, type: "password_reset" },
    });

    const resetToken = uuidv4();
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000);

    await prisma.verificationToken.create({
      data: {
        email: user.email,
        token: resetToken,
        type: "password_reset",
        expiresAt,
      },
    });

    try {
      await sendPasswordResetEmail(user.email, user.name, resetToken);
    } catch (emailErr) {
      console.error("Password reset email failed:", emailErr);
    }

    res.status(200).json({
      success: true,
      message: "If the email exists, a password reset link has been sent.",
    });
  } catch (error) {
    next(error);
  }
};

// ─── Reset Password ───────────────────────────────────────────────────────────

export const resetPassword = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const { token, password } = req.body;

    const resetToken = await prisma.verificationToken.findUnique({
      where: { token },
    });

    if (!resetToken || resetToken.type !== "password_reset") {
      throw new NotFoundError("Invalid or expired reset link");
    }

    if (resetToken.expiresAt < new Date()) {
      await prisma.verificationToken.delete({ where: { id: resetToken.id } });
      throw new AppError(
        "Reset link has expired. Please request a new one.",
        400,
      );
    }

    const hashedPassword = await bcrypt.hash(password, 12);

    await prisma.user.update({
      where: { email: resetToken.email },
      data: { password: hashedPassword, refreshToken: null },
    });

    await prisma.verificationToken.delete({ where: { id: resetToken.id } });

    res
      .status(200)
      .json({ success: true, message: "Password reset successful" });
  } catch (error) {
    next(error);
  }
};

// ─── Get Me ───────────────────────────────────────────────────────────────────

export const getMe = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    if (!req.user) throw new UnauthorizedError();

    const user = await prisma.user.findUnique({
      where: { id: req.user.userId },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        image: true,
        role: true,
        emailVerified: true,
        customerSegment: true,
        totalSpent: true,
        orderCount: true,
        createdAt: true,
      },
    });

    if (!user) throw new NotFoundError("User not found");

    res.status(200).json({ success: true, data: { user } });
  } catch (error) {
    next(error);
  }
};

// ─── Update Password ──────────────────────────────────────────────────────────

export const updatePassword = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    if (!req.user) throw new UnauthorizedError();

    const { currentPassword, newPassword } = req.body;

    const user = await prisma.user.findUnique({
      where: { id: req.user.userId },
    });
    if (!user) throw new NotFoundError("User not found");

    const isPasswordValid = await bcrypt.compare(
      currentPassword,
      user.password,
    );
    if (!isPasswordValid)
      throw new UnauthorizedError("Current password is incorrect");

    const isSamePassword = await bcrypt.compare(newPassword, user.password);
    if (isSamePassword) {
      throw new AppError(
        "New password must be different from your current password",
        400,
      );
    }

    const hashedPassword = await bcrypt.hash(newPassword, 12);

    await prisma.user.update({
      where: { id: user.id },
      data: { password: hashedPassword, refreshToken: null },
    });

    clearAuthCookies(res);

    res
      .status(200)
      .json({
        success: true,
        message: "Password updated successfully. Please log in again.",
      });
  } catch (error) {
    next(error);
  }
};
