import { Request, Response, NextFunction } from "express";
import prisma from "../config/database";
import { AppError, NotFoundError } from "../utils/appError";
import { AuthRequest } from "../middlewares/auth.middleware";
import { deleteCloudinaryImage } from "../lib/cloudinary";
// GET /api/v1/categories
export const getCategories = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const {
      includeChildren = "true",
      parentOnly = "false",
      isActive,
      random = "false", // ✅ NEW: Add random parameter
    } = req.query;

    const where: any = {};
    if (parentOnly === "true") where.parentId = null;
    if (isActive !== undefined) where.isActive = isActive === "true";

    let categories = await prisma.category.findMany({
      where,
      orderBy: [{ order: "asc" }, { name: "asc" }],
      include: {
        ...(includeChildren === "true" && {
          children: {
            where: { isActive: true },
            orderBy: { order: "asc" },
            include: { _count: { select: { products: true } } },
          },
        }),
        _count: { select: { products: true } },
      },
    });

    // ✅ Shuffle categories if random=true
    if (random === "true") {
      const shuffled = [...categories];
      for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
      }
      categories = shuffled;
    }

    res.status(200).json({ success: true, data: { categories } });
  } catch (error) {
    next(error);
  }
};

// GET /api/v1/categories/:id
export const getCategory = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const id = req.params.id as string; // ✅ fix: assert as string

    const category = await prisma.category.findFirst({
      where: { OR: [{ id }, { slug: id }] },
      include: {
        parent: { select: { id: true, name: true, slug: true } },
        children: { where: { isActive: true }, orderBy: { order: "asc" } },
        _count: { select: { products: true } },
      },
    });

    if (!category) throw new NotFoundError("Category not found");

    res.status(200).json({ success: true, data: { category } });
  } catch (error) {
    next(error);
  }
};

// POST /api/v1/categories
export const createCategory = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const {
      name,
      slug,
      description,
      image,
      svgIcon,
      parentId,
      order,
      isActive,
    } = req.body;

    const existing = await prisma.category.findUnique({ where: { slug } });
    if (existing)
      throw new AppError("Category with this slug already exists", 409);

    if (parentId) {
      const parent = await prisma.category.findUnique({
        where: { id: parentId },
      });
      if (!parent) throw new NotFoundError("Parent category not found");
    }

    const category = await prisma.category.create({
      data: {
        name,
        slug,
        description,
        image,
        svgIcon,
        parentId,
        order: order ?? 0,
        isActive: isActive ?? true,
      },
      include: { parent: { select: { id: true, name: true, slug: true } } },
    });

    res.status(201).json({
      success: true,
      message: "Category created successfully",
      data: { category },
    });
  } catch (error) {
    next(error);
  }
};

// PUT /api/v1/categories/:id
export const updateCategory = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const id = req.params.id as string; // ✅ fix: assert as string
    const { slug, parentId, ...rest } = req.body;

    const category = await prisma.category.findUnique({ where: { id } });
    if (!category) throw new NotFoundError("Category not found");

    if (slug && slug !== category.slug) {
      const existing = await prisma.category.findFirst({
        where: { slug, NOT: { id } },
      }); // ✅ id now string
      if (existing) throw new AppError("Slug already in use", 409);
    }

    // Prevent setting itself as parent
    if (parentId && parentId === id)
      throw new AppError("Category cannot be its own parent", 400);

    // If a new image is supplied, delete the old one from Cloudinary
    if (rest.image && rest.image !== category.image && category.image) {
      await deleteCloudinaryImage(category.image);
    }
    // If a new svgIcon is supplied, delete the old one from Cloudinary
    if (rest.svgIcon && rest.svgIcon !== category.svgIcon && category.svgIcon) {
      await deleteCloudinaryImage(category.svgIcon);
    }

    const updated = await prisma.category.update({
      where: { id },
      data: {
        ...rest,
        ...(slug && { slug }),
        ...(parentId !== undefined && { parentId }),
      },
      include: {
        parent: { select: { id: true, name: true, slug: true } },
        children: true,
        _count: { select: { products: true } },
      },
    });

    res.status(200).json({
      success: true,
      message: "Category updated successfully",
      data: { category: updated },
    });
  } catch (error) {
    next(error);
  }
};

// DELETE /api/v1/categories/:id
export const deleteCategory = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const id = req.params.id as string; // ✅ fix: assert as string

    const category = await prisma.category.findUnique({
      where: { id },
      include: { _count: { select: { products: true, children: true } } }, // ✅ _count now resolves correctly
    });
    if (!category) throw new NotFoundError("Category not found");

    if (category._count.products > 0)
      throw new AppError(
        "Cannot delete category with products. Reassign products first.",
        400,
      );
    if (category._count.children > 0)
      throw new AppError(
        "Cannot delete category with subcategories. Delete subcategories first.",
        400,
      );

    await prisma.category.delete({ where: { id } });

    // Clean up image + svgIcon from Cloudinary after DB record is gone
    if (category.image) {
      await deleteCloudinaryImage(category.image);
    }
    if (category.svgIcon) {
      await deleteCloudinaryImage(category.svgIcon);
    }

    res
      .status(200)
      .json({ success: true, message: "Category deleted successfully" });
  } catch (error) {
    next(error);
  }
};
