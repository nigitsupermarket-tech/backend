import { Router } from 'express';
import {
  getDiscounts, getDiscount, createDiscount,
  updateDiscount, deleteDiscount, validateDiscount,
} from '../controllers/discount.controller';
import { protect, staffOrAdmin } from '../middlewares/auth.middleware';

const router = Router();

// Public — used at checkout
router.post('/validate', validateDiscount);

// Staff/Admin
router.use(protect, staffOrAdmin);
router.get('/', getDiscounts);
router.get('/:id', getDiscount);
router.post('/', createDiscount);
router.put('/:id', updateDiscount);
router.delete('/:id', deleteDiscount);

export default router;
