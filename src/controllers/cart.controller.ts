// backend/src/controllers/cart.controller.ts

import { Request, Response, NextFunction } from "express";
import { Prisma } from "@prisma/client";
import prisma from "../config/database";
import { AppError, NotFoundError } from "../utils/appError";
import { AuthRequest } from "../middlewares/auth.middleware";

const IS_PROD = process.env.NODE_ENV === "production";

// Guest cart identity lives entirely in this cookie (there's no bearer-token
// equivalent for guests). Frontend and backend are on different domains in
// production (e.g. Vercel + a separate API host), which makes this a
// cross-site request. A cross-site cookie MUST be `secure: true` and
// `sameSite: "none"` or the browser will accept the Set-Cookie but then
// silently refuse to send it back on the next request — every subsequent
// call looks like a brand-new guest, so items never accumulate and a
// refreshed page shows an empty cart. `sameSite: "lax"` (the previous
// setting) only works for same-site deployments.
const CART_SESSION_COOKIE_OPTIONS = {
  maxAge: 7 * 24 * 60 * 60 * 1000,
  httpOnly: true,
  secure: IS_PROD,
  sameSite: (IS_PROD ? "none" : "lax") as "none" | "lax",
};

// ── helper: find-or-create cart safely ───────────────────────────────────────
async function findOrCreateCart(
  userId: string | undefined,
  sessionId: string | undefined,
) {
  const where = userId ? { userId } : { sessionId };

  let cart = await prisma.cart.findFirst({ where });
  if (cart) return cart;

  try {
    cart = await prisma.cart.create({
      data: userId ? { userId } : { sessionId },
    });
    return cart;
  } catch (err: any) {
    if (err?.code === "P2002" || err?.code === 11000) {
      // Someone else created this exact cart a moment ago (double-click,
      // two tabs, etc). Re-read it — retry once with a brief delay in case
      // of read-after-write lag, then surface the error if it genuinely
      // isn't there (which now indicates a real problem, not the old
      // structural index bug).
      for (const delayMs of [0, 150]) {
        if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
        const existing = await prisma.cart.findFirst({ where });
        if (existing) return existing;
      }
    }
    throw err;
  }
}

// ── GET /api/v1/cart ──────────────────────────────────────────────────────────
export const getCart = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const userId = req.user?.userId;
    const sessionId = req.cookies.cartSession;

    if (!userId && !sessionId) {
      return res.status(200).json({
        success: true,
        data: { cart: null, items: [], summary: { subtotal: 0, itemCount: 0 } },
      });
    }

    const where = userId ? { userId } : { sessionId };
    const cart = await prisma.cart.findFirst({
      where,
      include: {
        items: {
          include: {
            product: {
              select: {
                id: true,
                name: true,
                slug: true,
                images: true,
                price: true,
                pricePerUnit: true,
                isScalable: true,
                scaleUnit: true,
                stockQuantity: true,
                status: true,
                sku: true,
              },
            },
          },
        },
      },
    });

    if (!cart) {
      return res.status(200).json({
        success: true,
        data: { cart: null, items: [], summary: { subtotal: 0, itemCount: 0 } },
      });
    }

    // For scalable items, price stored in CartItem is pricePerUnit;
    // subtotal = price * quantity (where quantity is the float amount, e.g. 1.5 kg)
    const subtotal = cart.items.reduce((s, i) => s + i.price * i.quantity, 0);
    // Item count: for scalable, count fractional amounts; for fixed, whole units
    const itemCount = cart.items.reduce((s, i) => s + i.quantity, 0);

    res.status(200).json({
      success: true,
      data: { cart, items: cart.items, summary: { subtotal, itemCount } },
    });
  } catch (error) {
    next(error);
  }
};

// ── POST /api/v1/cart ─────────────────────────────────────────────────────────
export const addToCart = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const { productId, quantity = 1 } = req.body;
    const userId = req.user?.userId;
    let sessionId = req.cookies.cartSession;

    // Generate session cookie for guests
    if (!userId && !sessionId) {
      sessionId = `guest_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      res.cookie("cartSession", sessionId, CART_SESSION_COOKIE_OPTIONS);
    }

    const product = await prisma.product.findUnique({
      where: { id: productId },
    });
    if (!product) throw new NotFoundError("Product not found");
    if (product.status !== "ACTIVE")
      throw new AppError("This product is currently unavailable", 400);

    // ── Stock check ──────────────────────────────────────────────────────────
    // For scalable products: stockQuantity is in scale units (e.g. kg).
    // quantity from request is also in scale units.
    // For fixed products: both are whole integers.
    if (!product.allowBackorder && product.stockQuantity < quantity) {
      if (product.stockQuantity === 0) {
        throw new AppError(`${product.name} is out of stock`, 400);
      }
      const unit = product.isScalable ? product.scaleUnit || "unit" : "unit";
      const available = product.isScalable
        ? `${product.stockQuantity} ${unit}`
        : `${product.stockQuantity} unit${product.stockQuantity === 1 ? "" : "s"}`;
      throw new AppError(`Only ${available} of ${product.name} available`, 400);
    }

    // ── Price: use pricePerUnit for scalable, price for fixed ────────────────
    const itemPrice =
      product.isScalable && product.pricePerUnit
        ? product.pricePerUnit
        : product.price;

    const cart = await findOrCreateCart(userId, sessionId);

    const existingItem = await prisma.cartItem.findFirst({
      where: { cartId: cart.id, productId },
    });

    if (existingItem) {
      const newQty = existingItem.quantity + quantity;
      if (!product.allowBackorder && product.stockQuantity < newQty) {
        const available = product.stockQuantity - existingItem.quantity;
        const unit = product.isScalable
          ? product.scaleUnit || "unit"
          : undefined;
        if (available <= 0) {
          throw new AppError(
            `You already have all available stock of ${product.name} in your cart`,
            400,
          );
        }
        throw new AppError(
          unit
            ? `Only ${available} ${unit} more of ${product.name} can be added`
            : `Only ${available} more unit${available === 1 ? "" : "s"} of ${product.name} can be added`,
          400,
        );
      }
      await prisma.cartItem.update({
        where: { id: existingItem.id },
        data: { quantity: newQty },
      });
    } else {
      await prisma.cartItem.create({
        data: { cartId: cart.id, productId, quantity, price: itemPrice },
      });
    }

    const updatedCart = await prisma.cart.findUnique({
      where: { id: cart.id },
      include: {
        items: {
          include: {
            product: {
              select: {
                id: true,
                name: true,
                images: true,
                price: true,
                pricePerUnit: true,
                isScalable: true,
                scaleUnit: true,
                stockQuantity: true,
              },
            },
          },
        },
      },
    });

    const subtotal = updatedCart!.items.reduce(
      (s, i) => s + i.price * i.quantity,
      0,
    );
    const itemCount = updatedCart!.items.reduce((s, i) => s + i.quantity, 0);

    res.status(200).json({
      success: true,
      message: "Item added to cart",
      data: { cart: updatedCart, summary: { subtotal, itemCount } },
    });
  } catch (error) {
    next(error);
  }
};

// ── PUT /api/v1/cart/:itemId ──────────────────────────────────────────────────
export const updateCartItem = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const itemId = req.params.itemId as string;
    const { quantity } = req.body;

    const item = await prisma.cartItem.findUnique({
      where: { id: itemId },
      include: { product: true },
    });
    if (!item) throw new NotFoundError("Cart item not found");

    // Minimum: for scalable products use minOrderQty, for fixed use 1
    const minQty = item.product.isScalable
      ? item.product.minOrderQty || item.product.scaleStep || 0.1
      : 1;

    if (quantity < minQty)
      throw new AppError(
        `Minimum quantity is ${minQty}${item.product.isScalable ? ` ${item.product.scaleUnit || "unit"}` : ""}`,
        400,
      );

    if (!item.product.allowBackorder && item.product.stockQuantity < quantity) {
      const unit = item.product.isScalable
        ? item.product.scaleUnit || "unit"
        : undefined;
      throw new AppError(
        unit
          ? `Only ${item.product.stockQuantity} ${unit} of ${item.product.name} available`
          : `Only ${item.product.stockQuantity} item(s) available`,
        400,
      );
    }

    await prisma.cartItem.update({ where: { id: itemId }, data: { quantity } });

    res.status(200).json({ success: true, message: "Cart updated" });
  } catch (error) {
    next(error);
  }
};

// ── DELETE /api/v1/cart/:itemId ───────────────────────────────────────────────
export const removeCartItem = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const itemId = req.params.itemId as string;
    const item = await prisma.cartItem.findUnique({ where: { id: itemId } });
    if (!item) throw new NotFoundError("Cart item not found");
    await prisma.cartItem.delete({ where: { id: itemId } });
    res.status(200).json({ success: true, message: "Item removed" });
  } catch (error) {
    next(error);
  }
};

// ── DELETE /api/v1/cart ───────────────────────────────────────────────────────
export const clearCart = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const userId = req.user?.userId;
    const sessionId = req.cookies.cartSession;
    const where = userId ? { userId } : { sessionId };
    const cart = await prisma.cart.findFirst({ where });
    if (cart) {
      await prisma.cartItem.deleteMany({ where: { cartId: cart.id } });
    }
    res.status(200).json({ success: true, message: "Cart cleared" });
  } catch (error) {
    next(error);
  }
};

// ── POST /api/v1/cart/merge ───────────────────────────────────────────────────
export const mergeCart = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    if (!req.user) return next();
    const userId = req.user.userId;
    const sessionId = req.cookies.cartSession;

    if (!sessionId) {
      return res
        .status(200)
        .json({ success: true, message: "No guest cart to merge" });
    }

    const guestCart = await prisma.cart.findFirst({
      where: { sessionId },
      include: { items: true },
    });

    if (!guestCart || guestCart.items.length === 0) {
      res.clearCookie("cartSession");
      return res
        .status(200)
        .json({ success: true, message: "No guest cart to merge" });
    }

    const userCart = await findOrCreateCart(userId, undefined);

    for (const guestItem of guestCart.items) {
      const existing = await prisma.cartItem.findFirst({
        where: { cartId: userCart.id, productId: guestItem.productId },
      });

      if (existing) {
        await prisma.cartItem.update({
          where: { id: existing.id },
          data: { quantity: existing.quantity + guestItem.quantity },
        });
      } else {
        await prisma.cartItem.create({
          data: {
            cartId: userCart.id,
            productId: guestItem.productId,
            quantity: guestItem.quantity,
            price: guestItem.price,
          },
        });
      }
    }

    await prisma.cart.delete({ where: { id: guestCart.id } });
    res.clearCookie("cartSession");

    res
      .status(200)
      .json({ success: true, message: "Cart merged successfully" });
  } catch (error) {
    next(error);
  }
};
