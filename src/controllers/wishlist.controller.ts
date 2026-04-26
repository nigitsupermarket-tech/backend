import { Response, NextFunction } from "express";
import prisma from "../config/database";
import { NotFoundError } from "../utils/appError";
import { AuthRequest } from "../middlewares/auth.middleware";

// GET /api/v1/wishlist
export const getWishlist = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const userId = req.user!.userId;

    const wishlist = await prisma.wishlist.findUnique({
      where: { userId },
      include: {
        items: {
          include: {
            product: {
              include: {
                category: { select: { id: true, name: true, slug: true } },
                brand: { select: { id: true, name: true, logo: true } },
                _count: { select: { reviews: true } },
              },
            },
          },
          orderBy: { createdAt: "desc" },
        },
      },
    });

    const items = wishlist?.items ?? [];

    res.status(200).json({
      success: true,
      data: {
        items,
        itemCount: items.length,
        productIds: items.map((i) => i.productId),
      },
    });
  } catch (error) {
    next(error);
  }
};

// POST /api/v1/wishlist/:productId — toggle add/remove
export const toggleWishlistItem = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const userId = req.user!.userId;
    const productId = req.params.productId as string;

    const product = await prisma.product.findUnique({
      where: { id: productId },
    });
    if (!product) throw new NotFoundError("Product not found");

    // Find or create wishlist
    let wishlist = await prisma.wishlist.findUnique({ where: { userId } });
    if (!wishlist) {
      wishlist = await prisma.wishlist.create({ data: { userId } });
    }

    const existingItem = await prisma.wishlistItem.findFirst({
      where: { wishlistId: wishlist.id, productId },
    });

    let action: "added" | "removed";
    if (existingItem) {
      await prisma.wishlistItem.delete({ where: { id: existingItem.id } });
      action = "removed";
    } else {
      await prisma.wishlistItem.create({
        data: { wishlistId: wishlist.id, productId },
      });
      action = "added";
    }

    const updated = await prisma.wishlist.findUnique({
      where: { userId },
      include: { items: true },
    });

    const productIds = updated?.items.map((i) => i.productId) ?? [];

    res.status(200).json({
      success: true,
      message: `Product ${action} ${action === "added" ? "to" : "from"} wishlist`,
      data: {
        action,
        productIds,
        itemCount: productIds.length,
      },
    });
  } catch (error) {
    next(error);
  }
};

// DELETE /api/v1/wishlist/:productId
export const removeWishlistItem = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const userId = req.user!.userId;
    const productId = req.params.productId as string;

    const wishlist = await prisma.wishlist.findUnique({ where: { userId } });
    if (wishlist) {
      await prisma.wishlistItem.deleteMany({
        where: { wishlistId: wishlist.id, productId },
      });
    }

    res.status(200).json({ success: true, message: "Removed from wishlist" });
  } catch (error) {
    next(error);
  }
};

// DELETE /api/v1/wishlist
export const clearWishlist = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const userId = req.user!.userId;
    const wishlist = await prisma.wishlist.findUnique({ where: { userId } });
    if (wishlist) {
      await prisma.wishlistItem.deleteMany({
        where: { wishlistId: wishlist.id },
      });
    }
    res.status(200).json({ success: true, message: "Wishlist cleared" });
  } catch (error) {
    next(error);
  }
};
