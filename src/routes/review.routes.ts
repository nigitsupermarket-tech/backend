import { Router } from 'express';
import {
  getProductReviews, getPendingReviews, createReview,
  updateReview, deleteReview, toggleApproveReview,
} from '../controllers/review.controller';
import { protect, staffOrAdmin } from '../middlewares/auth.middleware';

const router = Router();

// Public
router.get('/', getProductReviews);           // ?productId=xxx

// Staff/Admin
router.get('/pending', protect, staffOrAdmin, getPendingReviews);

// Authenticated
router.post('/', protect, createReview);
router.put('/:id', protect, updateReview);
router.delete('/:id', protect, deleteReview);
router.put('/:id/approve', protect, staffOrAdmin, toggleApproveReview);

export default router;
