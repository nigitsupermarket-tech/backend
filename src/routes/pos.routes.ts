import { Router } from "express";
import {
  createPOSOrder,
  getPOSOrders,
  getPOSOrder,
  voidPOSOrder,
  requestVoidOrder,
  getOrderVoidRequestStatus,
  getVoidRequests,
  getVoidRequestsPendingCount,
  approveVoidRequest,
  rejectVoidRequest,
  getPOSStats,
  openPOSSession,
  closePOSSession,
  getPOSSessions,
  suspendPOSOrder,
  getSuspendedOrders,
  resumePOSOrder,
  holdNewPOSOrder,
} from "../controllers/pos.controller";
import { protect, staffOrAdmin, adminOnly } from "../middlewares/auth.middleware";

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
// Voiding — ADMIN-only. Every other role must request approval instead.
router.put("/orders/:id/void", adminOnly, voidPOSOrder);
router.post("/orders/:id/void-request", requestVoidOrder); // non-admin requests approval
router.get("/orders/:id/void-request", getOrderVoidRequestStatus); // check pending/approved/rejected status
router.put("/orders/:id/suspend", suspendPOSOrder); // suspend an already-OPEN order
router.put("/orders/:id/resume", resumePOSOrder); // resume a SUSPENDED order

// Void approval queue — ADMIN-only
router.get("/void-requests", adminOnly, getVoidRequests);
router.get("/void-requests/pending-count", adminOnly, getVoidRequestsPendingCount);
router.put("/void-requests/:id/approve", adminOnly, approveVoidRequest);
router.put("/void-requests/:id/reject", adminOnly, rejectVoidRequest);

// Stats
router.get("/stats", getPOSStats);

// Sessions
router.post("/sessions", openPOSSession);
// Open to all staffOrAdmin (the POS terminal calls this with ?limit=1 to
// check the cashier's own session). Role-based scoping of the FULL list
// (ADMIN sees all, MANAGER sees MANAGER/STAFF/SALES, regular STAFF/SALES
// only see their own) happens inside getPOSSessions.
router.get("/sessions", getPOSSessions);
router.put("/sessions/:id/close", closePOSSession);
router.post("/sessions/:id/close", closePOSSession); // backwards compat

export default router;
