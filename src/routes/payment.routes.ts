import { Router, raw, json } from "express";
import {
  initializePayment,
  verifyPayment,
  paystackWebhook,
  getBankDetails,
  notifyBankTransfer,
  submitProofOfPayment,
  confirmBankTransfer,
} from "../controllers/payment.controller";
import { protect, restrictTo } from "../middlewares/auth.middleware";

const router = Router();

// ── Paystack webhook ──────────────────────────────────────────────────────────
// MUST use raw() here — Paystack signature verification requires the original
// raw request bytes. Do NOT apply express.json() to this route.
router.post("/webhook", raw({ type: "application/json" }), paystackWebhook);

// ── All other payment routes need JSON body parsing ───────────────────────────
// We apply express.json() explicitly here so this router can sit AFTER the
// global express.json() in app.ts without the webhook being double-parsed,
// and without the initialize/verify routes losing their body when the router
// sits BEFORE express.json().
//
// The webhook uses raw() which overrides express.json() for that one route.
// Every other route uses json() to ensure req.body is always populated,
// regardless of where in app.ts this router is registered.
router.use(json({ limit: "10mb" }));

// ── Public ────────────────────────────────────────────────────────────────────
router.get("/bank-details", getBankDetails);
router.get("/verify/:reference", verifyPayment);

// ── Customer (authenticated) ──────────────────────────────────────────────────
router.post("/initialize", protect, initializePayment);
router.post("/bank-transfer/notify", protect, notifyBankTransfer);
router.post("/bank-transfer/proof", protect, submitProofOfPayment);

// ── Staff / Admin only ────────────────────────────────────────────────────────
router.post("/bank-transfer/confirm", protect, confirmBankTransfer);

export default router;
