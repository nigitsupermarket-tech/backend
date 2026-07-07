// backend/src/routes/stockApproval.routes.ts
import { Router } from "express";
import {
  createStockRequest,
  getStockRequests,
  approveStockRequest,
  rejectStockRequest,
  bulkApproveStockRequests,
  getPendingCount,
} from "../controllers/stockApproval.controller";
import {
  protect,
  adminOnly,
  staffOrAdmin,
} from "../middlewares/auth.middleware";

const router = Router();

router.use(protect);

// Staff & Admin — submit a request (admin auto-approves)
router.post("/", staffOrAdmin, createStockRequest);

// Admin only — the whole approval queue, including read/history, is now
// Admin-exclusive (Manager and Accountant previously had read-only access;
// that's removed too, not just their ability to act).
router.get("/", adminOnly, getStockRequests);
router.get("/pending-count", adminOnly, getPendingCount);

// Admin only — action requests (approve/reject/bulk).
router.post("/bulk-approve", adminOnly, bulkApproveStockRequests);
router.post("/:id/approve", adminOnly, approveStockRequest);
router.post("/:id/reject", adminOnly, rejectStockRequest);

export default router;
