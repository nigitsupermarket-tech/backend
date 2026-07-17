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
  sendInvoiceManually,
  notifyOrderStatus,
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

// Manual email triggers — used when Settings → Notifications has the
// invoice/status email mode set to "manual" (the default). ACCOUNTANT is
// excluded via staffOrAdmin, consistent with all other order-processing actions.
router.post("/:id/send-invoice", staffOrAdmin, sendInvoiceManually);
router.post("/:id/notify-status", staffOrAdmin, notifyOrderStatus);

// Customer can cancel their own orders
router.put("/:id/cancel", cancelOrder);

export default router;
