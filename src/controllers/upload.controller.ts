// src/controllers/upload.controller.ts
import { Response, NextFunction } from "express";
import { AppError } from "../utils/appError";
import { AuthRequest } from "../middlewares/auth.middleware";
import {
  cloudinary,
  UPLOAD_OPTIONS,
  extractPublicId,
  deleteCloudinaryImages,
} from "../lib/cloudinary";

const toDataURI = (file: Express.Multer.File) =>
  `data:${file.mimetype};base64,${Buffer.from(file.buffer).toString("base64")}`;

// Maps frontend `folder` param → Cloudinary path
const FOLDER_MAP: Record<string, string> = {
  products:   "nigittriple/products",
  brands:     "nigittriple/brands",
  categories: "nigittriple/categories",
  blog:       "nigittriple/blog",
  settings:   "nigittriple/settings",
  avatars:    "nigittriple/avatars",
  general:    "nigittriple/general",
};

function resolveFolder(raw?: string): string {
  if (!raw) return "nigittriple/general";
  return FOLDER_MAP[raw.toLowerCase()] ?? `nigittriple/${raw}`;
}

// POST /api/v1/upload/image
export const uploadImage = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    if (!req.file) throw new AppError("No file provided", 400);

    const folder = resolveFolder(req.body.folder);
    const result = await cloudinary.uploader.upload(toDataURI(req.file), {
      ...UPLOAD_OPTIONS,
      folder,
    });

    res.status(200).json({
      success: true,
      data: {
        url:      result.secure_url,
        publicId: result.public_id,
        width:    result.width,
        height:   result.height,
        format:   result.format,
        bytes:    result.bytes,
      },
    });
  } catch (error) {
    next(error);
  }
};

// POST /api/v1/upload/images
export const uploadImages = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    if (!req.files || !Array.isArray(req.files) || req.files.length === 0)
      throw new AppError("No files provided", 400);
    if (req.files.length > 10)
      throw new AppError("Maximum 10 files allowed per upload", 400);

    const folder = resolveFolder(req.body.folder);

    const uploads = await Promise.all(
      req.files.map((file) =>
        cloudinary.uploader
          .upload(toDataURI(file), { ...UPLOAD_OPTIONS, folder })
          .then((r) => ({
            url:      r.secure_url,
            publicId: r.public_id,
            width:    r.width,
            height:   r.height,
            format:   r.format,
            bytes:    r.bytes,
          })),
      ),
    );

    res.status(200).json({ success: true, data: { images: uploads } });
  } catch (error) {
    next(error);
  }
};

// DELETE /api/v1/upload
// Accepts { publicId } OR { url }
export const deleteUpload = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const { publicId, url } = req.body;
    const resolvedId = publicId ?? (url ? extractPublicId(url) : null);
    if (!resolvedId) throw new AppError("publicId or url is required", 400);

    const result = await cloudinary.uploader.destroy(resolvedId);
    if (result.result !== "ok" && result.result !== "not found")
      throw new AppError(`Cloudinary deletion failed: ${result.result}`, 500);

    res.status(200).json({ success: true, message: "Image deleted" });
  } catch (error) {
    next(error);
  }
};

// DELETE /api/v1/upload/bulk
// Accepts { publicIds: string[] } OR { urls: string[] }
export const deleteBulkUploads = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const { publicIds, urls } = req.body;

    let ids: string[] = [];
    if (Array.isArray(publicIds) && publicIds.length > 0) {
      ids = publicIds;
    } else if (Array.isArray(urls) && urls.length > 0) {
      ids = urls.map((u: string) => extractPublicId(u)).filter((id): id is string => !!id);
    }

    if (ids.length === 0) throw new AppError("publicIds or urls array is required", 400);

    await deleteCloudinaryImages(ids);
    res.status(200).json({ success: true, message: `${ids.length} image(s) deleted` });
  } catch (error) {
    next(error);
  }
};
