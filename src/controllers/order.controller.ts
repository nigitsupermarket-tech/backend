import { Request, Response, NextFunction } from "express";
import prisma from "../config/database";
import { AppError, NotFoundError } from "../utils/appError";
import { AuthRequest } from "../middlewares/auth.middleware";
import {
  sendOrderConfirmationEmail,
  sendTrackingUpdateEmail,
} from "../services/email.service";

const generateOrderNumber = () =>
  `ORD-${Date.now().toString().slice(-8)}-${Math.floor(Math.random() * 1000)
    .toString()
    .padStart(3, "0")}`;

// GET /api/v1/orders
export const getOrders = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const {
      page = "1",
      limit = "10",
      status,
      paymentStatus,
      search,
      startDate,
      endDate,
    } = req.query;
    const skip = (Number(page) - 1) * Number(limit);
    const isAdmin = req.user?.role === "ADMIN" || req.user?.role === "STAFF";

    const where: any = {};
    if (!isAdmin) where.userId = req.user?.userId;
    if (status) where.status = status;
    if (paymentStatus) where.paymentStatus = paymentStatus;
    if (search) {
      where.OR = [
        { orderNumber: { contains: search as string, mode: "insensitive" } },
        { customerEmail: { contains: search as string, mode: "insensitive" } },
        { customerName: { contains: search as string, mode: "insensitive" } },
      ];
    }
    if (startDate || endDate) {
      where.createdAt = {};
      if (startDate) where.createdAt.gte = new Date(startDate as string);
      if (endDate) where.createdAt.lte = new Date(endDate as string);
    }

    const [orders, total] = await Promise.all([
      prisma.order.findMany({
        where,
        skip,
        take: Number(limit),
        orderBy: { createdAt: "desc" },
        include: {
          items: {
            include: {
              product: { select: { id: true, name: true, images: true } },
            },
          },
          user: { select: { id: true, name: true, email: true } },
        },
      }),
      prisma.order.count({ where }),
    ]);

    res.status(200).json({
      success: true,
      data: {
        orders,
        pagination: {
          page: Number(page),
          limit: Number(limit),
          total,
          totalPages: Math.ceil(total / Number(limit)),
          hasMore: skip + orders.length < total,
        },
      },
    });
  } catch (error) {
    next(error);
  }
};

// GET /api/v1/orders/:id
export const getOrder = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const id = req.params.id as string; // ✅ fix: lines 68 (id & orderNumber)
    const isAdmin = req.user?.role === "ADMIN" || req.user?.role === "STAFF";

    const order = await prisma.order.findFirst({
      where: { OR: [{ id }, { orderNumber: id }] },
      include: {
        items: { include: { product: true } },
        user: { select: { id: true, name: true, email: true, phone: true } },
        // ✅ fix: removed `discount: true` — no such relation on Order; discountId is a scalar field
        statusHistory: { orderBy: { createdAt: "asc" } },
      },
    });

    if (!order) throw new NotFoundError("Order not found");
    if (!isAdmin && order.userId !== req.user?.userId)
      throw new AppError("Not authorized", 403);

    res.status(200).json({ success: true, data: { order } });
  } catch (error) {
    next(error);
  }
};

// PUT /api/v1/orders/:id/status
export const updateOrderStatus = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const id = req.params.id as string; // ✅ fix: lines 248, 260, 261, 266

    const { status, notes, trackingNumber, estimatedDelivery } = req.body;

    const order = await prisma.order.findUnique({ where: { id } });
    if (!order) throw new NotFoundError("Order not found");

    const updates: any = { status };
    if (trackingNumber) updates.trackingNumber = trackingNumber;
    if (estimatedDelivery)
      updates.estimatedDelivery = new Date(estimatedDelivery);
    if (status === "CONFIRMED") updates.confirmedAt = new Date();
    if (status === "SHIPPED") updates.shippedAt = new Date();
    if (status === "DELIVERED") updates.deliveredAt = new Date();
    if (status === "CANCELLED") updates.cancelledAt = new Date();

    const [updated] = await prisma.$transaction([
      prisma.order.update({ where: { id }, data: updates }),
      prisma.orderStatusHistory.create({
        data: { orderId: id, status, notes },
      }),
    ]);

    if (status === "CANCELLED") {
      const items = await prisma.orderItem.findMany({ where: { orderId: id } });
      for (const item of items) {
        await prisma.product.update({
          where: { id: item.productId },
          data: {
            stockQuantity: { increment: item.quantity },
            salesCount: { decrement: item.quantity },
          },
        });
      }
    }

    res.status(200).json({
      success: true,
      message: "Order status updated",
      data: { order: updated },
    });
  } catch (error) {
    next(error);
  }
};

// PUT /api/v1/orders/:id/cancel
export const cancelOrder = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const id = req.params.id as string; // ✅ fix: lines 286, 296, 297, 301

    // ✅ fix: include items so order.items is available below (line 301)
    const order = await prisma.order.findUnique({
      where: { id },
      include: { items: true },
    });
    if (!order) throw new NotFoundError("Order not found");
    if (order.userId !== req.user?.userId)
      throw new AppError("Not authorized", 403);

    const cancellableStatuses = ["PENDING", "CONFIRMED"];
    if (!cancellableStatuses.includes(order.status)) {
      throw new AppError("Order cannot be cancelled at this stage", 400);
    }

    await prisma.$transaction([
      prisma.order.update({
        where: { id },
        data: { status: "CANCELLED", cancelledAt: new Date() },
      }),
      prisma.orderStatusHistory.create({
        data: {
          orderId: id,
          status: "CANCELLED",
          notes: "Cancelled by customer",
        },
      }),
    ]);

    for (const item of order.items) {
      await prisma.product.update({
        where: { id: item.productId },
        data: { stockQuantity: { increment: item.quantity } },
      });
    }

    res
      .status(200)
      .json({ success: true, message: "Order cancelled successfully" });
  } catch (error) {
    next(error);
  }
};

// GET /api/v1/orders/stats
export const getOrderStats = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const today = new Date();
    const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
    const startOfLastMonth = new Date(
      today.getFullYear(),
      today.getMonth() - 1,
      1,
    );
    const endOfLastMonth = new Date(today.getFullYear(), today.getMonth(), 0);

    const [
      totalOrders,
      monthOrders,
      lastMonthOrders,
      revenueData,
      statusCounts,
    ] = await Promise.all([
      prisma.order.count({ where: { paymentStatus: "PAID" } }),
      prisma.order.aggregate({
        where: { createdAt: { gte: startOfMonth }, paymentStatus: "PAID" },
        _sum: { total: true },
        _count: true,
      }),
      prisma.order.aggregate({
        where: {
          createdAt: { gte: startOfLastMonth, lte: endOfLastMonth },
          paymentStatus: "PAID",
        },
        _sum: { total: true },
        _count: true,
      }),
      prisma.order.groupBy({ by: ["status"], _count: true }),
      prisma.order.groupBy({ by: ["status"], _count: true }),
    ]);

    res.status(200).json({
      success: true,
      data: {
        totalOrders,
        monthRevenue: monthOrders._sum.total || 0,
        monthOrders: monthOrders._count,
        lastMonthRevenue: lastMonthOrders._sum.total || 0,
        statusBreakdown: revenueData,
      },
    });
  } catch (error) {
    next(error);
  }
};

// POST /api/v1/orders (Create Order - Enhanced with shipping)
export const createOrder = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const {
      items,
      shippingAddress,
      billingAddress,
      paymentMethod,
      shippingMethodId,
      discountCode,
      customerNotes,
    } = req.body;

    if (!req.user) throw new AppError("Authentication required", 401);
    const userId = req.user.userId;

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundError("User not found");

    // Validate shipping method
    const shippingMethod = await prisma.shippingMethod.findUnique({
      where: { id: shippingMethodId },
      include: { weightRates: true, zone: true },
    });
    if (!shippingMethod) throw new NotFoundError("Shipping method not found");

    let subtotal = 0;
    let totalWeight = 0;
    const orderItems: any[] = [];
    const categoryIds: string[] = [];
    const productIds: string[] = [];

    for (const item of items) {
      const product = await prisma.product.findUnique({
        where: { id: item.productId },
      });
      if (!product)
        throw new NotFoundError(`Product ${item.productId} not found`);
      if (product.status !== "ACTIVE")
        throw new AppError(`${product.name} is not available`, 400);
      if (!product.allowBackorder && product.stockQuantity < item.quantity) {
        throw new AppError(`Insufficient stock for ${product.name}`, 400);
      }

      const itemSubtotal = product.price * item.quantity;
      subtotal += itemSubtotal;
      totalWeight += (product.weight || 0) * item.quantity;

      categoryIds.push(product.categoryId);
      productIds.push(product.id);

      orderItems.push({
        productId: product.id,
        productName: product.name,
        productSku: product.sku,
        productImage: product.images[0] || null,
        quantity: item.quantity,
        price: product.price,
        subtotal: itemSubtotal,
      });
    }

    // Calculate shipping cost
    let shippingCost = 0;
    if (shippingMethod.type === "FLAT_RATE") {
      shippingCost = shippingMethod.flatRateCost || 0;
    } else if (shippingMethod.type === "TABLE_RATE") {
      const applicableRate = shippingMethod.weightRates.find(
        (rate) =>
          totalWeight >= rate.minWeight &&
          (rate.maxWeight === null || totalWeight <= rate.maxWeight),
      );
      shippingCost = applicableRate?.cost || 0;
    } else if (shippingMethod.type === "STORE_PICKUP") {
      shippingCost = 0;
    }

    // Apply discount
    let discountAmount = 0;
    let discountId: string | null = null;

    if (discountCode) {
      const discount = await prisma.discount.findFirst({
        where: { code: discountCode.toUpperCase(), isActive: true },
      });

      if (!discount) throw new AppError("Invalid discount code", 400);
      if (discount.endDate && discount.endDate < new Date())
        throw new AppError("Discount code has expired", 400);
      if (discount.usageLimit && discount.usageCount >= discount.usageLimit)
        throw new AppError("Discount code usage limit reached", 400);
      if (discount.minOrderAmount && subtotal < discount.minOrderAmount) {
        throw new AppError(
          `Minimum order amount of ₦${discount.minOrderAmount} required`,
          400,
        );
      }

      if (discount.type === "PERCENTAGE") {
        discountAmount = (subtotal * discount.value) / 100;
        if (discount.maxDiscount)
          discountAmount = Math.min(discountAmount, discount.maxDiscount);
      } else if (discount.type === "FIXED_AMOUNT") {
        discountAmount = Math.min(discount.value, subtotal);
      } else if (discount.type === "FREE_SHIPPING") {
        discountAmount = shippingCost;
      }

      discountId = discount.id;
    }

    const tax = 0;
    const total =
      subtotal -
      discountAmount +
      tax +
      (discountCode && discountAmount >= shippingCost ? 0 : shippingCost);

    // Estimate delivery date
    const estimatedDelivery = new Date();
    const maxDays = shippingMethod.estimatedMaxDays || 5;
    estimatedDelivery.setDate(estimatedDelivery.getDate() + maxDays);

    const order = await prisma.$transaction(async (tx) => {
      const newOrder = await tx.order.create({
        data: {
          orderNumber: generateOrderNumber(),
          userId,
          status: "PENDING",
          subtotal,
          discountAmount,
          tax,
          shippingCost,
          total,
          paymentMethod,
          paymentStatus: "PENDING",
          shippingAddress,
          billingAddress: billingAddress || shippingAddress,
          shippingMethodId: shippingMethod.id,
          shippingMethodName: shippingMethod.name,
          estimatedDelivery,
          customerName: user.name,
          customerEmail: user.email,
          customerPhone: user.phone || shippingAddress.phone,
          discountCode: discountCode || null,
          discountId,
          customerNotes,
          items: { create: orderItems },
        },
        include: { items: true },
      });

      // Update inventory
      for (const item of orderItems) {
        await tx.product.update({
          where: { id: item.productId },
          data: {
            stockQuantity: { decrement: item.quantity },
            salesCount: { increment: item.quantity },
          },
        });
        await tx.inventoryLog.create({
          data: {
            productId: item.productId,
            type: "SALE",
            quantity: item.quantity,
            previousQty: 0,
            newQty: 0,
            reason: `Order ${newOrder.orderNumber}`,
            reference: newOrder.id,
          },
        });
      }

      if (discountId) {
        await tx.discount.update({
          where: { id: discountId },
          data: { usageCount: { increment: 1 } },
        });
      }

      // Clear cart
      const cart = await tx.cart.findFirst({ where: { userId } });
      if (cart) await tx.cartItem.deleteMany({ where: { cartId: cart.id } });

      // Create order status history
      await tx.orderStatusHistory.create({
        data: {
          orderId: newOrder.id,
          status: "PENDING",
          notes: "Order placed",
        },
      });

      // Create initial tracking update
      await tx.orderTrackingUpdate.create({
        data: {
          orderId: newOrder.id,
          status: "Order Confirmed",
          message: "Your order has been received and is being processed",
          timestamp: new Date(),
        },
      });

      // Update user stats
      await tx.user.update({
        where: { id: userId },
        data: {
          totalSpent: { increment: total },
          orderCount: { increment: 1 },
          lastOrderDate: new Date(),
        },
      });

      return newOrder;
    });

    // Send confirmation email
    try {
      await sendOrderConfirmationEmail(
        user.email,
        user.name,
        order.orderNumber,
        total,
      );
    } catch (err) {
      console.error("Failed to send order confirmation email:", err);
    }

    res.status(201).json({
      success: true,
      message: "Order placed successfully",
      data: { order },
    });
  } catch (error) {
    next(error);
  }
};

// GET /api/v1/orders/:id/tracking
export const getOrderTracking = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const id = req.params.id as string;

    const order = await prisma.order.findFirst({
      where: { OR: [{ id }, { orderNumber: id }] },
      select: {
        id: true,
        orderNumber: true,
        status: true,
        trackingNumber: true,
        trackingUrl: true,
        estimatedDelivery: true,
        deliveredAt: true,
        createdAt: true,
        shippedAt: true,
        trackingUpdates: { orderBy: { timestamp: "desc" } },
      },
    });

    if (!order) throw new NotFoundError("Order not found");

    res.status(200).json({ success: true, data: { order } });
  } catch (error) {
    next(error);
  }
};

// POST /api/v1/orders/:id/tracking
export const addTrackingUpdate = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const id = req.params.id as string;
    const { status, message, location } = req.body;

    const order = await prisma.order.findUnique({
      where: { id },
      include: { user: true },
    });
    if (!order) throw new NotFoundError("Order not found");

    const update = await prisma.orderTrackingUpdate.create({
      data: {
        orderId: order.id,
        status,
        message,
        location,
        timestamp: new Date(),
      },
    });

    // Send tracking update email
    try {
      await sendTrackingUpdateEmail(
        order.user.email,
        order.user.name,
        order.orderNumber,
        status,
        message,
      );
    } catch (err) {
      console.error("Failed to send tracking email:", err);
    }

    res.status(201).json({
      success: true,
      message: "Tracking update added",
      data: { update },
    });
  } catch (error) {
    next(error);
  }
};

// PUT /api/v1/orders/:id/tracking-number
export const updateTrackingNumber = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const id = req.params.id as string;
    const { trackingNumber, trackingUrl } = req.body;

    const order = await prisma.order.findUnique({ where: { id } });
    if (!order) throw new NotFoundError("Order not found");

    const updated = await prisma.order.update({
      where: { id },
      data: { trackingNumber, trackingUrl },
    });

    res.status(200).json({
      success: true,
      message: "Tracking number updated",
      data: { order: updated },
    });
  } catch (error) {
    next(error);
  }
};
