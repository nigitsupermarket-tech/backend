// backend/src/routes/pos.routes.ts
import { Router } from "express";
import {
  createPOSOrder,
  getPOSOrders,
  getPOSOrder,
  voidPOSOrder,
  getPOSStats,
  openPOSSession,
  closePOSSession,
  getPOSSessions,
} from "../controllers/pos.controller";
import { protect, staffOrAdmin } from "../middlewares/auth.middleware";

const router = Router();

router.use(protect, staffOrAdmin);

// Orders
router.post("/orders", createPOSOrder);
router.get("/orders", getPOSOrders);
router.get("/orders/:id", getPOSOrder);
router.put("/orders/:id/void", voidPOSOrder);

// Stats
router.get("/stats", getPOSStats);

// Sessions
router.post("/sessions", openPOSSession);
router.get("/sessions", getPOSSessions);
router.put("/sessions/:id/close", closePOSSession);   // ← PUT (frontend was sending POST — fix in POS page)
router.post("/sessions/:id/close", closePOSSession);  // ← also accept POST for backwards compat

export default router;
