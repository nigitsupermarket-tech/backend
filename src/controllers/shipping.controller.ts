// backend/src/controllers/shipping.controller.ts
import { Request, Response, NextFunction } from "express";
import prisma from "../config/database";
import { BadRequestError, NotFoundError } from "../utils/appError";
import { AuthRequest } from "../middlewares/auth.middleware";
import { z } from "zod";

// ── Schemas ──────────────────────────────────────────────────────────────────

// A zone can now cover states AND specific LGAs.
// Format stored in the `states` String[] field:
//   - "Rivers State"          → entire state
//   - "Rivers State::Port Harcourt" → specific LGA within that state
//
// This allows fine-grained pricing (e.g. PH metro cheaper than rural Rivers).
const createZoneSchema = z.object({
  name: z.string().min(1, "Name is required"),
  description: z.string().optional(),
  // Each entry is either "State" or "State::LGA"
  states: z.array(z.string()).min(1, "At least one state or LGA is required"),
  isActive: z.boolean().default(true),
});

const updateZoneSchema = createZoneSchema.partial().omit({});

const createMethodSchema = z.object({
  zoneId: z.string(),
  name: z.string().min(1, "Name is required"),
  type: z.enum(["TABLE_RATE", "FLAT_RATE", "STORE_PICKUP"]),
  isActive: z.boolean().default(true),
  flatRateCost: z.number().min(0).optional(),
  applicableToAll: z.boolean().default(true),
  categoryIds: z.array(z.string()).default([]),
  productIds: z.array(z.string()).default([]),
  storeAddress: z.object({
    name: z.string(),
    address: z.string(),
    city: z.string(),
    phone: z.string(),
    hours: z.string(),
  }).optional(),
  estimatedMinDays: z.number().int().min(0).optional(),
  estimatedMaxDays: z.number().int().min(0).optional(),
  weightRates: z.array(z.object({
    minWeight: z.number().min(0),
    maxWeight: z.number().min(0).nullable(),
    cost: z.number().min(0),
  })).optional(),
});

const updateMethodSchema = createMethodSchema.partial().omit({ zoneId: true });

// Updated: accepts state + optional lga for precise matching
const calculateShippingSchema = z.object({
  state: z.string().min(1, "State is required"),
  lga: z.string().optional(),         // ← NEW: customer's selected LGA
  orderAmount: z.number().min(0),
  weight: z.number().min(0),
  categoryIds: z.array(z.string()).default([]),
  productIds: z.array(z.string()).default([]),
});

// ── Zone matching helper ──────────────────────────────────────────────────────
//
// Matching priority (most specific wins):
//   1. Exact LGA match   "Rivers State::Port Harcourt"
//   2. State-wide match  "Rivers State"
//
// Returns the most specific zone for the customer's address.
async function findZoneForAddress(state: string, lga?: string) {
  // Try LGA-specific zone first
  if (lga) {
    const lgaKey = `${state}::${lga}`;
    const lgaZone = await prisma.shippingZone.findFirst({
      where: { isActive: true, states: { has: lgaKey } },
      include: { methods: { where: { isActive: true }, include: { weightRates: { orderBy: { minWeight: "asc" } } } } },
    });
    if (lgaZone) return lgaZone;
  }

  // Fall back to state-wide zone
  const stateZone = await prisma.shippingZone.findFirst({
    where: { isActive: true, states: { has: state } },
    include: { methods: { where: { isActive: true }, include: { weightRates: { orderBy: { minWeight: "asc" } } } } },
  });
  return stateZone;
}

// ── ZONES ─────────────────────────────────────────────────────────────────────

export const getShippingZones = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const zones = await prisma.shippingZone.findMany({
      where: { isActive: true },
      include: {
        methods: { where: { isActive: true }, include: { weightRates: { orderBy: { minWeight: "asc" } } } },
      },
      orderBy: { name: "asc" },
    });
    res.status(200).json({ success: true, data: { zones } });
  } catch (error) { next(error); }
};

export const getAllShippingZones = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const zones = await prisma.shippingZone.findMany({
      include: { _count: { select: { methods: true } } },
      orderBy: { name: "asc" },
    });
    res.status(200).json({ success: true, data: { zones } });
  } catch (error) { next(error); }
};

export const getShippingZone = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const id = req.params.id as string;
    const zone = await prisma.shippingZone.findUnique({
      where: { id },
      include: { methods: { include: { weightRates: { orderBy: { minWeight: "asc" } } }, orderBy: { name: "asc" } } },
    });
    if (!zone) throw new NotFoundError("Shipping zone not found");
    res.status(200).json({ success: true, data: { zone } });
  } catch (error) { next(error); }
};

export const createShippingZone = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const validated = createZoneSchema.parse(req.body);

    // Check for overlap — each entry (state or state::lga) must be unique across zones
    const existing = await prisma.shippingZone.findFirst({
      where: { states: { hasSome: validated.states } },
    });
    if (existing) {
      throw new BadRequestError(`Some entries are already in zone "${existing.name}"`);
    }

    const zone = await prisma.shippingZone.create({ data: validated });
    res.status(201).json({ success: true, data: { zone }, message: "Shipping zone created successfully" });
  } catch (error) {
    if (error instanceof z.ZodError) return res.status(400).json({ success: false, message: "Validation error", errors: error.issues });
    next(error);
  }
};

export const updateShippingZone = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const id = req.params.id as string;
    const validated = updateZoneSchema.parse(req.body);

    const existing = await prisma.shippingZone.findUnique({ where: { id } });
    if (!existing) throw new NotFoundError("Shipping zone not found");

    if (validated.states) {
      const conflict = await prisma.shippingZone.findFirst({
        where: { AND: [{ id: { not: id } }, { states: { hasSome: validated.states } }] },
      });
      if (conflict) throw new BadRequestError(`Some entries are already in zone "${conflict.name}"`);
    }

    const zone = await prisma.shippingZone.update({ where: { id }, data: validated });
    res.status(200).json({ success: true, data: { zone }, message: "Zone updated successfully" });
  } catch (error) {
    if (error instanceof z.ZodError) return res.status(400).json({ success: false, message: "Validation error", errors: error.issues });
    next(error);
  }
};

export const deleteShippingZone = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const id = req.params.id as string;
    const zone = await prisma.shippingZone.findUnique({ where: { id }, include: { _count: { select: { methods: true } } } });
    if (!zone) throw new NotFoundError("Shipping zone not found");
    if (zone._count.methods > 0) throw new BadRequestError("Cannot delete zone with shipping methods. Delete methods first.");
    await prisma.shippingZone.delete({ where: { id } });
    res.status(200).json({ success: true, message: "Zone deleted successfully" });
  } catch (error) { next(error); }
};

// ── METHODS ───────────────────────────────────────────────────────────────────

export const createShippingMethod = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const validated = createMethodSchema.parse(req.body);

    const zone = await prisma.shippingZone.findUnique({ where: { id: validated.zoneId } });
    if (!zone) throw new NotFoundError("Shipping zone not found");

    if (validated.type === "FLAT_RATE" && validated.flatRateCost === undefined) {
      throw new BadRequestError("Flat rate cost is required for FLAT_RATE type");
    }
    if (validated.type === "TABLE_RATE" && (!validated.weightRates || validated.weightRates.length === 0)) {
      throw new BadRequestError("Weight rates are required for TABLE_RATE type");
    }
    if (validated.type === "STORE_PICKUP" && !validated.storeAddress) {
      throw new BadRequestError("Store address is required for STORE_PICKUP type");
    }

    const method = await prisma.shippingMethod.create({
      data: {
        zoneId: validated.zoneId,
        name: validated.name,
        type: validated.type,
        isActive: validated.isActive,
        flatRateCost: validated.flatRateCost,
        applicableToAll: validated.applicableToAll,
        categoryIds: validated.categoryIds,
        productIds: validated.productIds,
        storeAddress: validated.storeAddress as any,
        estimatedMinDays: validated.estimatedMinDays,
        estimatedMaxDays: validated.estimatedMaxDays,
        ...(validated.weightRates?.length && { weightRates: { create: validated.weightRates } }),
      },
      include: { weightRates: true },
    });

    res.status(201).json({ success: true, data: { method }, message: "Shipping method created successfully" });
  } catch (error) {
    if (error instanceof z.ZodError) return res.status(400).json({ success: false, message: "Validation error", errors: error.issues });
    next(error);
  }
};

export const getShippingMethod = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const id = req.params.id as string;
    const method = await prisma.shippingMethod.findUnique({
      where: { id },
      include: { zone: true, weightRates: { orderBy: { minWeight: "asc" } } },
    });
    if (!method) throw new NotFoundError("Shipping method not found");
    res.status(200).json({ success: true, data: { method } });
  } catch (error) { next(error); }
};

export const getAllShippingMethods = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const methods = await prisma.shippingMethod.findMany({
      include: { zone: { select: { id: true, name: true, states: true } }, weightRates: { orderBy: { minWeight: "asc" } } },
      orderBy: [{ zone: { name: "asc" } }, { name: "asc" }],
    });
    res.status(200).json({ success: true, data: { methods } });
  } catch (error) { next(error); }
};

export const updateShippingMethod = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const id = req.params.id as string;
    const validated = updateMethodSchema.parse(req.body);

    const existing = await prisma.shippingMethod.findUnique({ where: { id }, include: { weightRates: true } });
    if (!existing) throw new NotFoundError("Shipping method not found");

    if (validated.weightRates) {
      await prisma.shippingWeightRate.deleteMany({ where: { methodId: id } });
    }

    const method = await prisma.shippingMethod.update({
      where: { id },
      data: {
        ...(validated.name && { name: validated.name }),
        ...(validated.type && { type: validated.type }),
        ...(validated.isActive !== undefined && { isActive: validated.isActive }),
        ...(validated.flatRateCost !== undefined && { flatRateCost: validated.flatRateCost }),
        ...(validated.applicableToAll !== undefined && { applicableToAll: validated.applicableToAll }),
        ...(validated.categoryIds && { categoryIds: validated.categoryIds }),
        ...(validated.productIds && { productIds: validated.productIds }),
        ...(validated.storeAddress && { storeAddress: validated.storeAddress as any }),
        ...(validated.estimatedMinDays !== undefined && { estimatedMinDays: validated.estimatedMinDays }),
        ...(validated.estimatedMaxDays !== undefined && { estimatedMaxDays: validated.estimatedMaxDays }),
        ...(validated.weightRates && { weightRates: { create: validated.weightRates } }),
      },
      include: { weightRates: true },
    });

    res.status(200).json({ success: true, data: { method }, message: "Method updated successfully" });
  } catch (error) {
    if (error instanceof z.ZodError) return res.status(400).json({ success: false, message: "Validation error", errors: error.issues });
    next(error);
  }
};

export const deleteShippingMethod = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const id = req.params.id as string;
    const method = await prisma.shippingMethod.findUnique({ where: { id } });
    if (!method) throw new NotFoundError("Shipping method not found");
    await prisma.shippingWeightRate.deleteMany({ where: { methodId: id } });
    await prisma.shippingMethod.delete({ where: { id } });
    res.status(200).json({ success: true, message: "Method deleted successfully" });
  } catch (error) { next(error); }
};

// ── CALCULATE (used at checkout) ──────────────────────────────────────────────

export const calculateShipping = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const validated = calculateShippingSchema.parse(req.body);
    const { state, lga, orderAmount, weight, categoryIds, productIds } = validated;

    // Find best-matching zone (LGA-specific > state-wide)
    const zone = await findZoneForAddress(state, lga);

    if (!zone || zone.methods.length === 0) {
      return res.status(200).json({
        success: true,
        data: {
          zone: "Default Zone",
          methods: [{
            id: "default",
            name: "Standard Shipping",
            type: "FLAT_RATE",
            cost: 5000,
            estimatedMinDays: 5,
            estimatedMaxDays: 7,
          }],
        },
      });
    }

    // Filter applicable methods
    const applicableMethods = zone.methods.filter((method) => {
      if (method.type === "STORE_PICKUP") return true;
      if (method.applicableToAll) return true;
      if (method.categoryIds.some((id: string) => categoryIds.includes(id))) return true;
      if (method.productIds.some((id: string) => productIds.includes(id))) return true;
      return false;
    });

    // Calculate cost per method
    const methodsWithCost = applicableMethods.map((method) => {
      let cost = 0;

      if (method.type === "FLAT_RATE") {
        cost = method.flatRateCost || 0;
      } else if (method.type === "TABLE_RATE") {
        const rate = method.weightRates.find((r: any) => {
          return weight >= r.minWeight && (r.maxWeight === null || weight <= r.maxWeight);
        });
        cost = rate?.cost ?? method.weightRates[method.weightRates.length - 1]?.cost ?? 0;
      } else if (method.type === "STORE_PICKUP") {
        cost = 0;
      }

      return {
        id: method.id,
        name: method.name,
        type: method.type,
        cost,
        estimatedMinDays: method.estimatedMinDays,
        estimatedMaxDays: method.estimatedMaxDays,
        storeAddress: method.storeAddress,
      };
    });

    methodsWithCost.sort((a, b) => a.cost - b.cost);

    res.status(200).json({
      success: true,
      data: {
        zone: zone.name,
        matchedBy: lga ? `${state} → ${lga}` : state,
        methods: methodsWithCost,
      },
    });
  } catch (error) {
    if (error instanceof z.ZodError) return res.status(400).json({ success: false, message: "Validation error", errors: error.issues });
    next(error);
  }
};
