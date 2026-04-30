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

// Admin only — view and action requests
router.get("/", adminOnly, getStockRequests);
router.get("/pending-count", adminOnly, getPendingCount);
router.post("/bulk-approve", adminOnly, bulkApproveStockRequests);
router.post("/:id/approve", adminOnly, approveStockRequest);
router.post("/:id/reject", adminOnly, rejectStockRequest);

export default router;
