//backend/src/middlewares/notFound.ts
import { Request, Response, NextFunction } from "express";
import { AppError } from "../utils/appError";

export const notFound = (
  req: Request,
  res: Response,
  next: NextFunction,
): void => {
  const error = new AppError(`Route ${req.originalUrl} not found`, 404);
  next(error);
};
