import { Router } from "express";
import {
  getOrders,
  getOrder,
  createOrder,
  updateOrderStatus,
  cancelOrder,
  getOrderStats,
  getOrderTracking,
  addTrackingUpdate,
  updateTrackingNumber,
} from "../controllers/order.controller";
import { protect, staffOrAdmin } from "../middlewares/auth.middleware";

const router = Router();

// Public tracking (by order number)
router.get("/:id/tracking", getOrderTracking);

// Protected routes
router.use(protect);

router.get("/stats", staffOrAdmin, getOrderStats);
router.get("/", getOrders);
router.get("/:id", getOrder);
router.post("/", createOrder);

// Admin routes
router.put("/:id/status", staffOrAdmin, updateOrderStatus);
router.post("/:id/tracking", staffOrAdmin, addTrackingUpdate);
router.put("/:id/tracking-number", staffOrAdmin, updateTrackingNumber);

// Customer can cancel their own orders
router.put("/:id/cancel", cancelOrder);

export default router;
