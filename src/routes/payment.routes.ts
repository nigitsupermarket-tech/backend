import { Router, raw } from "express";
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

// ── Paystack webhook — raw body required for signature verification ───────────
router.post("/webhook", raw({ type: "application/json" }), paystackWebhook);

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
