import { Response, NextFunction } from "express";
import prisma from "../config/database";
import { AppError, NotFoundError } from "../utils/appError";
import { AuthRequest } from "../middlewares/auth.middleware";
import { sendEmail } from "../services/email.service";
import { sendSms, assertSmsConfigured, getSmsProviderStatus } from "../services/sms.service";
import {
  parseRecipientsFromSpreadsheet,
  parsePhoneRecipientsFromSpreadsheet,
  isAllowedSpreadsheetFile,
  ParsedRecipient,
  ParsedPhoneRecipient,
} from "../utils/spreadsheetParser";

const SEGMENTS = ["NEW", "REGULAR", "VIP", "WHOLESALE"] as const;

/** Resolves a `targetSegment` value ("ALL" or one of SEGMENTS) into a Prisma where-clause. */
function segmentWhere(segment?: string) {
  const where: any = { role: "CUSTOMER" };
  if (segment && segment !== "ALL") where.customerSegment = segment;
  return where;
}

// GET /api/v1/marketing/campaigns
export const getCampaigns = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const { page = "1", limit = "10", type, status } = req.query;
    const skip = (Number(page) - 1) * Number(limit);
    const where: any = {};
    if (type) where.type = type;
    if (status) where.status = status;

    const [campaigns, total] = await Promise.all([
      prisma.marketingCampaign.findMany({
        where,
        skip,
        take: Number(limit),
        orderBy: { createdAt: "desc" },
      }),
      prisma.marketingCampaign.count({ where }),
    ]);

    res.status(200).json({
      success: true,
      data: {
        campaigns,
        pagination: {
          page: Number(page),
          limit: Number(limit),
          total,
          totalPages: Math.ceil(total / Number(limit)),
        },
      },
    });
  } catch (error) {
    next(error);
  }
};

// GET /api/v1/marketing/campaigns/:id
export const getCampaign = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const id = req.params.id as string; // ✅ fix: line 41

    const campaign = await prisma.marketingCampaign.findUnique({
      where: { id },
    });
    if (!campaign) throw new NotFoundError("Campaign not found");
    res.status(200).json({ success: true, data: { campaign } });
  } catch (error) {
    next(error);
  }
};

// POST /api/v1/marketing/campaigns
export const createCampaign = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const { scheduledAt, ...rest } = req.body;

    const campaign = await prisma.marketingCampaign.create({
      data: {
        ...rest,
        status: "DRAFT",
        ...(scheduledAt && { scheduledAt: new Date(scheduledAt) }),
      },
    });

    res
      .status(201)
      .json({ success: true, message: "Campaign created", data: { campaign } });
  } catch (error) {
    next(error);
  }
};

// PUT /api/v1/marketing/campaigns/:id
export const updateCampaign = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const id = req.params.id as string; // ✅ fix: lines 72, 76

    const campaign = await prisma.marketingCampaign.findUnique({
      where: { id },
    });
    if (!campaign) throw new NotFoundError("Campaign not found");

    const updated = await prisma.marketingCampaign.update({
      where: { id },
      data: {
        ...req.body,
        ...(req.body.scheduledAt && {
          scheduledAt: new Date(req.body.scheduledAt),
        }),
      },
    });

    res
      .status(200)
      .json({
        success: true,
        message: "Campaign updated",
        data: { campaign: updated },
      });
  } catch (error) {
    next(error);
  }
};

// DELETE /api/v1/marketing/campaigns/:id
export const deleteCampaign = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const id = req.params.id as string; // ✅ fix: line 93

    await prisma.marketingCampaign.delete({ where: { id } });
    res.status(200).json({ success: true, message: "Campaign deleted" });
  } catch (error) {
    next(error);
  }
};

// GET /api/v1/marketing/abandoned-carts
export const getAbandonedCarts = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const { page = "1", limit = "10", recovered } = req.query;
    const skip = (Number(page) - 1) * Number(limit);
    const where: any = {};
    if (recovered !== undefined) where.recovered = recovered === "true";

    const [carts, total] = await Promise.all([
      prisma.abandonedCart.findMany({
        where,
        skip,
        take: Number(limit),
        orderBy: { createdAt: "desc" },
      }),
      prisma.abandonedCart.count({ where }),
    ]);

    res.status(200).json({
      success: true,
      data: {
        carts,
        pagination: {
          page: Number(page),
          limit: Number(limit),
          total,
          totalPages: Math.ceil(total / Number(limit)),
        },
      },
    });
  } catch (error) {
    next(error);
  }
};

// GET /api/v1/marketing/email-templates
export const getEmailTemplates = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const templates = await prisma.emailTemplate.findMany({
      orderBy: { name: "asc" },
    });
    res.status(200).json({ success: true, data: { templates } });
  } catch (error) {
    next(error);
  }
};

// GET /api/v1/marketing/email-templates/:id
export const getEmailTemplate = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const id = req.params.id as string; // ✅ fix: line 144

    const template = await prisma.emailTemplate.findUnique({ where: { id } });
    if (!template) throw new NotFoundError("Email template not found");
    res.status(200).json({ success: true, data: { template } });
  } catch (error) {
    next(error);
  }
};

// PUT /api/v1/marketing/email-templates/:id
export const updateEmailTemplate = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const id = req.params.id as string; // ✅ fix: lines 156, 159

    const template = await prisma.emailTemplate.findUnique({ where: { id } });
    if (!template) throw new NotFoundError("Email template not found");

    const updated = await prisma.emailTemplate.update({
      where: { id },
      data: req.body,
    });
    res
      .status(200)
      .json({
        success: true,
        message: "Template updated",
        data: { template: updated },
      });
  } catch (error) {
    next(error);
  }
};

// GET /api/v1/marketing/recipients/count?segment=ALL|NEW|REGULAR|VIP|WHOLESALE
export const getRecipientsCount = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const { segment } = req.query as { segment?: string };
    const count = await prisma.user.count({ where: segmentWhere(segment) });
    res.status(200).json({ success: true, data: { count } });
  } catch (error) {
    next(error);
  }
};

// POST /api/v1/marketing/recipients/upload
// Accepts a single spreadsheet file (CSV / XLS / XLSX) under the "file" field.
// Extracts "name" + "email" columns (case-insensitive, position-independent)
// and returns a preview — it does NOT send anything or touch the database.
export const uploadRecipients = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    if (!req.file) throw new AppError("No file provided", 400);
    if (!isAllowedSpreadsheetFile(req.file)) {
      throw new AppError(
        "Unsupported file type. Please upload a CSV, XLS, or XLSX file.",
        400,
      );
    }

    const result = parseRecipientsFromSpreadsheet(
      req.file.buffer,
      req.file.originalname,
    );

    if (result.validCount === 0) {
      throw new AppError(
        "No valid email addresses were found in that file. Double-check the 'Email' column and try again.",
        400,
      );
    }

    res.status(200).json({
      success: true,
      data: {
        recipients: result.recipients,
        totalRows: result.totalRows,
        validCount: result.validCount,
        duplicateCount: result.duplicateCount,
        skippedCount: result.skipped.length,
        skipped: result.skipped.slice(0, 50), // cap payload size for huge files
      },
    });
  } catch (error) {
    next(error);
  }
};

/** Merges segment-resolved recipients with a manually-uploaded list, de-duped by email. */
function mergeRecipients(
  fromSegment: { name: string; email: string }[],
  uploaded: ParsedRecipient[] | undefined,
) {
  const map = new Map<string, { name: string; email: string }>();
  for (const r of fromSegment) map.set(r.email.toLowerCase(), r);
  for (const r of uploaded || []) map.set(r.email.toLowerCase(), r);
  return Array.from(map.values());
}

// GET /api/v1/marketing/email-campaigns
export const getEmailCampaigns = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const { page = "1", limit = "10" } = req.query;
    const skip = (Number(page) - 1) * Number(limit);
    const where = { type: "EMAIL" as const };

    const [campaigns, total] = await Promise.all([
      prisma.marketingCampaign.findMany({
        where,
        skip,
        take: Number(limit),
        orderBy: { createdAt: "desc" },
      }),
      prisma.marketingCampaign.count({ where }),
    ]);

    res.status(200).json({ success: true, data: { campaigns, total } });
  } catch (error) {
    next(error);
  }
};

// POST /api/v1/marketing/email-campaigns
// Body: { subject, body, targetSegment?, scheduledFor?, customRecipients?: [{name,email}] }
// `customRecipients` is the list previously returned by /recipients/upload — it lets an
// admin bulk-email a spreadsheet of contacts instead of (or in addition to) a segment.
export const createEmailCampaign = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const {
      subject,
      body,
      targetSegment = "ALL",
      scheduledFor,
      customRecipients,
    } = req.body as {
      subject: string;
      body: string;
      targetSegment?: string;
      scheduledFor?: string;
      customRecipients?: ParsedRecipient[];
    };

    if (!subject || !body) throw new AppError("Subject and body are required", 400);

    const usingCustomList = Array.isArray(customRecipients) && customRecipients.length > 0;

    let recipients: { name: string; email: string }[] = [];
    if (usingCustomList) {
      // Custom list only — an uploaded spreadsheet is treated as the explicit,
      // intentional recipient set rather than being blended with a segment.
      recipients = mergeRecipients([], customRecipients);
    } else {
      const users = await prisma.user.findMany({
        where: segmentWhere(targetSegment),
        select: { name: true, email: true },
      });
      recipients = users;
    }

    if (recipients.length === 0) {
      throw new AppError("No recipients found for this campaign", 400);
    }

    const campaign = await prisma.marketingCampaign.create({
      data: {
        name: subject,
        type: "EMAIL",
        subject,
        content: body,
        segment: usingCustomList ? "CUSTOM_LIST" : targetSegment,
        recipients: recipients.map((r) => r.email),
        status: scheduledFor ? "SCHEDULED" : "DRAFT",
        ...(scheduledFor && { scheduledAt: new Date(scheduledFor) }),
      },
    });

    // Scheduled campaigns are saved and picked up later by a scheduler/cron —
    // sending happens immediately only when no scheduledFor is provided.
    if (!scheduledFor) {
      const results = await Promise.allSettled(
        recipients.map((r) =>
          sendEmail({
            to: r.email,
            subject,
            html: body,
          }),
        ),
      );
      const sentCount = results.filter((r) => r.status === "fulfilled").length;
      const failedCount = results.length - sentCount;

      const updated = await prisma.marketingCampaign.update({
        where: { id: campaign.id },
        data: {
          status: failedCount === results.length ? "FAILED" : "SENT",
          sentAt: new Date(),
          sentCount,
        },
      });

      res.status(201).json({
        success: true,
        message: `Campaign sent to ${sentCount} recipient${sentCount !== 1 ? "s" : ""}${failedCount ? ` (${failedCount} failed)` : ""}`,
        data: { campaign: updated },
      });
      return;
    }

    res.status(201).json({
      success: true,
      message: `Campaign scheduled for ${recipients.length} recipient${recipients.length !== 1 ? "s" : ""}`,
      data: { campaign },
    });
  } catch (error) {
    next(error);
  }
};

// GET /api/v1/marketing/sms-campaigns
export const getSmsCampaigns = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const { page = "1", limit = "10" } = req.query;
    const skip = (Number(page) - 1) * Number(limit);
    const where = { type: "SMS" as const };

    const [campaigns, total] = await Promise.all([
      prisma.marketingCampaign.findMany({
        where,
        skip,
        take: Number(limit),
        orderBy: { createdAt: "desc" },
      }),
      prisma.marketingCampaign.count({ where }),
    ]);

    res.status(200).json({ success: true, data: { campaigns, total } });
  } catch (error) {
    next(error);
  }
};

// GET /api/v1/marketing/sms-provider-status
// Lets the admin UI show a clear "SMS isn't configured yet" banner up front,
// instead of only discovering it after a failed send.
export const getSmsStatus = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const status = await getSmsProviderStatus();
    res.status(200).json({ success: true, data: status });
  } catch (error) {
    next(error);
  }
};

// POST /api/v1/marketing/recipients/upload-phone
// Same idea as /recipients/upload but for bulk SMS: extracts "Name" + "Phone"
// (or "Mobile") columns, case-insensitive, regardless of column order.
export const uploadPhoneRecipients = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    if (!req.file) throw new AppError("No file provided", 400);
    if (!isAllowedSpreadsheetFile(req.file)) {
      throw new AppError(
        "Unsupported file type. Please upload a CSV, XLS, or XLSX file.",
        400,
      );
    }

    const result = parsePhoneRecipientsFromSpreadsheet(
      req.file.buffer,
      req.file.originalname,
    );

    if (result.validCount === 0) {
      throw new AppError(
        "No valid phone numbers were found in that file. Double-check the 'Phone' column and try again.",
        400,
      );
    }

    res.status(200).json({
      success: true,
      data: {
        recipients: result.recipients,
        totalRows: result.totalRows,
        validCount: result.validCount,
        duplicateCount: result.duplicateCount,
        skippedCount: result.skipped.length,
        skipped: result.skipped.slice(0, 50),
      },
    });
  } catch (error) {
    next(error);
  }
};

// POST /api/v1/marketing/sms-campaigns
// Body: { message, targetSegment?, scheduledFor?, customRecipients?: [{name,phone}] }
// Sends via Termii once configured in Settings → SMS. If no provider is
// configured, fails fast with a clear message instead of a silent DRAFT.
export const createSmsCampaign = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const {
      message,
      targetSegment = "ALL",
      scheduledFor,
      customRecipients,
    } = req.body as {
      message: string;
      targetSegment?: string;
      scheduledFor?: string;
      customRecipients?: ParsedPhoneRecipient[];
    };
    if (!message) throw new AppError("Message is required", 400);

    const usingCustomList = Array.isArray(customRecipients) && customRecipients.length > 0;

    let recipients: { name: string; phone: string }[] = [];
    if (usingCustomList) {
      const map = new Map<string, { name: string; phone: string }>();
      for (const r of customRecipients!) map.set(r.phone, r);
      recipients = Array.from(map.values());
    } else {
      const users = await prisma.user.findMany({
        where: { ...segmentWhere(targetSegment), phone: { not: null } },
        select: { name: true, phone: true },
      });
      recipients = users
        .filter((u) => !!u.phone)
        .map((u) => ({ name: u.name, phone: u.phone as string }));
    }

    if (recipients.length === 0) {
      throw new AppError("No recipients with a phone number were found for this campaign", 400);
    }

    // Fail fast with a clear, specific message if Termii isn't configured —
    // don't create a campaign record for a send that can't happen.
    if (!scheduledFor) {
      await assertSmsConfigured();
    }

    const campaign = await prisma.marketingCampaign.create({
      data: {
        name: message.slice(0, 40),
        type: "SMS",
        content: message,
        segment: usingCustomList ? "CUSTOM_LIST" : targetSegment,
        recipients: recipients.map((r) => r.phone),
        status: scheduledFor ? "SCHEDULED" : "DRAFT",
        ...(scheduledFor && { scheduledAt: new Date(scheduledFor) }),
      },
    });

    if (!scheduledFor) {
      const results = await Promise.allSettled(
        recipients.map((r) => sendSms({ to: r.phone, message })),
      );
      const sentCount = results.filter((r) => r.status === "fulfilled").length;
      const failedCount = results.length - sentCount;

      const updated = await prisma.marketingCampaign.update({
        where: { id: campaign.id },
        data: {
          status: failedCount === results.length ? "FAILED" : "SENT",
          sentAt: new Date(),
          sentCount,
        },
      });

      res.status(201).json({
        success: true,
        message: `Campaign sent to ${sentCount} recipient${sentCount !== 1 ? "s" : ""}${failedCount ? ` (${failedCount} failed)` : ""}`,
        data: { campaign: updated },
      });
      return;
    }

    res.status(201).json({
      success: true,
      message: `Campaign scheduled for ${recipients.length} recipient${recipients.length !== 1 ? "s" : ""}`,
      data: { campaign },
    });
  } catch (error) {
    next(error);
  }
};
