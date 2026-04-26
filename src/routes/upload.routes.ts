// src/routes/upload.routes.ts
import { Router } from "express";
import multer from "multer";
import {
  uploadImage,
  uploadImages,
  deleteUpload,
  deleteBulkUploads,
} from "../controllers/upload.controller";
import { protect, staffOrAdmin } from "../middlewares/auth.middleware";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith("image/")) {
      cb(null, true);
    } else {
      cb(new Error("Only image files are allowed"));
    }
  },
});

const router = Router();

// All upload routes require authentication
router.use(protect, staffOrAdmin);

router.post("/image", upload.single("image"), uploadImage);
router.post("/images", upload.array("images", 10), uploadImages);
router.delete("/", deleteUpload);
router.delete("/bulk", deleteBulkUploads);

export default router;
