// consultation.controller.ts
// Consultations removed in grocery store remodel.
// These stubs return 410 Gone so any lingering frontend calls fail gracefully.
import { Request, Response, NextFunction } from "express";

const gone = (_: Request, res: Response) =>
  res
    .status(410)
    .json({
      success: false,
      message: "Consultations are not available in this store.",
    });

export const getConsultations = gone;
export const getConsultation = gone;
export const createConsultation = gone;
export const updateConsultation = gone;
export const deleteConsultation = gone;
