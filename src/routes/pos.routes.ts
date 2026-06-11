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
  suspendPOSOrder,
  getSuspendedOrders,
  resumePOSOrder,
  holdNewPOSOrder,
} from "../controllers/pos.controller";
import { protect, staffOrAdmin } from "../middlewares/auth.middleware";

const router = Router();

router.use(protect, staffOrAdmin);

// Orders
// ⚠️  Static paths MUST come before /:id param routes to avoid Express
//     treating "hold" or "suspended" as an id value.
router.post("/orders/hold", holdNewPOSOrder); // create directly as SUSPENDED (no stock deduction)
router.get("/orders/suspended", getSuspendedOrders); // list held orders for this cashier
router.post("/orders", createPOSOrder); // normal completed order
router.get("/orders", getPOSOrders);
router.get("/orders/:id", getPOSOrder);
router.put("/orders/:id/void", voidPOSOrder);
router.put("/orders/:id/suspend", suspendPOSOrder); // suspend an already-OPEN order
router.put("/orders/:id/resume", resumePOSOrder); // resume a SUSPENDED order

// Stats
router.get("/stats", getPOSStats);

// Sessions
router.post("/sessions", openPOSSession);
router.get("/sessions", getPOSSessions);
router.put("/sessions/:id/close", closePOSSession);
router.post("/sessions/:id/close", closePOSSession); // backwards compat

export default router;
