// backend/src/routes/contact.routes.ts
import { Router } from "express";
import {
  submitContact,
  getContacts,
  getContact,
  updateContact,
  deleteContact,
  getContactStats,
  subscribe,
  unsubscribe,
  getSubscribers,
  deleteSubscriber,
} from "../controllers/contact.controller";
import {
  protect,
  staffOrAdmin,
  adminOnly,
} from "../middlewares/auth.middleware";

const router = Router();

// ── Public ────────────────────────────────────────────────────────────────────
router.post("/contact/send", submitContact);
router.post("/subscribe", subscribe);
router.post("/unsubscribe", unsubscribe);

// ── Staff + Admin: read & update ──────────────────────────────────────────────
router.use(protect, staffOrAdmin);

router.get("/contact", getContactStats);
router.get("/contact/messages", getContacts);
router.get("/contact/messages/:id", getContact);
router.patch("/contact/messages/:id", updateContact);

router.get("/subscribers", getSubscribers);

// ── Admin only: delete ────────────────────────────────────────────────────────
router.delete("/contact/messages/:id", adminOnly, deleteContact);
router.delete("/subscribers/:id", adminOnly, deleteSubscriber);

export default router;
