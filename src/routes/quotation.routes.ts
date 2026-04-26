import { Router } from 'express';
import {
  getQuotations, getQuotation, createQuotation, updateQuotation, deleteQuotation,
} from '../controllers/quotation.controller';
import { protect, staffOrAdmin, adminOnly, optionalAuth } from '../middlewares/auth.middleware';

const router = Router();

// Public — anyone can submit a quotation request
router.post('/', optionalAuth, createQuotation);

// Protected
router.use(protect);
router.get('/', getQuotations);
router.get('/:id', getQuotation);
router.put('/:id', staffOrAdmin, updateQuotation);
router.delete('/:id', adminOnly, deleteQuotation);

export default router;
