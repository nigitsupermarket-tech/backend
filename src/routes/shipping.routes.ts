// backend/src/routes/shipping.routes.ts
import { Router } from "express";
import {
  // Zones
  getShippingZones,
  getAllShippingZones,
  getShippingZone,
  createShippingZone,
  updateShippingZone,
  deleteShippingZone,
  // Methods
  getAllShippingMethods,
  createShippingMethod,
  getShippingMethod,
  updateShippingMethod,
  deleteShippingMethod,
  // Calculate
  calculateShipping,
  // Shipments
  createShipment,
  getShipments,
  getOrdersReadyForShipment,
  markOutForDelivery,
  markDelivered,
  // Tracking
  getTrackingByNumber,
  addTrackingEvent,
  getOrderTrackingEvents,
  updateShipmentTracking,
  // Dashboard
  getShippingDashboardStats,
  // Seed
  seedShippingData,
} from "../controllers/shipping.controller";
import { protect, staffOrAdmin } from "../middlewares/auth.middleware";

const router = Router();

// ── PUBLIC ROUTES ─────────────────────────────────────────────────────────────

// Public zone list (for checkout)
router.get("/zones", getShippingZones);

// Public shipping calculation (checkout)
router.post("/calculate", calculateShipping);

// Public tracking by tracking number or order number
router.get("/track/:trackingNumber", getTrackingByNumber);

// ── PROTECTED ADMIN ROUTES ────────────────────────────────────────────────────
router.use(protect, staffOrAdmin);

// Dashboard
router.get("/dashboard/stats", getShippingDashboardStats);

// Seed (run once to populate zones & methods)
router.post("/seed", seedShippingData);

// Zones — admin management
router.get("/zones/all", getAllShippingZones);
router.get("/zones/:id", getShippingZone);
router.post("/zones", createShippingZone);
router.put("/zones/:id", updateShippingZone);
router.delete("/zones/:id", deleteShippingZone);

// Methods — admin management
router.get("/methods", getAllShippingMethods);
router.post("/methods", createShippingMethod);
router.get("/methods/:id", getShippingMethod);
router.put("/methods/:id", updateShippingMethod);
router.delete("/methods/:id", deleteShippingMethod);

// Shipments — create & list
router.get("/shipments", getShipments);
router.post("/shipments", createShipment);
router.get("/ready", getOrdersReadyForShipment);

// Shipment status transitions
router.put("/shipments/:orderId/out-for-delivery", markOutForDelivery);
router.put("/shipments/:orderId/delivered", markDelivered);

// Tracking management (admin)
router.get("/orders/:orderId/tracking", getOrderTrackingEvents);
router.post("/tracking/events", addTrackingEvent);
router.put("/orders/:orderId/tracking", updateShipmentTracking);

export default router;
