import { Router } from "express";
import multer from "multer";
import {
  exportProductsCSV,
  exportProductsPDF,
  importProductsCSV,
  downloadCSVTemplate,
  exportCataloguePDF,
  importScaleGoodsSheet,
  listImportBatches,
  undoImportBatch,
} from "../controllers/export.controller";
import { protect, staffOrAdmin } from "../middlewares/auth.middleware";

const router = Router();

// Multer configuration for CSV upload
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 }, // 20MB limit — supports large catalogues
  fileFilter: (req, file, cb) => {
    if (file.mimetype === "text/csv" || file.originalname.endsWith(".csv")) {
      cb(null, true);
    } else {
      cb(new Error("Only CSV files are allowed"));
    }
  },
});

// Multer configuration for the CECON scale sheet upload (.xlsx) — a
// separate instance from `upload` above since it accepts a different file
// type entirely (Excel, not CSV).
const scaleSheetUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB — plenty for a PLU export
  fileFilter: (req, file, cb) => {
    const okExt = file.originalname.toLowerCase().endsWith(".xlsx");
    const okMime =
      file.mimetype ===
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    if (okExt || okMime) {
      cb(null, true);
    } else {
      cb(new Error("Only .xlsx files are allowed"));
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
router.post(
  "/products/import-scale-goods",
  protect,
  staffOrAdmin, // importScaleGoodsSheet itself further restricts to ADMIN only
  scaleSheetUpload.single("file"),
  importScaleGoodsSheet,
);

// Recent import runs + undo — listing is visible to anyone who can import
// (so they can see their own imports and current undo status); undo
// itself is further restricted to ADMIN inside undoImportBatch.
router.get(
  "/products/import-batches",
  protect,
  staffOrAdmin,
  listImportBatches,
);
router.post(
  "/products/import-batches/:id/undo",
  protect,
  staffOrAdmin, // undoImportBatch itself further restricts to ADMIN only
  undoImportBatch,
);

// Public route for catalogue
router.get("/catalogue/pdf", exportCataloguePDF);

export default router;
