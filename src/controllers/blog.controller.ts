import { Request, Response, NextFunction } from "express";
import prisma from "../config/database";
import { AppError, NotFoundError } from "../utils/appError";
import { AuthRequest } from "../middlewares/auth.middleware";

// GET /api/v1/blog/posts
export const getBlogPosts = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const {
      page = "1",
      limit = "10",
      categoryId,
      search,
      tag,
      status,
    } = req.query;
    const skip = (Number(page) - 1) * Number(limit);

    const isAdminReq =
      !!(req as AuthRequest).user &&
      ["ADMIN", "STAFF"].includes((req as AuthRequest).user!.role);
    const where: any = { status: isAdminReq && status ? status : "PUBLISHED" };

    if (categoryId) where.categoryId = categoryId;
    if (tag) where.tags = { has: tag };
    if (search) {
      where.OR = [
        { title: { contains: search as string, mode: "insensitive" } },
        { excerpt: { contains: search as string, mode: "insensitive" } },
      ];
    }

    const [posts, total] = await Promise.all([
      prisma.blogPost.findMany({
        where,
        skip,
        take: Number(limit),
        orderBy: { publishedAt: "desc" },
        include: { category: { select: { id: true, name: true, slug: true } } },
        omit: { content: true }, // Don't return full content in listing
      }),
      prisma.blogPost.count({ where }),
    ]);

    res.status(200).json({
      success: true,
      data: {
        posts,
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

// GET /api/v1/blog/posts/:id
export const getBlogPost = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const identifier = Array.isArray(req.params.id)
      ? req.params.id[0]
      : req.params.id;

    // MongoDB ObjectIds are exactly 24 hex characters
    const isObjectId = /^[a-f\d]{24}$/i.test(identifier);

    // Build query safely — only include id lookup if it looks like a valid ObjectId
    // Passing a non-ObjectId string as `id` to Prisma/MongoDB causes a 500 crash
    const where = isObjectId
      ? { OR: [{ id: identifier }, { slug: identifier }] }
      : { slug: identifier };

    const post = await prisma.blogPost.findFirst({
      where,
      include: {
        category: {
          select: {
            id: true,
            name: true,
            slug: true,
          },
        },
      },
    });

    if (!post) {
      throw new NotFoundError("Blog post not found");
    }

    // Check if user can view unpublished posts
    if (post.status !== "PUBLISHED" && !(req as AuthRequest).user) {
      throw new NotFoundError("Blog post not found");
    }

    // Increment view count (fire and forget — don't await)
    prisma.blogPost
      .update({
        where: { id: post.id },
        data: { viewCount: { increment: 1 } },
      })
      .catch(() => {}); // silently ignore view count errors

    // Get related posts
    const related = await prisma.blogPost.findMany({
      where: {
        status: "PUBLISHED",
        categoryId: post.categoryId ?? undefined,
        id: { not: post.id },
      },
      take: 4,
      orderBy: { publishedAt: "desc" },
      select: {
        id: true,
        title: true,
        slug: true,
        featuredImage: true,
        publishedAt: true,
        excerpt: true,
      },
    });

    res.status(200).json({
      success: true,
      data: {
        post,
        related,
      },
    });
  } catch (error) {
    next(error);
  }
};

// POST /api/v1/blog/posts  (staff/admin)
export const createBlogPost = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const { slug, status, ...rest } = req.body;

    const existing = await prisma.blogPost.findUnique({ where: { slug } });
    if (existing)
      throw new AppError("A post with this slug already exists", 409);

    const post = await prisma.blogPost.create({
      data: {
        ...rest,
        slug,
        status: status || "DRAFT",
        publishedAt: status === "PUBLISHED" ? new Date() : null,
      },
    });

    res
      .status(201)
      .json({ success: true, message: "Blog post created", data: { post } });
  } catch (error) {
    next(error);
  }
};

// PUT /api/v1/blog/posts/:id  (staff/admin)
export const updateBlogPost = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;

    const post = await prisma.blogPost.findUnique({ where: { id } } as any);
    if (!post) throw new NotFoundError("Blog post not found");

    if (req.body.slug && req.body.slug !== post.slug) {
      const existing = await prisma.blogPost.findFirst({
        where: { slug: req.body.slug, NOT: { id } },
      });
      if (existing) throw new AppError("Slug already in use", 409);
    }

    const updates: any = { ...req.body };
    if (req.body.status === "PUBLISHED" && post.status !== "PUBLISHED") {
      updates.publishedAt = new Date();
    }

    const updated = await prisma.blogPost.update({
      where: { id },
      data: updates,
    });
    res.status(200).json({
      success: true,
      message: "Blog post updated",
      data: { post: updated },
    });
  } catch (error) {
    next(error);
  }
};

// DELETE /api/v1/blog/posts/:id  (staff/admin)
export const deleteBlogPost = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const post = await prisma.blogPost.findUnique({ where: { id } });
    if (!post) throw new NotFoundError("Blog post not found");

    await prisma.blogPost.delete({ where: { id } });
    res.status(200).json({ success: true, message: "Blog post deleted" });
  } catch (error) {
    next(error);
  }
};

// GET /api/v1/blog/categories
export const getBlogCategories = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const categories = await prisma.blogCategory.findMany({
      orderBy: { name: "asc" },
      include: {
        _count: { select: { posts: { where: { status: "PUBLISHED" } } } },
      },
    });
    res.status(200).json({ success: true, data: { categories } });
  } catch (error) {
    next(error);
  }
};

// POST /api/v1/blog/categories  (staff/admin)
export const createBlogCategory = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const { name, slug, description } = req.body;

    const existing = await prisma.blogCategory.findFirst({
      where: { OR: [{ name }, { slug }] },
    });
    if (existing) throw new AppError("Category already exists", 409);

    const category = await prisma.blogCategory.create({
      data: { name, slug, description },
    });
    res
      .status(201)
      .json({ success: true, message: "Category created", data: { category } });
  } catch (error) {
    next(error);
  }
};

// PUT /api/v1/blog/categories/:id  (staff/admin)
export const updateBlogCategory = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const category = await prisma.blogCategory.findUnique({ where: { id } });
    if (!category) throw new NotFoundError("Category not found");

    const updated = await prisma.blogCategory.update({
      where: { id },
      data: req.body,
    });
    res.status(200).json({
      success: true,
      message: "Category updated",
      data: { category: updated },
    });
  } catch (error) {
    next(error);
  }
};

// DELETE /api/v1/blog/categories/:id  (admin)
export const deleteBlogCategory = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const category = (await prisma.blogCategory.findUnique({
      where: { id },
      include: { _count: { select: { posts: true } } },
    })) as any;
    if (!category) throw new NotFoundError("Category not found");
    if (category._count.posts > 0)
      throw new AppError(
        "Cannot delete category with posts. Reassign posts first.",
        400,
      );

    await prisma.blogCategory.delete({ where: { id } });
    res.status(200).json({ success: true, message: "Category deleted" });
  } catch (error) {
    next(error);
  }
};
