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
import { protect, staffOrAdmin } from "../middlewares/auth.middleware";

const router = Router();

router.get("/", getProducts);
router.get("/products", getShippableProducts);
router.get("/featured", getFeaturedProducts);
router.get("/new-arrivals", getNewArrivals);
router.get("/:id", getProduct);
router.post("/", protect, staffOrAdmin, createProduct);
router.put("/:id", protect, staffOrAdmin, updateProduct);
router.put("/:id/inventory", protect, staffOrAdmin, updateInventory);
router.delete("/:id", protect, staffOrAdmin, deleteProduct);

export default router;
