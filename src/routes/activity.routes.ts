// backend/src/routes/activity.routes.ts
import { Router } from "express";
import { getActivities, getRecentActivities } from "../controllers/activity.controller";
import { protect, adminOnly } from "../middlewares/auth.middleware";

const router = Router();

router.use(protect, adminOnly);
router.get("/", getActivities);
router.get("/recent", getRecentActivities);

export default router;
