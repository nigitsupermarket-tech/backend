import { Request, Response, NextFunction } from "express";
import prisma from "../config/database";
import { AppError, NotFoundError } from "../utils/appError";
import { AuthRequest } from "../middlewares/auth.middleware";
import { deleteCloudinaryImage } from "../lib/cloudinary";
// GET /api/v1/brands
export const getBrands = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const { isActive } = req.query;
    const where: any = {};
    if (isActive !== undefined) where.isActive = isActive === "true";

    const brands = await prisma.brand.findMany({
      where,
      orderBy: { name: "asc" },
      include: { _count: { select: { products: true } } },
    });

    res.status(200).json({ success: true, data: { brands } });
  } catch (error) {
    next(error);
  }
};

// GET /api/v1/brands/:id
export const getBrand = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const id = req.params.id as string; // ✅ fix: assert as string

    const brand = await prisma.brand.findFirst({
      where: { OR: [{ id }, { slug: id }] },
      include: { _count: { select: { products: true } } },
    });

    if (!brand) throw new NotFoundError("Brand not found");

    res.status(200).json({ success: true, data: { brand } });
  } catch (error) {
    next(error);
  }
};

// POST /api/v1/brands
export const createBrand = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const { name, slug, description, logo, isActive } = req.body;

    const existing = await prisma.brand.findFirst({
      where: { OR: [{ name }, { slug }] },
    });
    if (existing)
      throw new AppError("Brand with this name or slug already exists", 409);

    const brand = await prisma.brand.create({
      data: { name, slug, description, logo, isActive: isActive ?? true },
    });

    res
      .status(201)
      .json({
        success: true,
        message: "Brand created successfully",
        data: { brand },
      });
  } catch (error) {
    next(error);
  }
};

// PUT /api/v1/brands/:id
export const updateBrand = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const id = req.params.id as string; // ✅ fix: assert as string
    const { slug, name, ...rest } = req.body;

    const brand = await prisma.brand.findUnique({ where: { id } });
    if (!brand) throw new NotFoundError("Brand not found");

    if (name && name !== brand.name) {
      const existing = await prisma.brand.findFirst({
        where: { name, NOT: { id } },
      });
      if (existing) throw new AppError("Brand name already in use", 409);
    }

    if (slug && slug !== brand.slug) {
      const existing = await prisma.brand.findFirst({
        where: { slug, NOT: { id } },
      });
      if (existing) throw new AppError("Slug already in use", 409);
    }

    // If a new logo URL is supplied, delete the old one from Cloudinary
    if (rest.logo && rest.logo !== brand.logo && brand.logo) {
      await deleteCloudinaryImage(brand.logo);
    }

    const updated = await prisma.brand.update({
      where: { id },
      data: { ...rest, ...(name && { name }), ...(slug && { slug }) },
    });

    res
      .status(200)
      .json({
        success: true,
        message: "Brand updated successfully",
        data: { brand: updated },
      });
  } catch (error) {
    next(error);
  }
};

// DELETE /api/v1/brands/:id
export const deleteBrand = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const id = req.params.id as string; // ✅ fix: assert as string

    const brand = await prisma.brand.findUnique({
      where: { id },
      include: { _count: { select: { products: true } } },
    });
    if (!brand) throw new NotFoundError("Brand not found");

    // ✅ fix: brand is now properly typed with _count included
    if (brand._count.products > 0)
      throw new AppError(
        "Cannot delete brand with products. Reassign products first.",
        400,
      );

    await prisma.brand.delete({ where: { id } });

    // Clean up logo from Cloudinary after DB record is gone
    if (brand.logo) {
      await deleteCloudinaryImage(brand.logo);
    }

    res
      .status(200)
      .json({ success: true, message: "Brand deleted successfully" });
  } catch (error) {
    next(error);
  }
};
