import { Router } from "express";
import multer from "multer";
import {
  exportProductsCSV,
  exportProductsPDF,
  importProductsCSV,
  downloadCSVTemplate,
  exportCataloguePDF,
} from "../controllers/export.controller";
import { protect, staffOrAdmin } from "../middlewares/auth.middleware";

const router = Router();

// Multer configuration for CSV upload
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
  fileFilter: (req, file, cb) => {
    if (file.mimetype === "text/csv" || file.originalname.endsWith(".csv")) {
      cb(null, true);
    } else {
      cb(new Error("Only CSV files are allowed"));
    }
  },
});

// Admin routes (protected)
router.get("/products/csv", protect, staffOrAdmin, exportProductsCSV);
router.get("/products/pdf", protect, staffOrAdmin, exportProductsPDF);
router.post(
  "/products/import",
  protect,
  staffOrAdmin,
  upload.single("file"),
  importProductsCSV,
);
router.get("/products/template", protect, staffOrAdmin, downloadCSVTemplate);

// Public route for catalogue
router.get("/catalogue/pdf", exportCataloguePDF);

export default router;
