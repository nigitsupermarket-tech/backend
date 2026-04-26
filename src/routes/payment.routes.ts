import { Router, raw } from 'express';
import { initializePayment, verifyPayment, paystackWebhook } from '../controllers/payment.controller';
import { protect } from '../middlewares/auth.middleware';

const router = Router();

// Paystack webhook — raw body needed for signature verification
router.post(
  '/webhook',
  raw({ type: 'application/json' }),
  paystackWebhook
);

// Protected
router.post('/initialize', protect, initializePayment);
router.get('/verify/:reference', verifyPayment);

export default router;
