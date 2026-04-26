import { Router } from 'express';
import {
  getBlogPosts, getBlogPost, createBlogPost, updateBlogPost, deleteBlogPost,
  getBlogCategories, createBlogCategory, updateBlogCategory, deleteBlogCategory,
} from '../controllers/blog.controller';
import { protect, staffOrAdmin, adminOnly } from '../middlewares/auth.middleware';

const router = Router();

// Public
router.get('/posts', getBlogPosts);
router.get('/posts/:id', getBlogPost);
router.get('/categories', getBlogCategories);

// Staff/Admin
router.post('/posts', protect, staffOrAdmin, createBlogPost);
router.put('/posts/:id', protect, staffOrAdmin, updateBlogPost);
router.delete('/posts/:id', protect, staffOrAdmin, deleteBlogPost);

router.post('/categories', protect, staffOrAdmin, createBlogCategory);
router.put('/categories/:id', protect, staffOrAdmin, updateBlogCategory);
router.delete('/categories/:id', protect, adminOnly, deleteBlogCategory);

export default router;
