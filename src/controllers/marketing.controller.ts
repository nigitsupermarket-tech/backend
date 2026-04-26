import { Response, NextFunction } from "express";
import prisma from "../config/database";
import { NotFoundError } from "../utils/appError";
import { AuthRequest } from "../middlewares/auth.middleware";

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
