// ============================================================
// PRODUCT ROUTES  →  src/routes/product.routes.ts
// ============================================================
import { Router } from "express";
import {
  getProducts,
  getProduct,
  getShippableProducts,
  createProduct,
  updateProduct,
  deleteProduct,
  getFeaturedProducts,
  getNewArrivals,
  updateInventory,
  getProductRelatedRecordsSummary,
  requestProductDelete,
  getProductDeleteRequestStatus,
  getProductDeleteRequests,
  getProductDeleteRequestsPendingCount,
  getProductDeleteRequest,
  approveProductDeleteRequest,
  rejectProductDeleteRequest,
} from "../controllers/product.controller";
import {
  protect,
  staffOrAdmin,
  adminOnly,
  restrictTo,
} from "../middlewares/auth.middleware";

// Product hard-delete requests can only be INITIATED by STAFF or MANAGER,
// per the approval workflow spec — ADMIN deletes directly instead (see
// deleteProduct below), and SALES/ACCOUNTANT never get either path.
const staffOrManagerOnly = restrictTo("STAFF", "MANAGER");

const router = Router();

router.get("/", getProducts);
router.get("/products", getShippableProducts);
router.get("/featured", getFeaturedProducts);
router.get("/new-arrivals", getNewArrivals);

// ── Product delete-approval queue — ADMIN-only ───────────────────────────
// ⚠️  Static paths MUST come before /:id param routes to avoid Express
//     treating "delete-requests" as an id value.
router.get(
  "/delete-requests",
  protect,
  adminOnly,
  getProductDeleteRequests,
);
router.get(
  "/delete-requests/pending-count",
  protect,
  adminOnly,
  getProductDeleteRequestsPendingCount,
);
router.get(
  "/delete-requests/:id",
  protect,
  adminOnly,
  getProductDeleteRequest,
);
router.put(
  "/delete-requests/:id/approve",
  protect,
  adminOnly,
  approveProductDeleteRequest,
);
router.put(
  "/delete-requests/:id/reject",
  protect,
  adminOnly,
  rejectProductDeleteRequest,
);

router.get("/:id", getProduct);
router.post("/", protect, staffOrAdmin, createProduct);
router.put("/:id", protect, staffOrAdmin, updateProduct);
router.put("/:id/inventory", protect, staffOrAdmin, updateInventory);

// Related-records preview — any staff-side role, used by the delete
// warning dialog before requesting/performing a hard delete.
router.get(
  "/:id/related-records",
  protect,
  staffOrAdmin,
  getProductRelatedRecordsSummary,
);

// Hard delete — ADMIN-only, direct and immediate.
router.delete("/:id", protect, adminOnly, deleteProduct);

// Non-admin (STAFF/MANAGER) hard-delete approval flow — mirrors the POS
// void-request pattern in pos.routes.ts.
router.post(
  "/:id/delete-request",
  protect,
  staffOrManagerOnly,
  requestProductDelete,
);
router.get(
  "/:id/delete-request",
  protect,
  staffOrAdmin,
  getProductDeleteRequestStatus,
);

export default router;
