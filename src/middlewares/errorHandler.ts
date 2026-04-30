//backend/src/middlewares/errorHandler.ts
import { Request, Response, NextFunction } from "express";
import { AppError, ValidationError } from "../utils/appError";
import { Prisma } from "@prisma/client";

export const errorHandler = (
  err: Error | AppError | ValidationError,
  req: Request,
  res: Response,
  next: NextFunction,
): void => {
  // Log error in development
  if (process.env.NODE_ENV === "development") {
    console.error("Error Details:", {
      name: err.name,
      message: err.message,
      stack: err.stack,
    });
  }

  // ─── Express Validator Errors (from validation.middleware.ts) ─────────
  if (err instanceof ValidationError) {
    return void res.status(400).json({
      success: false,
      status: "fail",
      message: err.message,
      errors: err.errors.map((e: any) => ({
        field: e.path || e.param || "unknown",
        message: e.msg || e.message,
        value: e.value,
      })),
    });
  }

  // ─── Prisma Errors ─────────────────────────────────────────────────────
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    // Unique constraint violation (P2002)
    if (err.code === "P2002") {
      const fields = (err.meta?.target as string[]) || [];
      const field = fields[0] || "";

      // Map common internal field names to user-friendly messages
      // Never expose raw DB field/index names like "c", "sessionId", etc.
      const friendlyMessages: Record<string, string> = {
        email: "An account with this email already exists",
        phone: "This phone number is already registered",
        slug: "A product with this name already exists",
        sku: "A product with this SKU already exists",
        code: "This discount code already exists",
        orderNumber: "Order number conflict — please try again",
        // Cart unique index fields — these should never reach the user
        // but handle gracefully just in case
        userId: "Cart conflict — please refresh the page",
        sessionId: "Cart conflict — please refresh the page",
        c: "Cart conflict — please refresh the page",
      };

      const message =
        friendlyMessages[field] ||
        (field
          ? `${field.charAt(0).toUpperCase() + field.slice(1)} already exists`
          : "A duplicate entry was detected");

      return void res.status(409).json({
        success: false,
        status: "fail",
        message,
      });
    }

    // Record not found (P2025)
    if (err.code === "P2025") {
      return void res.status(404).json({
        success: false,
        status: "fail",
        message: "Record not found",
      });
    }

    // Foreign key constraint failed (P2003)
    if (err.code === "P2003") {
      const field = (err.meta?.field_name as string) || "field";
      return void res.status(400).json({
        success: false,
        status: "fail",
        message: "Invalid reference",
        errors: [
          {
            field,
            message: `Related ${field} not found`,
            value: undefined,
          },
        ],
      });
    }
  }

  // ─── Prisma Validation Errors ──────────────────────────────────────────
  if (err instanceof Prisma.PrismaClientValidationError) {
    return void res.status(400).json({
      success: false,
      status: "fail",
      message: "Invalid data provided",
      errors: [
        {
          field: "general",
          message: "Please check your input data",
          value: undefined,
        },
      ],
    });
  }

  // ─── JWT Errors ────────────────────────────────────────────────────────
  if (err.name === "JsonWebTokenError") {
    return void res.status(401).json({
      success: false,
      status: "fail",
      message: "Invalid token. Please log in again.",
    });
  }

  if (err.name === "TokenExpiredError") {
    return void res.status(401).json({
      success: false,
      status: "fail",
      message: "Your session has expired. Please log in again.",
    });
  }

  // ─── MongoDB Duplicate Key Error (native driver, outside Prisma) ──────────
  if (
    (err.name === "MongoError" || err.name === "MongoServerError") &&
    (err as any).code === 11000
  ) {
    const keyValue = (err as any).keyValue || {};
    const field = Object.keys(keyValue)[0] || "";
    const cartFields = ["c", "userId", "sessionId", "cartId"];
    const message = cartFields.includes(field)
      ? "Cart conflict — please refresh the page"
      : field
        ? `${field.charAt(0).toUpperCase() + field.slice(1)} already exists`
        : "A duplicate entry was detected";

    return void res.status(409).json({
      success: false,
      status: "fail",
      message,
    });
  }

  // ─── Custom AppError ───────────────────────────────────────────────────
  if (err instanceof AppError) {
    return void res.status(err.statusCode).json({
      success: false,
      status: err.status,
      message: err.message,
    });
  }

  // ─── Default Server Error ──────────────────────────────────────────────
  res.status(500).json({
    success: false,
    status: "error",
    message: err.message || "Internal server error",
    ...(process.env.NODE_ENV === "development" && {
      error: err.name,
      stack: err.stack,
    }),
  });
};
