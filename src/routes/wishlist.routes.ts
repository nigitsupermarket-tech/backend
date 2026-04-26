import { Router } from "express";
import {
  getWishlist,
  toggleWishlistItem,
  removeWishlistItem,
  clearWishlist,
} from "../controllers/wishlist.controller";
import { protect } from "../middlewares/auth.middleware";

const router = Router();

router.use(protect);

router.get("/", getWishlist);
router.post("/:productId", toggleWishlistItem);

// ✅ FIX: DELETE "/" must come BEFORE DELETE "/:productId"
router.delete("/", clearWishlist);
router.delete("/:productId", removeWishlistItem);

export default router;
