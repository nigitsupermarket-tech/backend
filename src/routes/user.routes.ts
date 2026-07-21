import { Router } from "express";
import {
  getUsers,
  getUser,
  createUser,
  updateUser,
  deleteUser,
} from "../controllers/user.controller";
import {
  protect,
  adminOnly,
  staffOrAdmin,
  adminOrManager,
} from "../middlewares/auth.middleware";

const router = Router();

// All routes require authentication
router.use(protect);

// Admin/Staff/Manager — list & create.
// MANAGER can list (ADMIN accounts filtered out in controller) and create
// staff/sales/manager accounts (never ADMIN — enforced in controller).
router.get("/", staffOrAdmin, getUsers);
router.post("/", adminOrManager, createUser);

// Self or Admin/Manager (role-change rules enforced in controller)
router.get("/:id", getUser);
router.put("/:id", updateUser);
router.delete("/:id", adminOnly, deleteUser);

export default router;
