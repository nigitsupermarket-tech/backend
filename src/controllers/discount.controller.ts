import { Request, Response, NextFunction } from "express";
import prisma from "../config/database";
import { AppError, NotFoundError } from "../utils/appError";
import { AuthRequest } from "../middlewares/auth.middleware";

// GET /api/v1/discounts
export const getDiscounts = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const { page = "1", limit = "10", isActive } = req.query;
    const skip = (Number(page) - 1) * Number(limit);
    const where: any = {};
    if (isActive !== undefined) where.isActive = isActive === "true";

    const [discounts, total] = await Promise.all([
      prisma.discount.findMany({
        where,
        skip,
        take: Number(limit),
        orderBy: { createdAt: "desc" },
      }),
      prisma.discount.count({ where }),
    ]);

    res.status(200).json({
      success: true,
      data: {
        discounts,
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

// GET /api/v1/discounts/:id
export const getDiscount = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const id = req.params.id as string; // ✅ fix: line 40

    const discount = await prisma.discount.findUnique({ where: { id } });
    if (!discount) throw new NotFoundError("Discount not found");
    res.status(200).json({ success: true, data: { discount } });
  } catch (error) {
    next(error);
  }
};

// POST /api/v1/discounts
export const createDiscount = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const { code, startDate, endDate, ...rest } = req.body;

    const existing = await prisma.discount.findUnique({
      where: { code: code.toUpperCase() },
    });
    if (existing) throw new AppError("Discount code already exists", 409);

    const discount = await prisma.discount.create({
      data: {
        ...rest,
        code: code.toUpperCase(),
        startDate: new Date(startDate),
        endDate: endDate ? new Date(endDate) : null,
      },
    });

    res
      .status(201)
      .json({ success: true, message: "Discount created", data: { discount } });
  } catch (error) {
    next(error);
  }
};

// PUT /api/v1/discounts/:id
export const updateDiscount = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const id = req.params.id as string; // ✅ fix: lines 77, 81

    const { startDate, endDate, ...rest } = req.body;

    const discount = await prisma.discount.findUnique({ where: { id } });
    if (!discount) throw new NotFoundError("Discount not found");

    const updated = await prisma.discount.update({
      where: { id },
      data: {
        ...rest,
        ...(startDate && { startDate: new Date(startDate) }),
        ...(endDate && { endDate: new Date(endDate) }),
      },
    });

    res
      .status(200)
      .json({
        success: true,
        message: "Discount updated",
        data: { discount: updated },
      });
  } catch (error) {
    next(error);
  }
};

// DELETE /api/v1/discounts/:id
export const deleteDiscount = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const id = req.params.id as string; // ✅ fix: lines 99, 102

    const discount = await prisma.discount.findUnique({ where: { id } });
    if (!discount) throw new NotFoundError("Discount not found");

    await prisma.discount.delete({ where: { id } });
    res.status(200).json({ success: true, message: "Discount deleted" });
  } catch (error) {
    next(error);
  }
};

// POST /api/v1/discounts/validate  (public - used at checkout)
export const validateDiscount = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const { code, orderAmount } = req.body;

    const discount = await prisma.discount.findFirst({
      where: { code: code.toUpperCase(), isActive: true },
    });

    if (!discount) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid discount code" });
    }
    if (discount.endDate && discount.endDate < new Date()) {
      return res
        .status(400)
        .json({ success: false, message: "Discount code has expired" });
    }
    if (discount.usageLimit && discount.usageCount >= discount.usageLimit) {
      return res
        .status(400)
        .json({ success: false, message: "Discount code usage limit reached" });
    }
    if (discount.minOrderAmount && orderAmount < discount.minOrderAmount) {
      return res.status(400).json({
        success: false,
        message: `Minimum order of ₦${discount.minOrderAmount.toLocaleString()} required`,
      });
    }

    let discountAmount = 0;
    if (discount.type === "PERCENTAGE") {
      discountAmount = (orderAmount * discount.value) / 100;
      if (discount.maxDiscount)
        discountAmount = Math.min(discountAmount, discount.maxDiscount);
    } else if (discount.type === "FIXED_AMOUNT") {
      discountAmount = Math.min(discount.value, orderAmount);
    }
    // FREE_SHIPPING discount amount is calculated on frontend based on chosen shipping rate

    res.status(200).json({
      success: true,
      message: "Discount code applied",
      data: {
        discount: {
          id: discount.id,
          code: discount.code,
          type: discount.type,
          value: discount.value,
          name: discount.name,
        },
        discountAmount,
      },
    });
  } catch (error) {
    next(error);
  }
};
