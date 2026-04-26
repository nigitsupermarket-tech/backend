// backend/src/controllers/contact.controller.ts
import { Request, Response, NextFunction } from "express";
import prisma from "../config/database";
import { AppError } from "../utils/appError";
import { AuthRequest } from "../middlewares/auth.middleware";

// ── Public: Submit contact form ───────────────────────────────────────────────
export const submitContact = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const {
      name,
      email,
      phone,
      subject,
      message,
      heardAboutUs,
      preferredContact,
      preferredTime,
    } = req.body;

    if (!name || !email || !subject || !message) {
      throw new AppError("Name, email, subject and message are required", 400);
    }

    const contact = await prisma.contactMessage.create({
      data: {
        name,
        email,
        phone,
        subject,
        message,
        heardAboutUs,
        preferredContact,
        preferredTime,
      },
    });

    res
      .status(201)
      .json({
        success: true,
        message: "Message received. We will get back to you shortly.",
        data: { id: contact.id },
      });
  } catch (err) {
    next(err);
  }
};

// ── Admin: List contact messages ──────────────────────────────────────────────
export const getContacts = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const { page = "1", limit = "20", status } = req.query;
    const skip = (Number(page) - 1) * Number(limit);
    const where: any = {};
    if (status) where.status = status;

    const [messages, total] = await Promise.all([
      prisma.contactMessage.findMany({
        where,
        skip,
        take: Number(limit),
        orderBy: { createdAt: "desc" },
      }),
      prisma.contactMessage.count({ where }),
    ]);

    res
      .status(200)
      .json({
        success: true,
        data: {
          messages,
          pagination: {
            page: Number(page),
            limit: Number(limit),
            total,
            totalPages: Math.ceil(total / Number(limit)),
          },
        },
      });
  } catch (err) {
    next(err);
  }
};

// ── Admin: Get single contact ─────────────────────────────────────────────────
export const getContact = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const message = await prisma.contactMessage.findUnique({
      where: { id: req.params.id as string },
    });
    if (!message) throw new AppError("Message not found", 404);

    // Auto-mark as READ when opened
    if (message.status === "UNREAD") {
      await prisma.contactMessage.update({
        where: { id: message.id },
        data: { status: "READ" },
      });
      message.status = "READ";
    }

    res.status(200).json({ success: true, data: { message } });
  } catch (err) {
    next(err);
  }
};

// ── Admin: Update contact status / notes ──────────────────────────────────────
export const updateContact = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const { status, notes } = req.body;
    const data: any = {};
    if (status) data.status = status;
    if (notes !== undefined) data.notes = notes;
    if (status === "REPLIED") data.repliedAt = new Date();

    const message = await prisma.contactMessage.update({
      where: { id: req.params.id as string },
      data,
    });
    res.status(200).json({ success: true, data: { message } });
  } catch (err) {
    next(err);
  }
};

// ── Admin: Delete contact ─────────────────────────────────────────────────────
export const deleteContact = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    await prisma.contactMessage.delete({
      where: { id: req.params.id as string },
    });
    res.status(200).json({ success: true, message: "Deleted" });
  } catch (err) {
    next(err);
  }
};

// ── Admin: Contact stats ──────────────────────────────────────────────────────
export const getContactStats = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const [total, unread, replied] = await Promise.all([
      prisma.contactMessage.count(),
      prisma.contactMessage.count({ where: { status: "UNREAD" } }),
      prisma.contactMessage.count({ where: { status: "REPLIED" } }),
    ]);
    res
      .status(200)
      .json({
        success: true,
        data: { total, unread, replied, read: total - unread - replied },
      });
  } catch (err) {
    next(err);
  }
};

// ══════════════════════════════════════════════════════════════════════════════
// SUBSCRIBERS
// ══════════════════════════════════════════════════════════════════════════════

// ── Public: Subscribe ─────────────────────────────────────────────────────────
export const subscribe = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const { email, name, source } = req.body;
    if (!email) throw new AppError("Email is required", 400);

    const existing = await prisma.subscriber.findUnique({ where: { email } });
    if (existing) {
      if (existing.isActive) {
        res
          .status(200)
          .json({ success: true, message: "You are already subscribed!" });
        return;
      }
      // Re-subscribe
      await prisma.subscriber.update({
        where: { email },
        data: {
          isActive: true,
          unsubscribedAt: null,
          name: name || existing.name,
        },
      });
      res
        .status(200)
        .json({
          success: true,
          message: "Welcome back! You have been re-subscribed.",
        });
      return;
    }

    await prisma.subscriber.create({
      data: { email, name, source: source || "website" },
    });
    res
      .status(201)
      .json({ success: true, message: "Thank you for subscribing!" });
  } catch (err) {
    next(err);
  }
};

// ── Public: Unsubscribe ───────────────────────────────────────────────────────
export const unsubscribe = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const { email } = req.body;
    if (!email) throw new AppError("Email is required", 400);

    await prisma.subscriber.updateMany({
      where: { email },
      data: { isActive: false, unsubscribedAt: new Date() },
    });
    res
      .status(200)
      .json({ success: true, message: "You have been unsubscribed." });
  } catch (err) {
    next(err);
  }
};

// ── Admin: List subscribers ───────────────────────────────────────────────────
export const getSubscribers = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const { page = "1", limit = "30", active } = req.query;
    const skip = (Number(page) - 1) * Number(limit);
    const where: any = {};
    if (active === "true") where.isActive = true;
    if (active === "false") where.isActive = false;

    const [subscribers, total] = await Promise.all([
      prisma.subscriber.findMany({
        where,
        skip,
        take: Number(limit),
        orderBy: { subscribedAt: "desc" },
      }),
      prisma.subscriber.count({ where }),
    ]);

    res
      .status(200)
      .json({
        success: true,
        data: {
          subscribers,
          pagination: {
            page: Number(page),
            total,
            totalPages: Math.ceil(total / Number(limit)),
          },
        },
      });
  } catch (err) {
    next(err);
  }
};

// ── Admin: Delete subscriber ──────────────────────────────────────────────────
export const deleteSubscriber = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    await prisma.subscriber.delete({ where: { id: req.params.id as string } });
    res.status(200).json({ success: true, message: "Deleted" });
  } catch (err) {
    next(err);
  }
};
