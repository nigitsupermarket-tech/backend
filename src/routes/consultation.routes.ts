import { Router } from 'express';
import {
  getConsultations, getConsultation, createConsultation, updateConsultation, deleteConsultation,
} from '../controllers/consultation.controller';
import { protect, staffOrAdmin, adminOnly, optionalAuth } from '../middlewares/auth.middleware';

const router = Router();

// Public — anyone can book a consultation
router.post('/', optionalAuth, createConsultation);

// Protected
router.use(protect);
router.get('/', getConsultations);
router.get('/:id', getConsultation);
router.put('/:id', staffOrAdmin, updateConsultation);
router.delete('/:id', adminOnly, deleteConsultation);

export default router;
