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
  adminOrManager,
  staffOrAdmin,
  stockHistoryAccess,
} from "../middlewares/auth.middleware";

const router = Router();

router.use(protect);

// Staff & Admin — submit a request (admin auto-approves)
router.post("/", staffOrAdmin, createStockRequest);

// Admin, Manager, Accountant — VIEW the full request/approval history.
// (Accountant is read-only here; it does not get the approve/reject routes.)
router.get("/", stockHistoryAccess, getStockRequests);
router.get("/pending-count", adminOrManager, getPendingCount);

// Admin only — action requests (approve/reject/bulk). Managers can view the
// queue (see stockHistoryAccess above) but can no longer action it — only
// Admin has final say on stock changes.
router.post("/bulk-approve", adminOnly, bulkApproveStockRequests);
router.post("/:id/approve", adminOnly, approveStockRequest);
router.post("/:id/reject", adminOnly, rejectStockRequest);

export default router;
