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
      const field = fields[0] || "field";
      return void res.status(409).json({
        success: false,
        status: "fail",
        message: "Duplicate field value",
        errors: [
          {
            field,
            message: `${field.charAt(0).toUpperCase() + field.slice(1)} already exists`,
            value: undefined,
          },
        ],
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

  // ─── MongoDB Duplicate Key Error ───────────────────────────────────────
  if (err.name === "MongoError" && (err as any).code === 11000) {
    const field = Object.keys((err as any).keyValue || {})[0] || "field";
    return void res.status(409).json({
      success: false,
      status: "fail",
      message: "Duplicate field value",
      errors: [
        {
          field,
          message: `${field.charAt(0).toUpperCase() + field.slice(1)} already exists`,
          value: (err as any).keyValue?.[field],
        },
      ],
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
