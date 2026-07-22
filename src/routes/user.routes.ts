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
  adminOrManager,
  userManagementAccess,
} from "../middlewares/auth.middleware";

const router = Router();

// All routes require authentication
router.use(protect);

// User management home — ADMIN, MANAGER, and STAFF only (SALES/ACCOUNTANT
// have no user-management access at all). Each role's visibility into the
// list is scoped further inside the controller.
router.get("/", userManagementAccess, getUsers);

// Creating brand-new staff-side accounts stays ADMIN/MANAGER only — STAFF's
// capability is promoting/demoting EXISTING customers via PUT below, not
// minting new accounts.
router.post("/", adminOrManager, createUser);

// Fetch a single user — ADMIN/MANAGER/STAFF (hierarchy-scoped in controller)
// or the user viewing their own profile.
router.get("/:id", getUser);

// Role upgrade/demote + profile edits — hierarchy rules enforced in
// controller (ADMIN/MANAGER/STAFF for role changes, or self for profile
// fields).
router.put("/:id", updateUser);

router.delete("/:id", adminOnly, deleteUser);

export default router;
