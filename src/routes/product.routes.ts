// ============================================================
// PRODUCT ROUTES  →  src/routes/product.routes.ts
// ============================================================
import { Router } from "express";
import {
  getProducts,
  getProduct,
  getShippableProducts,
  createProduct,
  updateProduct,
  deleteProduct,
  getFeaturedProducts,
  getNewArrivals,
  updateInventory,
} from "../controllers/product.controller";
import {
  protect,
  staffOrAdmin,
  adminOrManager,
} from "../middlewares/auth.middleware";

const router = Router();

router.get("/", getProducts);
router.get("/products", getShippableProducts);
router.get("/featured", getFeaturedProducts);
router.get("/new-arrivals", getNewArrivals);
router.get("/:id", getProduct);
router.post("/", protect, staffOrAdmin, createProduct);
router.put("/:id", protect, staffOrAdmin, updateProduct);
router.put("/:id/inventory", protect, staffOrAdmin, updateInventory);
// Only ADMIN and MANAGER can permanently (hard) delete products
router.delete("/:id", protect, adminOrManager, deleteProduct);

export default router;
