// backend/src/controllers/shipping.controller.ts
// Complete shipment, logistics & tracking system for NigitTriple
// Covers: Zones · Methods (TABLE_RATE / FLAT_RATE / STORE_PICKUP) · Weight-based pricing
//         Shipment creation · Tracking updates · Dashboard stats · Seed data

import { Request, Response, NextFunction } from "express";
import prisma from "../config/database";
import { BadRequestError, NotFoundError } from "../utils/appError";
import { AuthRequest } from "../middlewares/auth.middleware";
import { z } from "zod";

// ── Utility ───────────────────────────────────────────────────────────────────

const generateTrackingNumber = (): string => {
  const prefix = "NGT";
  const timestamp = Date.now().toString().slice(-8);
  const random = Math.floor(Math.random() * 9000 + 1000);
  return `${prefix}${timestamp}${random}`;
};

// ── Zod Schemas ───────────────────────────────────────────────────────────────

const createZoneSchema = z.object({
  name: z.string().min(1, "Name is required"),
  description: z.string().optional(),
  // Each entry is either "State" or "State::LGA"
  states: z.array(z.string()).min(1, "At least one state or LGA is required"),
  isActive: z.boolean().default(true),
  sortOrder: z.number().int().default(0),
});

const updateZoneSchema = createZoneSchema.partial();

const createMethodSchema = z.object({
  zoneId: z.string(),
  name: z.string().min(1, "Name is required"),
  description: z.string().optional(),
  type: z.enum(["TABLE_RATE", "FLAT_RATE", "STORE_PICKUP"]),
  isActive: z.boolean().default(true),
  flatRateCost: z.number().min(0).optional(),
  freeShippingAbove: z.number().min(0).optional(),
  isFreeShipping: z.boolean().default(false),
  allowsCoupons: z.boolean().default(true),
  couponCanMakeFree: z.boolean().default(true),
  applicableToAll: z.boolean().default(true),
  categoryIds: z.array(z.string()).default([]),
  productIds: z.array(z.string()).default([]),
  storeAddress: z
    .object({
      name: z.string(),
      address: z.string(),
      city: z.string(),
      phone: z.string(),
      hours: z.string(),
      coordinates: z.object({ lat: z.number(), lng: z.number() }).optional(),
    })
    .optional(),
  estimatedMinDays: z.number().int().min(0).optional(),
  estimatedMaxDays: z.number().int().min(0).optional(),
  // Weight rates for TABLE_RATE
  weightRates: z
    .array(
      z.object({
        minWeight: z.number().min(0),
        maxWeight: z.number().min(0).nullable(),
        cost: z.number().min(0),
      }),
    )
    .optional(),
});

const updateMethodSchema = createMethodSchema.partial().omit({ zoneId: true });

const calculateShippingSchema = z.object({
  state: z.string().min(1, "State is required"),
  lga: z.string().optional(),
  orderAmount: z.number().min(0),
  weight: z.number().min(0),
  categoryIds: z.array(z.string()).default([]),
  productIds: z.array(z.string()).default([]),
});

const createShipmentSchema = z.object({
  orderId: z.string(),
  carrier: z.string().optional(),
  trackingNumber: z.string().optional(),
  trackingUrl: z.string().url().optional().or(z.literal("")),
  estimatedDelivery: z.string().optional(), // ISO date string
  notes: z.string().optional(),
  weight: z.number().min(0).optional(),
  dimensions: z
    .object({
      length: z.number(),
      width: z.number(),
      height: z.number(),
      unit: z.enum(["cm", "m"]).default("cm"),
    })
    .optional(),
});

const addTrackingEventSchema = z.object({
  orderId: z.string(),
  status: z.string().min(1),
  message: z.string().min(1),
  location: z.string().optional(),
  timestamp: z.string().optional(),
});

// ── Zone matching helper ──────────────────────────────────────────────────────

async function findZoneForAddress(state: string, lga?: string) {
  if (lga) {
    const lgaKey = `${state}::${lga}`;
    const lgaZone = await prisma.shippingZone.findFirst({
      where: { isActive: true, states: { has: lgaKey } },
      include: {
        methods: {
          where: { isActive: true },
          include: { weightRates: { orderBy: { minWeight: "asc" } } },
        },
      },
    });
    if (lgaZone) return lgaZone;
  }

  const stateZone = await prisma.shippingZone.findFirst({
    where: { isActive: true, states: { has: state } },
    include: {
      methods: {
        where: { isActive: true },
        include: { weightRates: { orderBy: { minWeight: "asc" } } },
      },
    },
  });
  return stateZone;
}

// ── ZONES ─────────────────────────────────────────────────────────────────────

export const getShippingZones = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const zones = await prisma.shippingZone.findMany({
      where: { isActive: true },
      include: {
        methods: {
          where: { isActive: true },
          include: { weightRates: { orderBy: { minWeight: "asc" } } },
        },
      },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    });
    res.status(200).json({ success: true, data: { zones } });
  } catch (error) {
    next(error);
  }
};

export const getAllShippingZones = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const zones = await prisma.shippingZone.findMany({
      include: {
        _count: { select: { methods: true } },
        methods: {
          include: { weightRates: { orderBy: { minWeight: "asc" } } },
          orderBy: { name: "asc" },
        },
      },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    });
    res.status(200).json({ success: true, data: { zones } });
  } catch (error) {
    next(error);
  }
};

export const getShippingZone = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const id = req.params.id as string;
    const zone = await prisma.shippingZone.findUnique({
      where: { id },
      include: {
        methods: {
          include: { weightRates: { orderBy: { minWeight: "asc" } } },
          orderBy: { name: "asc" },
        },
      },
    });
    if (!zone) throw new NotFoundError("Shipping zone not found");
    res.status(200).json({ success: true, data: { zone } });
  } catch (error) {
    next(error);
  }
};

export const createShippingZone = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const validated = createZoneSchema.parse(req.body);

    const existing = await prisma.shippingZone.findFirst({
      where: { states: { hasSome: validated.states } },
    });
    if (existing) {
      throw new BadRequestError(
        `Some entries are already assigned to zone "${existing.name}"`,
      );
    }

    const zone = await prisma.shippingZone.create({ data: validated });
    res.status(201).json({
      success: true,
      data: { zone },
      message: "Shipping zone created successfully",
    });
  } catch (error) {
    if (error instanceof z.ZodError)
      return res.status(400).json({
        success: false,
        message: "Validation error",
        errors: error.issues,
      });
    next(error);
  }
};

export const updateShippingZone = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const id = req.params.id as string;
    const validated = updateZoneSchema.parse(req.body);

    const existing = await prisma.shippingZone.findUnique({ where: { id } });
    if (!existing) throw new NotFoundError("Shipping zone not found");

    if (validated.states) {
      const conflict = await prisma.shippingZone.findFirst({
        where: {
          AND: [{ id: { not: id } }, { states: { hasSome: validated.states } }],
        },
      });
      if (conflict)
        throw new BadRequestError(
          `Some entries are already in zone "${conflict.name}"`,
        );
    }

    const zone = await prisma.shippingZone.update({
      where: { id },
      data: validated,
    });
    res.status(200).json({
      success: true,
      data: { zone },
      message: "Zone updated successfully",
    });
  } catch (error) {
    if (error instanceof z.ZodError)
      return res.status(400).json({
        success: false,
        message: "Validation error",
        errors: error.issues,
      });
    next(error);
  }
};

export const deleteShippingZone = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const id = req.params.id as string;
    const zone = await prisma.shippingZone.findUnique({
      where: { id },
      include: { _count: { select: { methods: true } } },
    });
    if (!zone) throw new NotFoundError("Shipping zone not found");
    if (zone._count.methods > 0)
      throw new BadRequestError(
        "Cannot delete zone with shipping methods. Delete methods first.",
      );
    await prisma.shippingZone.delete({ where: { id } });
    res
      .status(200)
      .json({ success: true, message: "Zone deleted successfully" });
  } catch (error) {
    next(error);
  }
};

// ── METHODS ───────────────────────────────────────────────────────────────────

export const createShippingMethod = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const validated = createMethodSchema.parse(req.body);

    const zone = await prisma.shippingZone.findUnique({
      where: { id: validated.zoneId },
    });
    if (!zone) throw new NotFoundError("Shipping zone not found");

    if (
      validated.type === "FLAT_RATE" &&
      validated.flatRateCost === undefined
    ) {
      throw new BadRequestError(
        "Flat rate cost is required for FLAT_RATE type",
      );
    }
    if (
      validated.type === "TABLE_RATE" &&
      (!validated.weightRates || validated.weightRates.length === 0)
    ) {
      throw new BadRequestError(
        "At least one weight rate bracket is required for TABLE_RATE type",
      );
    }
    if (validated.type === "STORE_PICKUP" && !validated.storeAddress) {
      throw new BadRequestError(
        "Store address is required for STORE_PICKUP type",
      );
    }

    // Validate weight brackets don't overlap
    if (validated.weightRates && validated.weightRates.length > 1) {
      const sorted = [...validated.weightRates].sort(
        (a, b) => a.minWeight - b.minWeight,
      );
      for (let i = 0; i < sorted.length - 1; i++) {
        const curr = sorted[i];
        const next = sorted[i + 1];
        if (curr.maxWeight !== null && curr.maxWeight >= next.minWeight) {
          throw new BadRequestError(
            `Weight brackets overlap: ${curr.minWeight}–${curr.maxWeight}kg overlaps ${next.minWeight}kg+`,
          );
        }
      }
    }

    const method = await prisma.shippingMethod.create({
      data: {
        zoneId: validated.zoneId,
        name: validated.name,
        description: validated.description,
        type: validated.type,
        isActive: validated.isActive,
        flatRateCost: validated.flatRateCost,
        freeShippingAbove: validated.freeShippingAbove,
        isFreeShipping: validated.isFreeShipping,
        allowsCoupons: validated.allowsCoupons,
        couponCanMakeFree: validated.couponCanMakeFree,
        applicableToAll: validated.applicableToAll,
        categoryIds: validated.categoryIds,
        productIds: validated.productIds,
        storeAddress: validated.storeAddress as any,
        estimatedMinDays: validated.estimatedMinDays,
        estimatedMaxDays: validated.estimatedMaxDays,
        ...(validated.weightRates?.length && {
          weightRates: { create: validated.weightRates },
        }),
      },
      include: {
        weightRates: { orderBy: { minWeight: "asc" } },
        zone: { select: { id: true, name: true } },
      },
    });

    res.status(201).json({
      success: true,
      data: { method },
      message: "Shipping method created successfully",
    });
  } catch (error) {
    if (error instanceof z.ZodError)
      return res.status(400).json({
        success: false,
        message: "Validation error",
        errors: error.issues,
      });
    next(error);
  }
};

export const getShippingMethod = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const id = req.params.id as string;
    const method = await prisma.shippingMethod.findUnique({
      where: { id },
      include: {
        zone: true,
        weightRates: { orderBy: { minWeight: "asc" } },
      },
    });
    if (!method) throw new NotFoundError("Shipping method not found");
    res.status(200).json({ success: true, data: { method } });
  } catch (error) {
    next(error);
  }
};

export const getAllShippingMethods = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const { zoneId, type, isActive } = req.query;
    const where: any = {};
    if (zoneId) where.zoneId = zoneId as string;
    if (type) where.type = type as string;
    if (isActive !== undefined) where.isActive = isActive === "true";

    const methods = await prisma.shippingMethod.findMany({
      where,
      include: {
        zone: { select: { id: true, name: true, states: true } },
        weightRates: { orderBy: { minWeight: "asc" } },
      },
      orderBy: [{ zone: { name: "asc" } }, { name: "asc" }],
    });
    res.status(200).json({ success: true, data: { methods } });
  } catch (error) {
    next(error);
  }
};

export const updateShippingMethod = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const id = req.params.id as string;
    const validated = updateMethodSchema.parse(req.body);

    const existing = await prisma.shippingMethod.findUnique({
      where: { id },
      include: { weightRates: true },
    });
    if (!existing) throw new NotFoundError("Shipping method not found");

    // Replace weight rates if provided
    if (validated.weightRates) {
      await prisma.shippingWeightRate.deleteMany({ where: { methodId: id } });
    }

    const method = await prisma.shippingMethod.update({
      where: { id },
      data: {
        ...(validated.name !== undefined && { name: validated.name }),
        ...(validated.description !== undefined && {
          description: validated.description,
        }),
        ...(validated.type !== undefined && { type: validated.type }),
        ...(validated.isActive !== undefined && {
          isActive: validated.isActive,
        }),
        ...(validated.flatRateCost !== undefined && {
          flatRateCost: validated.flatRateCost,
        }),
        ...(validated.freeShippingAbove !== undefined && {
          freeShippingAbove: validated.freeShippingAbove,
        }),
        ...(validated.isFreeShipping !== undefined && {
          isFreeShipping: validated.isFreeShipping,
        }),
        ...(validated.allowsCoupons !== undefined && {
          allowsCoupons: validated.allowsCoupons,
        }),
        ...(validated.couponCanMakeFree !== undefined && {
          couponCanMakeFree: validated.couponCanMakeFree,
        }),
        ...(validated.applicableToAll !== undefined && {
          applicableToAll: validated.applicableToAll,
        }),
        ...(validated.categoryIds !== undefined && {
          categoryIds: validated.categoryIds,
        }),
        ...(validated.productIds !== undefined && {
          productIds: validated.productIds,
        }),
        ...(validated.storeAddress !== undefined && {
          storeAddress: validated.storeAddress as any,
        }),
        ...(validated.estimatedMinDays !== undefined && {
          estimatedMinDays: validated.estimatedMinDays,
        }),
        ...(validated.estimatedMaxDays !== undefined && {
          estimatedMaxDays: validated.estimatedMaxDays,
        }),
        ...(validated.weightRates && {
          weightRates: { create: validated.weightRates },
        }),
      },
      include: {
        weightRates: { orderBy: { minWeight: "asc" } },
        zone: { select: { id: true, name: true } },
      },
    });

    res.status(200).json({
      success: true,
      data: { method },
      message: "Method updated successfully",
    });
  } catch (error) {
    if (error instanceof z.ZodError)
      return res.status(400).json({
        success: false,
        message: "Validation error",
        errors: error.issues,
      });
    next(error);
  }
};

export const deleteShippingMethod = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const id = req.params.id as string;
    const method = await prisma.shippingMethod.findUnique({ where: { id } });
    if (!method) throw new NotFoundError("Shipping method not found");
    await prisma.shippingWeightRate.deleteMany({ where: { methodId: id } });
    await prisma.shippingMethod.delete({ where: { id } });
    res
      .status(200)
      .json({ success: true, message: "Method deleted successfully" });
  } catch (error) {
    next(error);
  }
};

// ── CALCULATE SHIPPING (used at checkout) ─────────────────────────────────────

export const calculateShipping = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const validated = calculateShippingSchema.parse(req.body);
    const { state, lga, orderAmount, weight, categoryIds, productIds } =
      validated;

    const zone = await findZoneForAddress(state, lga);

    if (!zone || zone.methods.length === 0) {
      return res.status(200).json({
        success: true,
        data: {
          zone: "Default Zone",
          matchedBy: state,
          methods: [
            {
              id: "default",
              name: "Standard Delivery",
              type: "FLAT_RATE",
              cost: 5000,
              estimatedMinDays: 5,
              estimatedMaxDays: 7,
              isFree: false,
              description: "Default nationwide delivery",
            },
          ],
        },
      });
    }

    // Filter applicable methods
    const applicableMethods = zone.methods.filter((method) => {
      if (method.type === "STORE_PICKUP") return true;
      if (method.applicableToAll) return true;
      if (method.categoryIds.some((id: string) => categoryIds.includes(id)))
        return true;
      if (method.productIds.some((id: string) => productIds.includes(id)))
        return true;
      return false;
    });

    // Calculate cost per method
    const methodsWithCost = applicableMethods.map((method) => {
      let cost = 0;
      let isFree = false;

      if (method.type === "FLAT_RATE") {
        cost = method.flatRateCost || 0;
      } else if (method.type === "TABLE_RATE") {
        // Find the matching weight bracket
        const rates = method.weightRates as any[];
        const rate = rates.find((r) => {
          return (
            weight >= r.minWeight &&
            (r.maxWeight === null || weight <= r.maxWeight)
          );
        });
        // If weight exceeds all brackets, use the last/highest bracket cost
        cost =
          rate?.cost ??
          rates[rates.length - 1]?.cost ??
          method.flatRateCost ??
          0;
      } else if (method.type === "STORE_PICKUP") {
        cost = 0;
        isFree = true;
      }

      // Apply free shipping threshold
      if (
        !isFree &&
        method.freeShippingAbove &&
        orderAmount >= method.freeShippingAbove
      ) {
        isFree = true;
        cost = 0;
      }

      // isFreeShipping flag
      if (method.isFreeShipping) {
        isFree = true;
        cost = 0;
      }

      return {
        id: method.id,
        name: method.name,
        description: method.description,
        type: method.type,
        cost,
        isFree,
        estimatedMinDays: method.estimatedMinDays,
        estimatedMaxDays: method.estimatedMaxDays,
        storeAddress: method.storeAddress,
        freeShippingAbove: method.freeShippingAbove,
        amountNeededForFree:
          method.freeShippingAbove && !isFree && method.type !== "STORE_PICKUP"
            ? Math.max(0, method.freeShippingAbove - orderAmount)
            : null,
      };
    });

    methodsWithCost.sort((a, b) => a.cost - b.cost);

    res.status(200).json({
      success: true,
      data: {
        zone: zone.name,
        matchedBy: lga ? `${state} → ${lga}` : state,
        methods: methodsWithCost,
        orderAmount,
        weight,
      },
    });
  } catch (error) {
    if (error instanceof z.ZodError)
      return res.status(400).json({
        success: false,
        message: "Validation error",
        errors: error.issues,
      });
    next(error);
  }
};

// ── SHIPMENTS ─────────────────────────────────────────────────────────────────
// Create a shipment record from a confirmed order and set tracking info

export const createShipment = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const validated = createShipmentSchema.parse(req.body);

    const order = await prisma.order.findUnique({
      where: { id: validated.orderId },
      include: { items: true },
    });
    if (!order) throw new NotFoundError("Order not found");

    if (
      !["CONFIRMED", "PROCESSING", "READY_FOR_PICKUP"].includes(order.status)
    ) {
      throw new BadRequestError(
        `Order must be CONFIRMED or PROCESSING to create a shipment (current: ${order.status})`,
      );
    }

    const trackingNumber = validated.trackingNumber || generateTrackingNumber();
    const estimatedDelivery = validated.estimatedDelivery
      ? new Date(validated.estimatedDelivery)
      : null;

    // Update order with shipment info and status SHIPPED
    const [updatedOrder] = await prisma.$transaction([
      prisma.order.update({
        where: { id: validated.orderId },
        data: {
          status: "SHIPPED",
          trackingNumber,
          trackingUrl: validated.trackingUrl || null,
          estimatedDelivery,
          shippedAt: new Date(),
          adminNotes: validated.notes
            ? `${order.adminNotes ? order.adminNotes + "\n" : ""}Shipped: ${validated.notes}`
            : order.adminNotes,
        },
        include: {
          items: {
            include: {
              product: { select: { id: true, name: true, images: true } },
            },
          },
          user: { select: { id: true, name: true, email: true } },
        },
      }),
      prisma.orderStatusHistory.create({
        data: {
          orderId: validated.orderId,
          status: "SHIPPED",
          notes: `Shipment created. Tracking: ${trackingNumber}${validated.carrier ? ` via ${validated.carrier}` : ""}`,
        },
      }),
      prisma.orderTrackingUpdate.create({
        data: {
          orderId: validated.orderId,
          status: "Shipment Dispatched",
          message: `Your order has been dispatched${validated.carrier ? ` with ${validated.carrier}` : ""}. Tracking number: ${trackingNumber}`,
          location: "Dispatch Facility, Port Harcourt",
          timestamp: new Date(),
        },
      }),
    ]);

    res.status(201).json({
      success: true,
      data: {
        order: updatedOrder,
        trackingNumber,
        estimatedDelivery,
        carrier: validated.carrier,
        weight: validated.weight,
        dimensions: validated.dimensions,
      },
      message: "Shipment created and order marked as SHIPPED",
    });
  } catch (error) {
    if (error instanceof z.ZodError)
      return res.status(400).json({
        success: false,
        message: "Validation error",
        errors: error.issues,
      });
    next(error);
  }
};

// GET all shipments (orders that have been shipped or are in transit)
export const getShipments = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const {
      page = "1",
      limit = "20",
      status,
      search,
      startDate,
      endDate,
    } = req.query;
    const skip = (Number(page) - 1) * Number(limit);

    const where: any = {
      status: {
        in: status
          ? [status as string]
          : ["SHIPPED", "OUT_FOR_DELIVERY", "DELIVERED"],
      },
    };

    if (search) {
      where.OR = [
        {
          orderNumber: {
            contains: search as string,
            mode: "insensitive",
          },
        },
        {
          trackingNumber: {
            contains: search as string,
            mode: "insensitive",
          },
        },
        {
          customerName: {
            contains: search as string,
            mode: "insensitive",
          },
        },
        {
          customerEmail: {
            contains: search as string,
            mode: "insensitive",
          },
        },
      ];
    }
    if (startDate || endDate) {
      where.shippedAt = {};
      if (startDate) where.shippedAt.gte = new Date(startDate as string);
      if (endDate) where.shippedAt.lte = new Date(endDate as string);
    }

    const [shipments, total] = await Promise.all([
      prisma.order.findMany({
        where,
        skip,
        take: Number(limit),
        orderBy: { shippedAt: "desc" },
        select: {
          id: true,
          orderNumber: true,
          status: true,
          customerName: true,
          customerEmail: true,
          customerPhone: true,
          shippingAddress: true,
          shippingMethodName: true,
          shippingType: true,
          trackingNumber: true,
          trackingUrl: true,
          estimatedDelivery: true,
          shippedAt: true,
          deliveredAt: true,
          total: true,
          shippingCost: true,
          isPickup: true,
          trackingUpdates: {
            orderBy: { timestamp: "desc" },
            take: 1,
          },
          items: {
            select: {
              quantity: true,
              productName: true,
            },
          },
        },
      }),
      prisma.order.count({ where }),
    ]);

    res.status(200).json({
      success: true,
      data: {
        shipments,
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

// GET orders ready for shipment (CONFIRMED or PROCESSING, not pickup)
export const getOrdersReadyForShipment = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const { page = "1", limit = "20", search } = req.query;
    const skip = (Number(page) - 1) * Number(limit);

    const where: any = {
      status: { in: ["CONFIRMED", "PROCESSING"] },
      isPickup: false,
    };

    if (search) {
      where.OR = [
        {
          orderNumber: {
            contains: search as string,
            mode: "insensitive",
          },
        },
        {
          customerName: {
            contains: search as string,
            mode: "insensitive",
          },
        },
      ];
    }

    const [orders, total] = await Promise.all([
      prisma.order.findMany({
        where,
        skip,
        take: Number(limit),
        orderBy: { confirmedAt: "asc" }, // oldest confirmed first
        select: {
          id: true,
          orderNumber: true,
          status: true,
          customerName: true,
          customerPhone: true,
          shippingAddress: true,
          shippingMethodName: true,
          shippingType: true,
          shippingCost: true,
          total: true,
          confirmedAt: true,
          createdAt: true,
          items: {
            select: {
              quantity: true,
              productName: true,
              productSku: true,
              netWeight: true,
            },
          },
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
        },
      },
    });
  } catch (error) {
    next(error);
  }
};

// ── TRACKING ──────────────────────────────────────────────────────────────────

// GET public tracking by tracking number or order number
export const getTrackingByNumber = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const trackingNumber = req.params.trackingNumber as string;

    const order = await prisma.order.findFirst({
      where: {
        OR: [{ trackingNumber }, { orderNumber: trackingNumber }],
      },
      select: {
        id: true,
        orderNumber: true,
        status: true,
        customerName: true,
        shippingAddress: true,
        shippingMethodName: true,
        trackingNumber: true,
        trackingUrl: true,
        estimatedDelivery: true,
        deliveredAt: true,
        shippedAt: true,
        createdAt: true,
        confirmedAt: true,
        isPickup: true,
        pickupCode: true,
        pickupReadyAt: true,
        trackingUpdates: {
          orderBy: { timestamp: "desc" },
        },
      },
    });

    if (!order) {
      throw new NotFoundError(
        "No shipment found for this tracking number or order number",
      );
    }

    res.status(200).json({ success: true, data: { order } });
  } catch (error) {
    next(error);
  }
};

// POST add a tracking update event to an order
export const addTrackingEvent = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const validated = addTrackingEventSchema.parse(req.body);

    const order = await prisma.order.findUnique({
      where: { id: validated.orderId },
    });
    if (!order) throw new NotFoundError("Order not found");

    const trackingUpdate = await prisma.orderTrackingUpdate.create({
      data: {
        orderId: validated.orderId,
        status: validated.status,
        message: validated.message,
        location: validated.location,
        timestamp: validated.timestamp
          ? new Date(validated.timestamp)
          : new Date(),
      },
    });

    // Auto-advance order status based on tracking event
    const statusMap: Record<string, string> = {
      "Out for Delivery": "OUT_FOR_DELIVERY",
      Delivered: "DELIVERED",
      "Delivery Attempted": "OUT_FOR_DELIVERY",
      "Ready for Pickup": "READY_FOR_PICKUP",
    };
    const newStatus = statusMap[validated.status];
    if (newStatus && order.status !== newStatus) {
      await prisma.order.update({
        where: { id: validated.orderId },
        data: {
          status: newStatus as any,
          ...(newStatus === "DELIVERED" && { deliveredAt: new Date() }),
        },
      });
    }

    res.status(201).json({
      success: true,
      data: { trackingUpdate },
      message: "Tracking event added",
    });
  } catch (error) {
    if (error instanceof z.ZodError)
      return res.status(400).json({
        success: false,
        message: "Validation error",
        errors: error.issues,
      });
    next(error);
  }
};

// GET all tracking events for an order
export const getOrderTrackingEvents = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const orderId = req.params.orderId as string;
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      select: {
        id: true,
        orderNumber: true,
        status: true,
        trackingNumber: true,
        trackingUrl: true,
        estimatedDelivery: true,
        deliveredAt: true,
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

// PUT update tracking number and carrier info
export const updateShipmentTracking = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const orderId = req.params.orderId as string;
    const { trackingNumber, trackingUrl, carrier, estimatedDelivery, notes } =
      req.body;

    const order = await prisma.order.findUnique({ where: { id: orderId } });
    if (!order) throw new NotFoundError("Order not found");

    const updateData: any = {};
    if (trackingNumber !== undefined)
      updateData.trackingNumber = trackingNumber;
    if (trackingUrl !== undefined) updateData.trackingUrl = trackingUrl;
    if (estimatedDelivery !== undefined)
      updateData.estimatedDelivery = new Date(estimatedDelivery);

    const updated = await prisma.order.update({
      where: { id: orderId },
      data: updateData,
    });

    // Log tracking update if there's a note
    if (notes || carrier) {
      await prisma.orderTrackingUpdate.create({
        data: {
          orderId,
          status: "Tracking Updated",
          message:
            notes ||
            `Tracking information updated${carrier ? ` (Carrier: ${carrier})` : ""}`,
          timestamp: new Date(),
        },
      });
    }

    res.status(200).json({
      success: true,
      data: { order: updated },
      message: "Tracking information updated",
    });
  } catch (error) {
    next(error);
  }
};

// ── MARK OUT FOR DELIVERY ─────────────────────────────────────────────────────

export const markOutForDelivery = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const orderId = req.params.orderId as string;
    const { location, riderName, riderPhone } = req.body;

    const order = await prisma.order.findUnique({ where: { id: orderId } });
    if (!order) throw new NotFoundError("Order not found");
    if (order.status !== "SHIPPED")
      throw new BadRequestError(
        `Order must be SHIPPED to mark as out for delivery (current: ${order.status})`,
      );

    await prisma.$transaction([
      prisma.order.update({
        where: { id: orderId },
        data: { status: "OUT_FOR_DELIVERY" },
      }),
      prisma.orderStatusHistory.create({
        data: {
          orderId,
          status: "OUT_FOR_DELIVERY",
          notes: `Out for delivery${riderName ? ` with ${riderName}` : ""}`,
        },
      }),
      prisma.orderTrackingUpdate.create({
        data: {
          orderId,
          status: "Out for Delivery",
          message: `Your order is out for delivery${riderName ? ` with ${riderName}` : ""}. Expect delivery today.`,
          location: location || undefined,
          timestamp: new Date(),
        },
      }),
    ]);

    res.status(200).json({
      success: true,
      message: "Order marked as Out for Delivery",
    });
  } catch (error) {
    next(error);
  }
};

// ── MARK DELIVERED ────────────────────────────────────────────────────────────

export const markDelivered = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const orderId = req.params.orderId as string;
    const { location, notes, deliveredTo } = req.body;

    const order = await prisma.order.findUnique({ where: { id: orderId } });
    if (!order) throw new NotFoundError("Order not found");
    if (!["SHIPPED", "OUT_FOR_DELIVERY"].includes(order.status))
      throw new BadRequestError(
        `Order must be SHIPPED or OUT_FOR_DELIVERY to mark as delivered (current: ${order.status})`,
      );

    await prisma.$transaction([
      prisma.order.update({
        where: { id: orderId },
        data: { status: "DELIVERED", deliveredAt: new Date() },
      }),
      prisma.orderStatusHistory.create({
        data: {
          orderId,
          status: "DELIVERED",
          notes: notes || "Order delivered successfully",
        },
      }),
      prisma.orderTrackingUpdate.create({
        data: {
          orderId,
          status: "Delivered",
          message: `Your order has been delivered${deliveredTo ? ` to ${deliveredTo}` : ""}. Thank you for shopping with NigitTriple!`,
          location: location || undefined,
          timestamp: new Date(),
        },
      }),
    ]);

    res.status(200).json({
      success: true,
      message: "Order marked as Delivered",
    });
  } catch (error) {
    next(error);
  }
};

// ── DASHBOARD STATS ───────────────────────────────────────────────────────────

export const getShippingDashboardStats = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const now = new Date();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    const [
      pendingShipment,
      inTransit,
      outForDelivery,
      delivered30d,
      deliveredToday,
      totalShippingRevenue,
      avgDeliveryTime,
      shipmentsByMethod,
      recentShipments,
      zonesCount,
      methodsCount,
    ] = await Promise.all([
      // Orders confirmed/processing, awaiting shipment
      prisma.order.count({
        where: {
          status: { in: ["CONFIRMED", "PROCESSING"] },
          isPickup: false,
        },
      }),
      // Shipped (in transit)
      prisma.order.count({ where: { status: "SHIPPED" } }),
      // Out for delivery
      prisma.order.count({ where: { status: "OUT_FOR_DELIVERY" } }),
      // Delivered in last 30 days
      prisma.order.count({
        where: { status: "DELIVERED", deliveredAt: { gte: thirtyDaysAgo } },
      }),
      // Delivered today
      prisma.order.count({
        where: {
          status: "DELIVERED",
          deliveredAt: {
            gte: new Date(now.getFullYear(), now.getMonth(), now.getDate()),
          },
        },
      }),
      // Total shipping revenue (30d)
      prisma.order.aggregate({
        where: {
          status: { in: ["SHIPPED", "OUT_FOR_DELIVERY", "DELIVERED"] },
          shippedAt: { gte: thirtyDaysAgo },
        },
        _sum: { shippingCost: true },
      }),
      // Average delivery time (days) for delivered orders
      prisma.order.findMany({
        where: {
          status: "DELIVERED",
          deliveredAt: { not: null },
          shippedAt: { not: null, gte: thirtyDaysAgo },
        },
        select: { shippedAt: true, deliveredAt: true },
      }),
      // Shipments by method
      prisma.order.groupBy({
        by: ["shippingMethodName"],
        where: {
          status: { in: ["SHIPPED", "OUT_FOR_DELIVERY", "DELIVERED"] },
          shippedAt: { gte: thirtyDaysAgo },
        },
        _count: { id: true },
        _sum: { shippingCost: true },
      }),
      // Recent shipments
      prisma.order.findMany({
        where: {
          status: { in: ["SHIPPED", "OUT_FOR_DELIVERY", "DELIVERED"] },
          shippedAt: { gte: sevenDaysAgo },
        },
        select: {
          id: true,
          orderNumber: true,
          status: true,
          customerName: true,
          trackingNumber: true,
          estimatedDelivery: true,
          shippedAt: true,
          deliveredAt: true,
          shippingAddress: true,
        },
        orderBy: { shippedAt: "desc" },
        take: 10,
      }),
      prisma.shippingZone.count({ where: { isActive: true } }),
      prisma.shippingMethod.count({ where: { isActive: true } }),
    ]);

    // Calculate average delivery time
    const deliveryTimes = (avgDeliveryTime as any[])
      .filter((o) => o.shippedAt && o.deliveredAt)
      .map((o) => {
        const diff =
          new Date(o.deliveredAt).getTime() - new Date(o.shippedAt).getTime();
        return diff / (1000 * 60 * 60 * 24); // days
      });
    const avgDays =
      deliveryTimes.length > 0
        ? deliveryTimes.reduce((a, b) => a + b, 0) / deliveryTimes.length
        : null;

    res.status(200).json({
      success: true,
      data: {
        overview: {
          pendingShipment,
          inTransit,
          outForDelivery,
          delivered30d,
          deliveredToday,
          totalShippingRevenue: totalShippingRevenue._sum.shippingCost || 0,
          avgDeliveryDays: avgDays ? Math.round(avgDays * 10) / 10 : null,
        },
        configuration: {
          activeZones: zonesCount,
          activeMethods: methodsCount,
        },
        shipmentsByMethod: shipmentsByMethod.map((s) => ({
          method: s.shippingMethodName || "Unknown",
          count: s._count.id,
          revenue: s._sum.shippingCost || 0,
        })),
        recentShipments,
      },
    });
  } catch (error) {
    next(error);
  }
};

// ── SEED DATA ─────────────────────────────────────────────────────────────────
// POST /api/v1/shipping/seed  (Admin only – run once)

export const seedShippingData = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    // Clear existing
    await prisma.shippingWeightRate.deleteMany({});
    await prisma.shippingMethod.deleteMany({});
    await prisma.shippingZone.deleteMany({});

    // ── Nigerian Shipping Zones ───────────────────────────────────────────────
    const zoneDefinitions = [
      {
        name: "Port Harcourt Metro",
        description:
          "Port Harcourt city and immediate environs — fastest delivery",
        states: [
          "Rivers::Port Harcourt",
          "Rivers::Obio/Akpor",
          "Rivers::Eleme",
          "Rivers::Oyigbo",
        ],
        isActive: true,
        sortOrder: 1,
      },
      {
        name: "Rivers State (Other LGAs)",
        description: "All Rivers State LGAs outside Port Harcourt metro",
        states: [
          "Rivers::Ahoada East",
          "Rivers::Ahoada West",
          "Rivers::Akuku-Toru",
          "Rivers::Andoni",
          "Rivers::Asari-Toru",
          "Rivers::Bonny",
          "Rivers::Degema",
          "Rivers::Emohua",
          "Rivers::Etche",
          "Rivers::Gokana",
          "Rivers::Ikwerre",
          "Rivers::Khana",
          "Rivers::Ogba/Egbema/Ndoni",
          "Rivers::Ogu/Bolo",
          "Rivers::Okrika",
          "Rivers::Omuma",
          "Rivers::Opobo/Nkoro",
          "Rivers::Tai",
        ],
        isActive: true,
        sortOrder: 2,
      },
      {
        name: "South-South Zone",
        description: "Delta, Edo, Bayelsa, Cross River, Akwa Ibom",
        states: ["Delta", "Edo", "Bayelsa", "Cross River", "Akwa Ibom"],
        isActive: true,
        sortOrder: 3,
      },
      {
        name: "South-East Zone",
        description: "Anambra, Imo, Enugu, Abia, Ebonyi",
        states: ["Anambra", "Imo", "Enugu", "Abia", "Ebonyi"],
        isActive: true,
        sortOrder: 4,
      },
      {
        name: "Lagos Zone",
        description: "Lagos State — major delivery hub",
        states: ["Lagos"],
        isActive: true,
        sortOrder: 5,
      },
      {
        name: "Abuja (FCT) Zone",
        description: "Federal Capital Territory",
        states: ["FCT"],
        isActive: true,
        sortOrder: 6,
      },
      {
        name: "South-West Zone",
        description: "Ogun, Oyo, Osun, Ondo, Ekiti",
        states: ["Ogun", "Oyo", "Osun", "Ondo", "Ekiti"],
        isActive: true,
        sortOrder: 7,
      },
      {
        name: "North-Central Zone",
        description: "Kwara, Kogi, Benue, Niger, Plateau, Nasarawa",
        states: ["Kwara", "Kogi", "Benue", "Niger", "Plateau", "Nasarawa"],
        isActive: true,
        sortOrder: 8,
      },
      {
        name: "North-West Zone",
        description: "Kaduna, Kano, Katsina, Sokoto, Kebbi, Zamfara, Jigawa",
        states: [
          "Kaduna",
          "Kano",
          "Katsina",
          "Sokoto",
          "Kebbi",
          "Zamfara",
          "Jigawa",
        ],
        isActive: true,
        sortOrder: 9,
      },
      {
        name: "North-East Zone",
        description: "Bauchi, Borno, Adamawa, Taraba, Gombe, Yobe",
        states: ["Bauchi", "Borno", "Adamawa", "Taraba", "Gombe", "Yobe"],
        isActive: true,
        sortOrder: 10,
      },
    ];

    const createdZones = await Promise.all(
      zoneDefinitions.map((z) => prisma.shippingZone.create({ data: z })),
    );

    const zoneMap: Record<string, string> = {};
    createdZones.forEach((z) => {
      zoneMap[z.name] = z.id;
    });

    // ── Shipping Methods per Zone ─────────────────────────────────────────────
    // Weight brackets:  0-1kg | 1-5kg | 5-10kg | 10-20kg | 20kg+

    interface WeightBracket {
      minWeight: number;
      maxWeight: number | null;
      cost: number;
    }

    interface MethodSeed {
      zoneId: string;
      name: string;
      description: string;
      type: "TABLE_RATE" | "FLAT_RATE" | "STORE_PICKUP";
      isActive: boolean;
      freeShippingAbove?: number;
      estimatedMinDays: number;
      estimatedMaxDays: number;
      weightRates?: WeightBracket[];
      flatRateCost?: number;
      storeAddress?: any;
    }

    const methodsToCreate: MethodSeed[] = [
      // ── PH Metro ────────────────────────────────────────────────────────────
      {
        zoneId: zoneMap["Port Harcourt Metro"],
        name: "Standard Delivery (PH Metro)",
        description: "Same or next-day delivery within Port Harcourt",
        type: "TABLE_RATE",
        isActive: true,
        freeShippingAbove: 50000,
        estimatedMinDays: 0,
        estimatedMaxDays: 1,
        weightRates: [
          { minWeight: 0, maxWeight: 1, cost: 800 },
          { minWeight: 1, maxWeight: 5, cost: 1200 },
          { minWeight: 5, maxWeight: 10, cost: 1800 },
          { minWeight: 10, maxWeight: 20, cost: 2500 },
          { minWeight: 20, maxWeight: null, cost: 3500 },
        ],
      },
      {
        zoneId: zoneMap["Port Harcourt Metro"],
        name: "Express Delivery (PH Metro)",
        description: "Priority same-day delivery in PH",
        type: "FLAT_RATE",
        isActive: true,
        flatRateCost: 2500,
        estimatedMinDays: 0,
        estimatedMaxDays: 0,
      },
      {
        zoneId: zoneMap["Port Harcourt Metro"],
        name: "Store Pickup — PH",
        description: "Collect at our Port Harcourt store",
        type: "STORE_PICKUP",
        isActive: true,
        estimatedMinDays: 0,
        estimatedMaxDays: 1,
        storeAddress: {
          name: "NigitTriple Port Harcourt Store",
          address: "5 Rumuola Road, Rumuola",
          city: "Port Harcourt",
          phone: "+234 801 234 5678",
          hours: "Mon–Sat: 8am–7pm, Sun: 10am–4pm",
        },
      },

      // ── Rivers State (Other LGAs) ────────────────────────────────────────────
      {
        zoneId: zoneMap["Rivers State (Other LGAs)"],
        name: "Standard Delivery (Rivers)",
        description: "Delivery to all Rivers State LGAs",
        type: "TABLE_RATE",
        isActive: true,
        freeShippingAbove: 75000,
        estimatedMinDays: 1,
        estimatedMaxDays: 3,
        weightRates: [
          { minWeight: 0, maxWeight: 1, cost: 1500 },
          { minWeight: 1, maxWeight: 5, cost: 2200 },
          { minWeight: 5, maxWeight: 10, cost: 3200 },
          { minWeight: 10, maxWeight: 20, cost: 4500 },
          { minWeight: 20, maxWeight: null, cost: 6000 },
        ],
      },

      // ── South-South ─────────────────────────────────────────────────────────
      {
        zoneId: zoneMap["South-South Zone"],
        name: "Standard Delivery (South-South)",
        description:
          "Delivery across Delta, Edo, Bayelsa, Cross River, Akwa Ibom",
        type: "TABLE_RATE",
        isActive: true,
        freeShippingAbove: 100000,
        estimatedMinDays: 2,
        estimatedMaxDays: 4,
        weightRates: [
          { minWeight: 0, maxWeight: 1, cost: 2000 },
          { minWeight: 1, maxWeight: 5, cost: 3000 },
          { minWeight: 5, maxWeight: 10, cost: 4500 },
          { minWeight: 10, maxWeight: 20, cost: 6500 },
          { minWeight: 20, maxWeight: null, cost: 9000 },
        ],
      },
      {
        zoneId: zoneMap["South-South Zone"],
        name: "Express Delivery (South-South)",
        description: "Faster delivery to major cities",
        type: "FLAT_RATE",
        isActive: true,
        flatRateCost: 6000,
        estimatedMinDays: 1,
        estimatedMaxDays: 2,
      },

      // ── South-East ──────────────────────────────────────────────────────────
      {
        zoneId: zoneMap["South-East Zone"],
        name: "Standard Delivery (South-East)",
        description: "Delivery across Anambra, Imo, Enugu, Abia, Ebonyi",
        type: "TABLE_RATE",
        isActive: true,
        freeShippingAbove: 100000,
        estimatedMinDays: 2,
        estimatedMaxDays: 5,
        weightRates: [
          { minWeight: 0, maxWeight: 1, cost: 2200 },
          { minWeight: 1, maxWeight: 5, cost: 3300 },
          { minWeight: 5, maxWeight: 10, cost: 5000 },
          { minWeight: 10, maxWeight: 20, cost: 7000 },
          { minWeight: 20, maxWeight: null, cost: 9500 },
        ],
      },

      // ── Lagos ────────────────────────────────────────────────────────────────
      {
        zoneId: zoneMap["Lagos Zone"],
        name: "Standard Delivery (Lagos)",
        description: "Delivery across Lagos State",
        type: "TABLE_RATE",
        isActive: true,
        freeShippingAbove: 100000,
        estimatedMinDays: 2,
        estimatedMaxDays: 4,
        weightRates: [
          { minWeight: 0, maxWeight: 1, cost: 2500 },
          { minWeight: 1, maxWeight: 5, cost: 3500 },
          { minWeight: 5, maxWeight: 10, cost: 5000 },
          { minWeight: 10, maxWeight: 20, cost: 7500 },
          { minWeight: 20, maxWeight: null, cost: 10000 },
        ],
      },
      {
        zoneId: zoneMap["Lagos Zone"],
        name: "Express Delivery (Lagos)",
        description: "Priority delivery to Lagos",
        type: "FLAT_RATE",
        isActive: true,
        flatRateCost: 7500,
        estimatedMinDays: 1,
        estimatedMaxDays: 2,
      },

      // ── Abuja ────────────────────────────────────────────────────────────────
      {
        zoneId: zoneMap["Abuja (FCT) Zone"],
        name: "Standard Delivery (Abuja)",
        description: "Delivery across the FCT",
        type: "TABLE_RATE",
        isActive: true,
        freeShippingAbove: 100000,
        estimatedMinDays: 2,
        estimatedMaxDays: 5,
        weightRates: [
          { minWeight: 0, maxWeight: 1, cost: 3000 },
          { minWeight: 1, maxWeight: 5, cost: 4500 },
          { minWeight: 5, maxWeight: 10, cost: 6500 },
          { minWeight: 10, maxWeight: 20, cost: 9000 },
          { minWeight: 20, maxWeight: null, cost: 12000 },
        ],
      },

      // ── South-West ───────────────────────────────────────────────────────────
      {
        zoneId: zoneMap["South-West Zone"],
        name: "Standard Delivery (South-West)",
        description: "Delivery to Ogun, Oyo, Osun, Ondo, Ekiti",
        type: "TABLE_RATE",
        isActive: true,
        freeShippingAbove: 120000,
        estimatedMinDays: 3,
        estimatedMaxDays: 6,
        weightRates: [
          { minWeight: 0, maxWeight: 1, cost: 3000 },
          { minWeight: 1, maxWeight: 5, cost: 4500 },
          { minWeight: 5, maxWeight: 10, cost: 6500 },
          { minWeight: 10, maxWeight: 20, cost: 9500 },
          { minWeight: 20, maxWeight: null, cost: 13000 },
        ],
      },

      // ── North-Central ────────────────────────────────────────────────────────
      {
        zoneId: zoneMap["North-Central Zone"],
        name: "Standard Delivery (North-Central)",
        description: "Delivery to Kwara, Kogi, Benue, Niger, Plateau, Nasarawa",
        type: "TABLE_RATE",
        isActive: true,
        estimatedMinDays: 4,
        estimatedMaxDays: 7,
        weightRates: [
          { minWeight: 0, maxWeight: 1, cost: 3500 },
          { minWeight: 1, maxWeight: 5, cost: 5000 },
          { minWeight: 5, maxWeight: 10, cost: 7500 },
          { minWeight: 10, maxWeight: 20, cost: 11000 },
          { minWeight: 20, maxWeight: null, cost: 15000 },
        ],
      },

      // ── North-West ───────────────────────────────────────────────────────────
      {
        zoneId: zoneMap["North-West Zone"],
        name: "Standard Delivery (North-West)",
        description:
          "Delivery to Kaduna, Kano, Katsina, Sokoto, Kebbi, Zamfara, Jigawa",
        type: "TABLE_RATE",
        isActive: true,
        estimatedMinDays: 5,
        estimatedMaxDays: 9,
        weightRates: [
          { minWeight: 0, maxWeight: 1, cost: 4000 },
          { minWeight: 1, maxWeight: 5, cost: 6000 },
          { minWeight: 5, maxWeight: 10, cost: 9000 },
          { minWeight: 10, maxWeight: 20, cost: 13000 },
          { minWeight: 20, maxWeight: null, cost: 18000 },
        ],
      },

      // ── North-East ───────────────────────────────────────────────────────────
      {
        zoneId: zoneMap["North-East Zone"],
        name: "Standard Delivery (North-East)",
        description: "Delivery to Bauchi, Borno, Adamawa, Taraba, Gombe, Yobe",
        type: "TABLE_RATE",
        isActive: true,
        estimatedMinDays: 6,
        estimatedMaxDays: 10,
        weightRates: [
          { minWeight: 0, maxWeight: 1, cost: 4500 },
          { minWeight: 1, maxWeight: 5, cost: 7000 },
          { minWeight: 5, maxWeight: 10, cost: 10000 },
          { minWeight: 10, maxWeight: 20, cost: 15000 },
          { minWeight: 20, maxWeight: null, cost: 20000 },
        ],
      },
    ];

    for (const method of methodsToCreate) {
      if (!method.zoneId) continue; // skip if zone wasn't created
      const { weightRates, ...methodData } = method;
      await prisma.shippingMethod.create({
        data: {
          ...methodData,
          ...(weightRates && { weightRates: { create: weightRates } }),
        },
      });
    }

    const zoneCount = await prisma.shippingZone.count();
    const methodCount = await prisma.shippingMethod.count();
    const rateCount = await prisma.shippingWeightRate.count();

    res.status(200).json({
      success: true,
      message: "Shipping data seeded successfully",
      data: {
        zones: zoneCount,
        methods: methodCount,
        weightRates: rateCount,
      },
    });
  } catch (error) {
    next(error);
  }
};
