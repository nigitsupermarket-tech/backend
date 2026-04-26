import { Router } from 'express';
import { getCart, addToCart, updateCartItem, removeCartItem, clearCart, mergeCart } from '../controllers/cart.controller';
import { protect, optionalAuth } from '../middlewares/auth.middleware';

const router = Router();

router.get('/', optionalAuth, getCart);
router.post('/', optionalAuth, addToCart);
router.post('/merge', protect, mergeCart);
router.put('/:itemId', optionalAuth, updateCartItem);
router.delete('/:itemId', optionalAuth, removeCartItem);
router.delete('/', optionalAuth, clearCart);

export default router;
