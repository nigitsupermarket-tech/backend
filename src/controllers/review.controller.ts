import { Request, Response, NextFunction } from "express";
import prisma from "../config/database";
import { AppError, NotFoundError } from "../utils/appError";
import { AuthRequest } from "../middlewares/auth.middleware";

// GET /api/v1/reviews?productId=xxx
export const getProductReviews = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const { productId, page = "1", limit = "10", rating } = req.query;
    const skip = (Number(page) - 1) * Number(limit);

    const where: any = { isApproved: true };
    if (productId) where.productId = productId;
    if (rating) where.rating = Number(rating);

    const [reviews, total] = await Promise.all([
      prisma.review.findMany({
        where,
        skip,
        take: Number(limit),
        orderBy: { createdAt: "desc" },
        include: { user: { select: { id: true, name: true, image: true } } },
      }),
      prisma.review.count({ where }),
    ]);

    const avgRating = reviews.length
      ? reviews.reduce((s, r) => s + r.rating, 0) / reviews.length
      : 0;

    res.status(200).json({
      success: true,
      data: {
        reviews,
        averageRating: Math.round(avgRating * 10) / 10,
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

// GET /api/v1/reviews/pending
export const getPendingReviews = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const { page = "1", limit = "10" } = req.query;
    const skip = (Number(page) - 1) * Number(limit);

    const [reviews, total] = await Promise.all([
      prisma.review.findMany({
        where: { isApproved: false },
        skip,
        take: Number(limit),
        orderBy: { createdAt: "desc" },
        include: {
          user: { select: { id: true, name: true, image: true } },
          product: { select: { id: true, name: true, images: true } },
        },
      }),
      prisma.review.count({ where: { isApproved: false } }),
    ]);

    res.status(200).json({
      success: true,
      data: {
        reviews,
        pagination: {
          page: Number(page),
          total,
          totalPages: Math.ceil(total / Number(limit)),
        },
      },
    });
  } catch (error) {
    next(error);
  }
};

// POST /api/v1/reviews
export const createReview = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const { productId, rating, comment, images } = req.body;
    const userId = req.user!.userId;

    const product = await prisma.product.findUnique({
      where: { id: productId },
    });
    if (!product) throw new NotFoundError("Product not found");

    const existing = await prisma.review.findFirst({
      where: { productId, userId },
    });
    if (existing)
      throw new AppError("You have already reviewed this product", 409);

    const hasPurchased = await prisma.orderItem.findFirst({
      where: { productId, order: { userId, paymentStatus: "PAID" } },
    });

    const review = await prisma.review.create({
      data: {
        productId,
        userId,
        rating,
        comment,
        images: images || [],
        isVerified: !!hasPurchased,
        isApproved: !!hasPurchased,
      },
      include: { user: { select: { id: true, name: true, image: true } } },
    });

    res
      .status(201)
      .json({ success: true, message: "Review submitted", data: { review } });
  } catch (error) {
    next(error);
  }
};

// PUT /api/v1/reviews/:id
export const updateReview = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const id = req.params.id as string; // ✅ fix: lines 117, 122

    const review = await prisma.review.findUnique({ where: { id } });
    if (!review) throw new NotFoundError("Review not found");
    if (review.userId !== req.user?.userId)
      throw new AppError("Not authorized", 403);

    const updated = await prisma.review.update({
      where: { id },
      data: { rating: req.body.rating, comment: req.body.comment },
    });

    res
      .status(200)
      .json({
        success: true,
        message: "Review updated",
        data: { review: updated },
      });
  } catch (error) {
    next(error);
  }
};

// DELETE /api/v1/reviews/:id
export const deleteReview = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const id = req.params.id as string; // ✅ fix: lines 137, 141

    const isAdmin = ["ADMIN", "STAFF"].includes(req.user?.role || "");
    const review = await prisma.review.findUnique({ where: { id } });
    if (!review) throw new NotFoundError("Review not found");
    if (!isAdmin && review.userId !== req.user?.userId)
      throw new AppError("Not authorized", 403);

    await prisma.review.delete({ where: { id } });
    res.status(200).json({ success: true, message: "Review deleted" });
  } catch (error) {
    next(error);
  }
};

// PUT /api/v1/reviews/:id/approve
export const toggleApproveReview = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const id = req.params.id as string; // ✅ fix: lines 152, 156

    const review = await prisma.review.findUnique({ where: { id } });
    if (!review) throw new NotFoundError("Review not found");

    const updated = await prisma.review.update({
      where: { id },
      data: { isApproved: !review.isApproved },
    });

    res.status(200).json({
      success: true,
      message: `Review ${updated.isApproved ? "approved" : "unapproved"}`,
      data: { review: updated },
    });
  } catch (error) {
    next(error);
  }
};
