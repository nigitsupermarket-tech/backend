//backend/src/controllers/address.controller.ts
import { Response, NextFunction } from "express";
import prisma from "../config/database";
import { AppError, NotFoundError } from "../utils/appError";
import { AuthRequest } from "../middlewares/auth.middleware";

// GET /api/v1/addresses
export const getAddresses = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    if (!req.user) throw new AppError("Authentication required", 401);

    const addresses = await prisma.address.findMany({
      where: { userId: req.user.userId },
      orderBy: [{ isDefault: "desc" }, { createdAt: "desc" }],
    });

    res.status(200).json({ success: true, data: { addresses } });
  } catch (error) {
    next(error);
  }
};

// GET /api/v1/addresses/:id
export const getAddress = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    if (!req.user) throw new AppError("Authentication required", 401);
    const id = req.params.id as string;

    const address = await prisma.address.findFirst({
      where: { id, userId: req.user.userId },
    });

    if (!address) throw new NotFoundError("Address not found");

    res.status(200).json({ success: true, data: { address } });
  } catch (error) {
    next(error);
  }
};

// POST /api/v1/addresses
export const createAddress = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    if (!req.user) throw new AppError("Authentication required", 401);

    const {
      label,
      firstName,
      lastName,
      phone,
      address,
      addressLine2,
      city,
      state,
      country,
      postalCode,
      isDefault,
    } = req.body;

    // If this is default, unset other defaults
    if (isDefault) {
      await prisma.address.updateMany({
        where: { userId: req.user.userId, isDefault: true },
        data: { isDefault: false },
      });
    }

    const newAddress = await prisma.address.create({
      data: {
        userId: req.user.userId,
        label,
        firstName,
        lastName,
        phone,
        address,
        addressLine2,
        city,
        state,
        country: country || "Nigeria",
        postalCode,
        isDefault: isDefault ?? false,
      },
    });

    res.status(201).json({
      success: true,
      message: "Address created successfully",
      data: { address: newAddress },
    });
  } catch (error) {
    next(error);
  }
};

// PUT /api/v1/addresses/:id
export const updateAddress = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    if (!req.user) throw new AppError("Authentication required", 401);
    const id = req.params.id as string;

    const address = await prisma.address.findFirst({
      where: { id, userId: req.user.userId },
    });
    if (!address) throw new NotFoundError("Address not found");

    const { isDefault, ...updateData } = req.body;

    // If setting as default, unset other defaults
    if (isDefault && !address.isDefault) {
      await prisma.address.updateMany({
        where: { userId: req.user.userId, isDefault: true },
        data: { isDefault: false },
      });
    }

    const updated = await prisma.address.update({
      where: { id },
      data: { ...updateData, isDefault },
    });

    res.status(200).json({
      success: true,
      message: "Address updated successfully",
      data: { address: updated },
    });
  } catch (error) {
    next(error);
  }
};

// DELETE /api/v1/addresses/:id
export const deleteAddress = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    if (!req.user) throw new AppError("Authentication required", 401);
    const id = req.params.id as string;

    const address = await prisma.address.findFirst({
      where: { id, userId: req.user.userId },
    });
    if (!address) throw new NotFoundError("Address not found");

    await prisma.address.delete({ where: { id } });

    // If this was default, set another as default
    if (address.isDefault) {
      const nextAddress = await prisma.address.findFirst({
        where: { userId: req.user.userId },
        orderBy: { createdAt: "asc" },
      });

      if (nextAddress) {
        await prisma.address.update({
          where: { id: nextAddress.id },
          data: { isDefault: true },
        });
      }
    }

    res
      .status(200)
      .json({ success: true, message: "Address deleted successfully" });
  } catch (error) {
    next(error);
  }
};

// PUT /api/v1/addresses/:id/set-default
export const setDefaultAddress = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    if (!req.user) throw new AppError("Authentication required", 401);
    const id = req.params.id as string;

    const address = await prisma.address.findFirst({
      where: { id, userId: req.user.userId },
    });
    if (!address) throw new NotFoundError("Address not found");

    // Unset all defaults
    await prisma.address.updateMany({
      where: { userId: req.user.userId, isDefault: true },
      data: { isDefault: false },
    });

    // Set this one as default
    const updated = await prisma.address.update({
      where: { id },
      data: { isDefault: true },
    });

    res.status(200).json({
      success: true,
      message: "Default address updated",
      data: { address: updated },
    });
  } catch (error) {
    next(error);
  }
};
