// backend/src/controllers/draft.controller.ts
//
// "Continue where you left off": a generic, per-user key/value store for
// in-progress UI state (a half-filled product form, a POS cart not yet
// checked out, etc.). A page autosaves its draft here under a stable key
// via useDraftSync() on the frontend; on next login the frontend checks
// GET /drafts/last-page to route the user back to the exact page they
// were on, and that page's own useDraftSync() restores its payload.
//
// Deliberately dumb on the backend — no validation of `payload` shape,
// no interpretation of what a draft "means". It's just durable storage
// so a logout/token-expiry/closed-tab doesn't wipe out unsaved work.

import { Request, Response, NextFunction } from "express";
import prisma from "../config/database";
import { AppError, NotFoundError } from "../utils/appError";
import { AuthRequest } from "../middlewares/auth.middleware";

const MAX_KEY_LENGTH = 200;
// Rough guard against someone stuffing something huge into a draft —
// Mongo documents cap at 16MB anyway, but this keeps drafts lightweight
// (they're meant to hold form/cart state, not file uploads).
const MAX_PAYLOAD_BYTES = 200_000;

function assertValidKey(key: unknown): asserts key is string {
  if (!key || typeof key !== "string" || key.length > MAX_KEY_LENGTH) {
    throw new AppError("Invalid draft key", 400);
  }
}

// GET /api/v1/drafts
// Lists every draft the current user has — used sparingly (e.g. an admin
// "resume work" prompt); most pages should use the scoped GET /:key below.
export const listDrafts = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const drafts = await prisma.userDraftState.findMany({
      where: { userId: req.user!.userId },
      orderBy: { updatedAt: "desc" },
    });
    res.status(200).json({ success: true, data: { drafts } });
  } catch (error) {
    next(error);
  }
};

// GET /api/v1/drafts/last-page
// The one call the frontend makes right after login — "where was this
// user last, and what were they doing there?" Returns null if there's
// nothing to resume (e.g. their last session ended cleanly).
export const getLastPageDraft = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const draft = await prisma.userDraftState.findUnique({
      where: { userId_key: { userId: req.user!.userId, key: "last-page" } },
    });
    res.status(200).json({ success: true, data: { draft: draft || null } });
  } catch (error) {
    next(error);
  }
};

// GET /api/v1/drafts/:key
export const getDraft = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const key = req.params.key as string;
    assertValidKey(key);

    const draft = await prisma.userDraftState.findUnique({
      where: { userId_key: { userId: req.user!.userId, key } },
    });
    res.status(200).json({ success: true, data: { draft: draft || null } });
  } catch (error) {
    next(error);
  }
};

// PUT /api/v1/drafts/:key
// Upsert — a page calls this (debounced) every time its draft state
// changes. Body: { path?: string, payload: any }
export const upsertDraft = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const key = req.params.key as string;
    assertValidKey(key);

    const { path, payload } = req.body;
    if (payload === undefined) {
      throw new AppError("A `payload` is required", 400);
    }
    const size = Buffer.byteLength(JSON.stringify(payload), "utf8");
    if (size > MAX_PAYLOAD_BYTES) {
      throw new AppError("Draft payload is too large to save", 413);
    }

    const draft = await prisma.userDraftState.upsert({
      where: { userId_key: { userId: req.user!.userId, key } },
      create: { userId: req.user!.userId, key, path: path ?? null, payload },
      update: { path: path ?? null, payload },
    });

    res.status(200).json({ success: true, data: { draft } });
  } catch (error) {
    next(error);
  }
};

// DELETE /api/v1/drafts/:key
// Called once a draft's work is actually submitted/saved for real, or the
// user explicitly discards it — so it doesn't hang around offering a
// stale "resume?" prompt forever.
export const deleteDraft = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const key = req.params.key as string;
    assertValidKey(key);

    await prisma.userDraftState
      .delete({ where: { userId_key: { userId: req.user!.userId, key } } })
      .catch(() => null); // already gone / never existed — fine either way

    res.status(200).json({ success: true, message: "Draft cleared" });
  } catch (error) {
    next(error);
  }
};
