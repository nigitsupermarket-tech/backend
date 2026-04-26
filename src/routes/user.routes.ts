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
} from "../middlewares/auth.middleware";

const router = Router();

// All routes require authentication
router.use(protect);

// Admin/Staff
router.get("/", staffOrAdmin, getUsers);
router.post("/", adminOnly, createUser); // Only admin creates staff/admin users

// Self or Admin
router.get("/:id", getUser);
router.put("/:id", updateUser);
router.delete("/:id", adminOnly, deleteUser);

export default router;
