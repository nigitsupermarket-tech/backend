import { Request, Response, NextFunction } from "express";
import prisma from "../config/database";
import { AppError, NotFoundError } from "../utils/appError";
import { AuthRequest } from "../middlewares/auth.middleware";
import { log as logActivity } from "../utils/activityLogger";
import {
  deleteCloudinaryImages,
  deleteCloudinaryImage,
} from "../lib/cloudinary";

// ── Product variation helpers ──────────────────────────────────────────────
// Shared by createProduct/updateProduct to turn raw request-body variation
// objects into safe Prisma input, and to make sure a barcode always
// resolves to exactly one scannable thing (a product OR one variation).

interface VariationInput {
  id?: string;
  label: string;
  quantity: number;
  price: number;
  compareAtPrice?: number | null;
  barcode?: string | null;
  sku?: string | null;
  stockQuantity?: number | null; // null/undefined = shared stock mode
  isDefault?: boolean;
  isActive?: boolean;
  sortOrder?: number;
}

function toVariationCreateInput(v: VariationInput) {
  if (!v.label || !v.label.trim()) {
    throw new AppError("Every variation needs a label", 400);
  }
  if (!(v.quantity > 0)) {
    throw new AppError(`Variation "${v.label}" needs a quantity > 0`, 400);
  }
  if (!(v.price >= 0)) {
    throw new AppError(`Variation "${v.label}" needs a valid price`, 400);
  }
  return {
    label: v.label.trim(),
    quantity: Number(v.quantity),
    price: Number(v.price),
    compareAtPrice:
      v.compareAtPrice !== undefined && v.compareAtPrice !== null
        ? Number(v.compareAtPrice)
        : null,
    barcode: v.barcode?.trim() || null,
    sku: v.sku?.trim() || null,
    stockQuantity:
      v.stockQuantity !== undefined && v.stockQuantity !== null
        ? Number(v.stockQuantity)
        : null,
    isDefault: v.isDefault ?? false,
    isActive: v.isActive ?? true,
    sortOrder: v.sortOrder ?? 0,
  };
}

/**
 * Ensures none of the incoming variation barcodes collide with:
 *  - another product's own barcode,
 *  - another product's variation barcode,
 *  - a duplicate within this same payload.
 * `excludeProductId` lets updateProduct ignore the product's own existing
 * records when re-validating on save.
 */
async function assertVariationBarcodesAvailable(
  incoming: VariationInput[],
  excludeProductId?: string,
) {
  const barcodes = incoming
    .map((v) => v.barcode?.trim())
    .filter((b): b is string => !!b);
  if (barcodes.length === 0) return;

  const dupes = barcodes.filter((b, i) => barcodes.indexOf(b) !== i);
  if (dupes.length > 0) {
    throw new AppError(
      `Duplicate variation barcode in this product: ${dupes[0]}`,
      400,
    );
  }

  const [productClash, variationClash] = await Promise.all([
    prisma.product.findFirst({
      where: {
        barcode: { in: barcodes },
        ...(excludeProductId ? { NOT: { id: excludeProductId } } : {}),
      },
      select: { barcode: true },
    }),
    prisma.productVariation.findFirst({
      where: {
        barcode: { in: barcodes },
        ...(excludeProductId ? { NOT: { productId: excludeProductId } } : {}),
      },
      select: { barcode: true },
    }),
  ]);

  const clash = productClash?.barcode || variationClash?.barcode;
  if (clash) {
    throw new AppError(
      `Barcode "${clash}" is already in use by another product/variation`,
      409,
    );
  }
}

// GET /api/v1/products/shippable
// Returns only products that have: at least 1 image, weight set, and price > 0
// Useful for shipping calculators, catalogue exports, and featured displays
// that require complete product data.
export const getShippableProducts = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const {
      page = "1",
      limit = "12",
      categoryId,
      brandId,
      minPrice,
      maxPrice,
      sort = "newest",
    } = req.query;

    const skip = (Number(page) - 1) * Number(limit);

    const where: any = {
      status: "ACTIVE",

      // Must have at least one image
      images: { isEmpty: false },

      // Must have weight defined and > 0
      weight: { not: null, gt: 0 },

      // Must have a price > 0
      price: { gt: 0 },
    };

    // Optional filters
    if (categoryId) where.categoryId = categoryId;
    if (brandId) where.brandId = brandId;
    if (minPrice) where.price = { ...where.price, gte: Number(minPrice) };
    if (maxPrice) where.price = { ...where.price, lte: Number(maxPrice) };

    const orderBy: any = {
      newest: { createdAt: "desc" },
      oldest: { createdAt: "asc" },
      "price-asc": { price: "asc" },
      "price-desc": { price: "desc" },
      "name-asc": { name: "asc" },
      "name-desc": { name: "desc" },
      popular: { salesCount: "desc" },
    }[sort as string] || { createdAt: "desc" };

    const [products, total] = await Promise.all([
      prisma.product.findMany({
        where,
        skip,
        take: Number(limit),
        orderBy,
        select: {
          id: true,
          name: true,
          slug: true,
          sku: true,
          barcode: true,
          shortDescription: true,
          price: true,
          comparePrice: true,
          images: true,
          weight: true,
          stockQuantity: true,
          trackInventory: true,
          lowStockThreshold: true,
          netWeight: true,
          status: true,
          isFeatured: true,
          isNewArrival: true,
          isOnPromotion: true,
          salesCount: true,
          // Scalable product fields
          isScalable: true,
          scaleUnit: true,
          pricePerUnit: true,
          minOrderQty: true,
          maxOrderQty: true,
          scaleStep: true,
          scalePresets: true,
          category: { select: { id: true, name: true, slug: true } },
          brand: { select: { id: true, name: true, slug: true, logo: true } },
          _count: { select: { reviews: true } },
        },
      }),
      prisma.product.count({ where }),
    ]);

    res.status(200).json({
      success: true,
      data: {
        products,
        pagination: {
          page: Number(page),
          limit: Number(limit),
          total,
          totalPages: Math.ceil(total / Number(limit)),
          hasMore: skip + products.length < total,
        },
      },
    });
  } catch (error) {
    next(error);
  }
};

// GET /api/v1/products/:id
export const getProduct = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const id = req.params.id as string;

    // MongoDB ObjectId is exactly 24 hex characters
    const isObjectId = /^[a-f\d]{24}$/i.test(id);

    const product = await prisma.product.findFirst({
      where: isObjectId ? { OR: [{ id }, { slug: id }] } : { slug: id },
      include: {
        category: true,
        brand: true,
        reviews: {
          where: { isApproved: true },
          include: { user: { select: { id: true, name: true, image: true } } },
          orderBy: { createdAt: "desc" },
          take: 10,
        },
        variations: {
          orderBy: [{ sortOrder: "asc" }, { quantity: "asc" }],
        },
        _count: { select: { reviews: true } },
      },
    });

    if (!product) throw new NotFoundError("Product not found");

    // Increment view count
    await prisma.product.update({
      where: { id: product.id },
      data: { viewCount: { increment: 1 } },
    });

    // Calculate average rating
    const avgRating = product.reviews.length
      ? product.reviews.reduce((sum, r) => sum + r.rating, 0) /
        product.reviews.length
      : 0;

    res.status(200).json({
      success: true,
      data: {
        product: { ...product, averageRating: Math.round(avgRating * 10) / 10 },
      },
    });
  } catch (error) {
    next(error);
  }
};

// POST /api/v1/products
export const createProduct = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const {
      name,
      slug,
      description,
      shortDescription,
      sku,
      barcode,
      price,
      comparePrice,
      costPrice,
      trackInventory,
      stockQuantity,
      lowStockThreshold,
      allowBackorder,
      images,
      videos,
      categoryId,
      brandId,
      tags,
      weight,
      length,
      width,
      height,
      // Grocery-specific fields
      netWeight,
      packageSize,
      unitsPerCarton,
      origin,
      ingredients,
      allergens,
      storageInstructions,
      shelfLifeDays,
      servingSize,
      servingsPerPack,
      naifdaNumber,
      requiresRefrigeration,
      requiresFreezing,
      isOrganic,
      isHalal,
      isKosher,
      isVegan,
      isGlutenFree,
      nutritionalInfo,
      isOnPromotion,
      promotionEndsAt,
      // SEO
      metaTitle,
      metaDescription,
      metaKeywords,
      status,
      isFeatured,
      isNewArrival,
      // Scalable product
      isScalable,
      scaleUnit,
      pricePerUnit,
      minOrderQty,
      maxOrderQty,
      scaleStep,
      scalePresets,
      variations,
    } = req.body;

    // Validate unique slug
    const existingSlug = await prisma.product.findUnique({ where: { slug } });
    if (existingSlug)
      throw new AppError("Product with this slug already exists", 409);

    // Validate unique SKU
    const existingSku = await prisma.product.findUnique({ where: { sku } });
    if (existingSku)
      throw new AppError("Product with this SKU already exists", 409);

    // Validate category exists
    if (categoryId) {
      const category = await prisma.category.findUnique({
        where: { id: categoryId },
      });
      if (!category) throw new NotFoundError("Category not found");
    }

    // Validate variation barcodes are unique (against other products' own
    // barcode, other products' variation barcodes, and duplicates within
    // this payload) — a barcode must resolve to exactly one scannable thing.
    const incomingVariations: any[] = Array.isArray(variations)
      ? variations
      : [];
    await assertVariationBarcodesAvailable(incomingVariations);

    // Create product with all fields including SEO
    const product = await prisma.product.create({
      data: {
        name,
        slug,
        description: description || "",
        shortDescription,
        sku,
        barcode,
        price,
        comparePrice,
        costPrice,
        trackInventory: trackInventory ?? true,
        stockQuantity: stockQuantity ?? 0,
        lowStockThreshold: lowStockThreshold ?? 10,
        allowBackorder: allowBackorder ?? false,
        images: images ?? [],
        videos: videos ?? [],
        categoryId,
        brandId,
        tags: tags ?? [],
        weight,
        length,
        width,
        height,
        // Grocery-specific fields
        netWeight,
        packageSize,
        unitsPerCarton: unitsPerCarton ? Number(unitsPerCarton) : undefined,
        origin,
        ingredients,
        allergens: allergens ?? [],
        storageInstructions,
        shelfLifeDays: shelfLifeDays ? Number(shelfLifeDays) : undefined,
        servingSize,
        servingsPerPack,
        naifdaNumber,
        requiresRefrigeration: requiresRefrigeration ?? false,
        requiresFreezing: requiresFreezing ?? false,
        isOrganic: isOrganic ?? false,
        isHalal: isHalal ?? false,
        isKosher: isKosher ?? false,
        isVegan: isVegan ?? false,
        isGlutenFree: isGlutenFree ?? false,
        nutritionalInfo: nutritionalInfo ?? undefined,
        isOnPromotion: isOnPromotion ?? false,
        promotionEndsAt: promotionEndsAt
          ? new Date(promotionEndsAt)
          : undefined,
        // SEO fields
        metaTitle,
        metaDescription,
        metaKeywords,
        status: status ?? "DRAFT",
        isFeatured: isFeatured ?? false,
        isNewArrival: isNewArrival ?? false,
        // Scalable product fields
        isScalable: isScalable ?? false,
        scaleUnit: scaleUnit ?? null,
        pricePerUnit: pricePerUnit ?? null,
        minOrderQty: minOrderQty ?? null,
        maxOrderQty: maxOrderQty ?? null,
        scaleStep: scaleStep ?? null,
        scalePresets: scalePresets ?? [],
        // Structured variations (dynamic per-preset pricing + stock)
        variations: incomingVariations.length
          ? { create: incomingVariations.map(toVariationCreateInput) }
          : undefined,
      },
      include: { category: true, brand: true, variations: true },
    });

    // Log inventory if initial stock provided
    if (stockQuantity && stockQuantity > 0) {
      const creator = (req as AuthRequest).user?.userId
        ? await prisma.user.findUnique({
            where: { id: (req as AuthRequest).user!.userId },
            select: { name: true },
          })
        : null;

      await prisma.inventoryLog.create({
        data: {
          productId: product.id,
          type: "PURCHASE",
          quantity: stockQuantity,
          previousQty: 0,
          newQty: stockQuantity,
          reason: "Initial stock",
          performedBy: (req as AuthRequest).user?.userId,
          performedByName: creator?.name,
        },
      });
    }

    logActivity({
      userId: (req as AuthRequest).user?.userId,
      action: "create product",
      entity: "product",
      entityId: product.id,
      metadata: { name: product.name, sku: product.sku, status: product.status },
      req,
    });

    res.status(201).json({
      success: true,
      message: "Product created successfully",
      data: { product },
    });
  } catch (error) {
    next(error);
  }
};

// PUT /api/v1/products/:id
export const updateProduct = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const id = req.params.id as string;

    const product = await prisma.product.findUnique({ where: { id } });
    if (!product) throw new NotFoundError("Product not found");

    const { slug, sku, categoryId, variations, ...rest } = req.body;

    // Security: only admins can directly set stockQuantity via this endpoint.
    // Staff and Sales must go through the stock-approval workflow.
    if (req.user?.role !== "ADMIN") {
      delete rest.stockQuantity;
    }

    // If a new images array is supplied, delete any URLs that were removed
    if (Array.isArray(rest.images) && product.images.length > 0) {
      const newImageSet = new Set(rest.images as string[]);
      const removedImages = product.images.filter(
        (img) => !newImageSet.has(img),
      );
      if (removedImages.length > 0) {
        await deleteCloudinaryImages(removedImages);
      }
    }

    // Validate slug if changed
    if (slug && slug !== product.slug) {
      const existing = await prisma.product.findFirst({
        where: { slug, NOT: { id } },
      });
      if (existing) throw new AppError("Slug already in use", 409);
    }

    // Validate SKU if changed
    if (sku && sku !== product.sku) {
      const existing = await prisma.product.findFirst({
        where: { sku, NOT: { id } },
      });
      if (existing) throw new AppError("SKU already in use", 409);
    }

    // ── Variations (structured presets) ─────────────────────────────────────
    // `variations` never gets spread into the Prisma `update` call directly —
    // a raw array isn't valid nested-write syntax. Instead, when the field is
    // present we diff it against what's currently stored: rows missing from
    // the payload are deleted, rows with a known id are updated in place, and
    // rows without an id are newly created. Sent as `undefined` (field simply
    // absent from the body), variations are left untouched entirely.
    if (variations !== undefined) {
      const incoming: VariationInput[] = Array.isArray(variations)
        ? variations
        : [];
      await assertVariationBarcodesAvailable(incoming, id);

      const existingVariations = await prisma.productVariation.findMany({
        where: { productId: id },
        select: { id: true },
      });
      const existingIds = new Set(existingVariations.map((v) => v.id));
      const incomingIds = new Set(
        incoming.filter((v) => v.id).map((v) => v.id as string),
      );
      const idsToDelete = [...existingIds].filter(
        (eid) => !incomingIds.has(eid),
      );

      await prisma.$transaction([
        ...(idsToDelete.length
          ? [
              prisma.productVariation.deleteMany({
                where: { id: { in: idsToDelete } },
              }),
            ]
          : []),
        ...incoming.map((v) => {
          const data = toVariationCreateInput(v);
          if (v.id && existingIds.has(v.id)) {
            return prisma.productVariation.update({
              where: { id: v.id },
              data,
            });
          }
          return prisma.productVariation.create({
            data: { ...data, productId: id },
          });
        }),
      ]);
    }

    // Update product with all fields
    const updated = await prisma.product.update({
      where: { id },
      data: {
        ...rest,
        ...(slug && { slug }),
        ...(sku && { sku }),
        ...(categoryId && { categoryId }),
      },
      include: { category: true, brand: true, variations: true },
    });

    logActivity({
      userId: (req as AuthRequest).user?.userId,
      action: "update product",
      entity: "product",
      entityId: updated.id,
      metadata: { name: updated.name, sku: updated.sku, changedFields: Object.keys(rest) },
      req,
    });

    res.status(200).json({
      success: true,
      message: "Product updated successfully",
      data: { product: updated },
    });
  } catch (error) {
    next(error);
  }
};

// DELETE /api/v1/products/:id
export const deleteProduct = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const id = req.params.id as string;

    const product = await prisma.product.findUnique({ where: { id } });
    if (!product) throw new NotFoundError("Product not found");

    // Delete all product images from Cloudinary before removing the DB record
    if (product.images && product.images.length > 0) {
      await deleteCloudinaryImages(product.images);
    }

    await prisma.product.delete({ where: { id } });

    logActivity({
      userId: req.user?.userId,
      action: "delete product",
      entity: "product",
      entityId: id,
      metadata: { name: product.name, sku: product.sku },
      req,
    });

    res
      .status(200)
      .json({ success: true, message: "Product deleted successfully" });
  } catch (error) {
    next(error);
  }
};

// GET /api/v1/products/featured
export const getFeaturedProducts = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const { limit = "8" } = req.query;

    const products = await prisma.product.findMany({
      where: { isFeatured: true, status: "ACTIVE" },
      take: Number(limit),
      include: {
        category: { select: { id: true, name: true, slug: true } },
        brand: { select: { id: true, name: true, logo: true } },
        _count: { select: { reviews: true } },
      },
      orderBy: { createdAt: "desc" },
    });

    res.status(200).json({ success: true, data: { products } });
  } catch (error) {
    next(error);
  }
};

// GET /api/v1/products/new-arrivals
export const getNewArrivals = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const { limit = "8" } = req.query;

    const products = await prisma.product.findMany({
      where: { isNewArrival: true, status: "ACTIVE" },
      take: Number(limit),
      include: {
        category: { select: { id: true, name: true, slug: true } },
        brand: { select: { id: true, name: true, logo: true } },
        _count: { select: { reviews: true } },
      },
      orderBy: { createdAt: "desc" },
    });

    res.status(200).json({ success: true, data: { products } });
  } catch (error) {
    next(error);
  }
};

// PUT /api/v1/products/:id/inventory
export const updateInventory = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const id = req.params.id as string;
    const { type, quantity, reason, variationId } = req.body;

    const product = await prisma.product.findUnique({ where: { id } });
    if (!product) throw new NotFoundError("Product not found");

    // ── Dedicated variation stock adjustment ─────────────────────────────
    // If a variationId is supplied AND that variation tracks its own
    // dedicated stock, adjust the variation's stockQuantity instead of the
    // shared product pool — keeping the two fully independent, as intended.
    if (variationId) {
      const variation = await prisma.productVariation.findFirst({
        where: { id: variationId, productId: id },
      });
      if (!variation)
        throw new NotFoundError("Product variation not found");
      if (variation.stockQuantity === null) {
        throw new AppError(
          `"${variation.label}" uses shared stock — adjust the base product's stock instead, or switch it to dedicated stock first`,
          400,
        );
      }

      const prevVarQty = variation.stockQuantity;
      let newVarQty: number;
      if (type === "PURCHASE" || type === "RETURN") {
        newVarQty = prevVarQty + quantity;
      } else if (type === "SALE" || type === "ADJUSTMENT") {
        newVarQty = prevVarQty - quantity;
        if (newVarQty < 0) throw new AppError("Insufficient stock", 400);
      } else {
        newVarQty = quantity;
      }

      const actor = req.user?.userId
        ? await prisma.user.findUnique({
            where: { id: req.user.userId },
            select: { name: true },
          })
        : null;

      const [updatedVariation] = await prisma.$transaction([
        prisma.productVariation.update({
          where: { id: variationId },
          data: { stockQuantity: newVarQty },
        }),
        prisma.inventoryLog.create({
          data: {
            productId: id,
            type,
            quantity,
            previousQty: prevVarQty,
            newQty: newVarQty,
            reason,
            variationId,
            variationLabel: variation.label,
            stockMode: "DEDICATED",
            performedBy: req.user?.userId,
            performedByName: actor?.name,
          },
        }),
      ]);

      return res.status(200).json({
        success: true,
        message: "Variation inventory updated",
        data: { variation: updatedVariation },
      });
    }

    const previousQty = product.stockQuantity;
    let newQty: number;

    if (type === "PURCHASE" || type === "RETURN") {
      newQty = previousQty + quantity;
    } else if (type === "SALE" || type === "ADJUSTMENT") {
      newQty = previousQty - quantity;
      if (newQty < 0 && !product.allowBackorder)
        throw new AppError("Insufficient stock", 400);
    } else {
      newQty = quantity;
    }

    const actor = req.user?.userId
      ? await prisma.user.findUnique({
          where: { id: req.user.userId },
          select: { name: true },
        })
      : null;

    const [updated] = await prisma.$transaction([
      prisma.product.update({
        where: { id },
        data: {
          stockQuantity: newQty,
          status: newQty <= 0 ? "OUT_OF_STOCK" : "ACTIVE",
        },
      }),
      prisma.inventoryLog.create({
        data: {
          productId: id,
          type,
          quantity,
          previousQty,
          newQty,
          reason,
          performedBy: req.user?.userId,
          performedByName: actor?.name,
        },
      }),
    ]);

    res.status(200).json({
      success: true,
      message: "Inventory updated",
      data: { product: updated },
    });
  } catch (error) {
    next(error);
  }
};

// GET /api/v1/products
// ── Slug-to-ID resolver helpers ───────────────────────────────────────────────
// Accepts either a MongoDB ObjectId OR a slug string.  Returns the resolved ID.
async function resolveCategoryId(value: string): Promise<string | null> {
  const isObjectId = /^[a-f\d]{24}$/i.test(value);
  if (isObjectId) return value;
  const cat = await prisma.category.findUnique({
    where: { slug: value },
    select: { id: true },
  });
  return cat?.id ?? null;
}

async function resolveBrandId(value: string): Promise<string | null> {
  const isObjectId = /^[a-f\d]{24}$/i.test(value);
  if (isObjectId) return value;
  const brand = await prisma.brand.findUnique({
    where: { slug: value },
    select: { id: true },
  });
  return brand?.id ?? null;
}

export const getProducts = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const {
      page = "1",
      limit = "12",
      search,
      categoryId,
      categorySlug,
      brandId,
      brandSlug,
      minPrice,
      maxPrice,
      inStock,
      isFeatured,
      isNewArrival,
      isOnPromotion,
      barcode,
      status = "ACTIVE",
      sort = "newest",
      tags,
    } = req.query;

    const skip = (Number(page) - 1) * Number(limit);

    const where: any = {};

    // Respect status filter — omit clause entirely for "all" to fetch every status
    const statusUpper = (status as string | undefined)?.toUpperCase();
    if (statusUpper && statusUpper !== "ALL") {
      where.status = statusUpper; // e.g. "ACTIVE", "DRAFT", "OUT_OF_STOCK"
    }
    // "all" or missing → no status filter → admin sees every product

    if (search) {
      where.OR = [
        { name: { contains: search as string, mode: "insensitive" } },
        { description: { contains: search as string, mode: "insensitive" } },
        { sku: { contains: search as string, mode: "insensitive" } },
        { barcode: { contains: search as string, mode: "insensitive" } },
        { tags: { has: search as string } },
      ];
    }

    // ── Category: accepts categorySlug OR categoryId (ObjectId or slug) ───────
    const rawCategoryValue = (categorySlug || categoryId) as string | undefined;
    if (rawCategoryValue) {
      const resolvedCatId = await resolveCategoryId(rawCategoryValue);
      if (resolvedCatId) where.categoryId = resolvedCatId;
    }

    // ── Brand: accepts brandSlug OR brandId (comma-separated slugs or IDs) ────
    const rawBrandValue = (brandSlug || brandId) as string | undefined;
    if (rawBrandValue) {
      const rawBrandIds = rawBrandValue.split(",").filter(Boolean);
      const resolvedBrandIds = (
        await Promise.all(rawBrandIds.map(resolveBrandId))
      ).filter(Boolean) as string[];
      if (resolvedBrandIds.length === 1) {
        where.brandId = resolvedBrandIds[0];
      } else if (resolvedBrandIds.length > 1) {
        where.brandId = { in: resolvedBrandIds };
      }
    }
    if (minPrice || maxPrice) {
      where.price = {};
      if (minPrice) where.price.gte = Number(minPrice);
      if (maxPrice) where.price.lte = Number(maxPrice);
    }
    if (inStock === "true") where.stockQuantity = { gt: 0 };
    if (isFeatured === "true") where.isFeatured = true;
    if (isNewArrival === "true") where.isNewArrival = true;
    if (isOnPromotion === "true") where.isOnPromotion = true;
    // A barcode scan can match either the product's own barcode OR a
    // specific variation's dedicated barcode (e.g. scanning a pre-labeled
    // "500g Pack" sticker) — POS relies on this to add the right preset
    // directly instead of falling back to the base product.
    if (barcode) {
      const barcodeOr = [
        { barcode: barcode as string },
        { variations: { some: { barcode: barcode as string } } },
      ];
      // If a text `search` OR clause is already set, AND the two together
      // instead of clobbering it (barcode scans normally arrive alone, but
      // this keeps combined queries correct too).
      if (where.OR) {
        where.AND = [...(where.AND || []), { OR: where.OR }, { OR: barcodeOr }];
        delete where.OR;
      } else {
        where.OR = barcodeOr;
      }
    }
    if (tags) where.tags = { hasSome: (tags as string).split(",") };

    // ── Sorting ──────────────────────────────────────────────────────────────
    let products: any[];
    let total: number;

    if (sort === "random") {
      // Use MongoDB $sample via raw aggregation — never loads all rows into memory
      const sampleSize = Number(limit);
      const [raw, totalCount] = await Promise.all([
        (prisma as any).$runCommandRaw({
          aggregate: "products",
          pipeline: [
            {
              $match: {
                status: "ACTIVE",
                ...(Object.keys(where).length > 1
                  ? { $expr: { $and: [] } }
                  : {}),
              },
            },
            { $sample: { size: sampleSize } },
            {
              $project: {
                _id: 1,
                name: 1,
                slug: 1,
                description: 1,
                shortDescription: 1,
                sku: 1,
                barcode: 1,
                price: 1,
                comparePrice: 1,
                costPrice: 1,
                trackInventory: 1,
                stockQuantity: 1,
                lowStockThreshold: 1,
                allowBackorder: 1,
                images: 1,
                videos: 1,
                categoryId: 1,
                brandId: 1,
                tags: 1,
                netWeight: 1,
                packageSize: 1,
                unitsPerCarton: 1,
                isOnPromotion: 1,
                status: 1,
                isFeatured: 1,
                isNewArrival: 1,
                viewCount: 1,
                salesCount: 1,
                createdAt: 1,
                updatedAt: 1,
              },
            },
          ],
          cursor: {},
        }),
        prisma.product.count({ where }),
      ]);

      total = totalCount;
      const rawProducts = (raw as any)?.cursor?.firstBatch ?? [];

      console.log(
        `[getProducts/random] raw sample count: ${rawProducts.length}`,
      );
      if (rawProducts.length > 0) {
        const sample = rawProducts[0];
        console.log(
          `[getProducts/random] sample _id type: ${typeof sample._id}, value:`,
          sample._id,
        );
        console.log(
          `[getProducts/random] sample categoryId type: ${typeof sample.categoryId}, value:`,
          sample.categoryId,
        );
        console.log(
          `[getProducts/random] sample brandId type: ${typeof sample.brandId}, value:`,
          sample.brandId,
        );
      }

      // MongoDB $runCommandRaw returns ObjectId fields as { $oid: "hexstring" } objects,
      // NOT plain strings. Calling .toString() on them gives "[object Object]".
      // We must extract the $oid property explicitly.
      const extractOid = (v: any): string | null => {
        if (!v) return null;
        if (typeof v === "string") return v; // already a string
        if (typeof v.$oid === "string") return v.$oid; // { $oid: "..." } shape
        return null;
      };

      // Resolve category + brand IDs correctly
      const catIds = [
        ...new Set(
          rawProducts.map((p: any) => extractOid(p.categoryId)).filter(Boolean),
        ),
      ] as string[];
      const brandIds = [
        ...new Set(
          rawProducts.map((p: any) => extractOid(p.brandId)).filter(Boolean),
        ),
      ] as string[];

      console.log(`[getProducts/random] catIds:`, catIds);
      console.log(`[getProducts/random] brandIds:`, brandIds);

      const [cats, brands] = await Promise.all([
        catIds.length
          ? prisma.category.findMany({
              where: { id: { in: catIds } },
              select: { id: true, name: true, slug: true },
            })
          : [],
        brandIds.length
          ? prisma.brand.findMany({
              where: { id: { in: brandIds } },
              select: { id: true, name: true, slug: true, logo: true },
            })
          : [],
      ]);

      console.log(
        `[getProducts/random] resolved cats: ${cats.length}, brands: ${brands.length}`,
      );

      const catMap = Object.fromEntries(cats.map((c) => [c.id, c]));
      const brandMap = Object.fromEntries(brands.map((b) => [b.id, b]));

      products = rawProducts.map((p: any) => {
        const id = extractOid(p._id);
        const catId = extractOid(p.categoryId);
        const brandId = extractOid(p.brandId);
        return {
          ...p,
          id,
          categoryId: catId,
          brandId,
          category: catId ? (catMap[catId] ?? null) : null,
          brand: brandId ? (brandMap[brandId] ?? null) : null,
          _count: { reviews: 0 },
        };
      });
    } else {
      // Normal sorting — run products + count in parallel
      const orderBy: any = {
        newest: { createdAt: "desc" },
        oldest: { createdAt: "asc" },
        "price-asc": { price: "asc" },
        "price-desc": { price: "desc" },
        "name-asc": { name: "asc" },
        "name-desc": { name: "desc" },
        popular: { salesCount: "desc" },
      }[sort as string] || { createdAt: "desc" };

      [products, total] = await Promise.all([
        prisma.product.findMany({
          where,
          skip,
          take: Number(limit),
          orderBy,
          include: {
            category: { select: { id: true, name: true, slug: true } },
            brand: { select: { id: true, name: true, slug: true, logo: true } },
            variations: {
              where: { isActive: true },
              orderBy: [{ sortOrder: "asc" }, { quantity: "asc" }],
            },
            _count: { select: { reviews: true } },
          },
        }),
        prisma.product.count({ where }),
      ]);
    }

    res.status(200).json({
      success: true,
      data: {
        // Compute stockStatus from live DB values — not stored in DB, derived here.
        products: products.map((p: any) => ({
          ...p,
          stockStatus:
            p.stockQuantity <= 0
              ? "OUT_OF_STOCK"
              : p.stockQuantity <= p.lowStockThreshold
                ? "LOW_STOCK"
                : "IN_STOCK",
        })),
        pagination: {
          page: Number(page),
          limit: Number(limit),
          total,
          totalPages: Math.ceil(total / Number(limit)),
          hasMore: skip + products.length < total,
        },
      },
    });
  } catch (error) {
    next(error);
  }
};
