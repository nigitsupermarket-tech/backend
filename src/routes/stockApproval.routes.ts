// backend/src/routes/stockApproval.routes.ts
import { Router } from "express";
import {
  createStockRequest,
  getStockRequests,
  approveStockRequest,
  rejectStockRequest,
  bulkApproveStockRequests,
  getPendingCount,
  getPendingProductIds,
} from "../controllers/stockApproval.controller";
import {
  protect,
  adminOnly,
  staffOrAdmin,
  stockEditAccess,
} from "../middlewares/auth.middleware";

const router = Router();

router.use(protect);

// ADMIN / MANAGER / STAFF — submit a request (admin auto-approves).
// SALES and ACCOUNTANT can never change stock, so they are rejected here.
router.post("/", stockEditAccess, createStockRequest);

// Admin only — the whole approval queue, including read/history, is now
// Admin-exclusive (Manager and Accountant previously had read-only access;
// that's removed too, not just their ability to act).
router.get("/", adminOnly, getStockRequests);
router.get("/pending-count", adminOnly, getPendingCount);
// Lower-sensitivity than the full queue above (no reason/requester
// detail, just "which products have a pending request") — visible to
// STAFF/MANAGER/SALES too so the product list badge works for whoever
// submitted the request, not just admins.
router.get("/pending-product-ids", staffOrAdmin, getPendingProductIds);

// Admin only — action requests (approve/reject/bulk).
router.post("/bulk-approve", adminOnly, bulkApproveStockRequests);
router.post("/:id/approve", adminOnly, approveStockRequest);
router.post("/:id/reject", adminOnly, rejectStockRequest);

export default router;
