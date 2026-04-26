// quotation.controller.ts
// Quotations removed in grocery store remodel.
// These stubs return 410 Gone so any lingering frontend calls fail gracefully.
import { Request, Response, NextFunction } from "express";

const gone = (_: Request, res: Response) =>
  res
    .status(410)
    .json({
      success: false,
      message: "Quotations are not available in this store.",
    });

export const getQuotations = gone;
export const getQuotation = gone;
export const createQuotation = gone;
export const updateQuotation = gone;
export const deleteQuotation = gone;
