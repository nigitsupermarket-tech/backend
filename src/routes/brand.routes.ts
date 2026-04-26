import { Router } from 'express';
import { getBrands, getBrand, createBrand, updateBrand, deleteBrand } from '../controllers/brand.controller';
import { protect, staffOrAdmin } from '../middlewares/auth.middleware';

const router = Router();

router.get('/', getBrands);
router.get('/:id', getBrand);
router.post('/', protect, staffOrAdmin, createBrand);
router.put('/:id', protect, staffOrAdmin, updateBrand);
router.delete('/:id', protect, staffOrAdmin, deleteBrand);

export default router;
