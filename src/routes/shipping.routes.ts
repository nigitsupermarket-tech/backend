// backend/src/routes/shipping.routes.ts
import { Router } from "express";
import {
  getShippingZones,
  getAllShippingZones,
  getShippingZone,
  createShippingZone,
  updateShippingZone,
  deleteShippingZone,
  getAllShippingMethods,
  createShippingMethod,
  getShippingMethod,
  updateShippingMethod,
  deleteShippingMethod,
  calculateShipping,
} from "../controllers/shipping.controller";
import { protect, staffOrAdmin } from "../middlewares/auth.middleware";

const router = Router();

// Public routes
router.get("/zones", getShippingZones);
router.post("/calculate", calculateShipping);

// Admin routes - Zones
router.use(protect, staffOrAdmin);
router.get("/zones/all", getAllShippingZones);
router.get("/zones/:id", getShippingZone);         // ← was missing, caused 404 in zone methods page
router.post("/zones", createShippingZone);
router.put("/zones/:id", updateShippingZone);
router.delete("/zones/:id", deleteShippingZone);

// Admin routes - Methods
router.get("/methods", getAllShippingMethods);       // ← was missing, caused "Route not found" error
router.post("/methods", createShippingMethod);
router.get("/methods/:id", getShippingMethod);
router.put("/methods/:id", updateShippingMethod);
router.delete("/methods/:id", deleteShippingMethod);

export default router;
