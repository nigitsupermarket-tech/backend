import { Router } from 'express';
import { getCategories, getCategory, createCategory, updateCategory, deleteCategory } from '../controllers/category.controller';
import { protect, staffOrAdmin } from '../middlewares/auth.middleware';

const router = Router();

router.get('/', getCategories);
router.get('/:id', getCategory);
router.post('/', protect, staffOrAdmin, createCategory);
router.put('/:id', protect, staffOrAdmin, updateCategory);
router.delete('/:id', protect, staffOrAdmin, deleteCategory);

export default router;
