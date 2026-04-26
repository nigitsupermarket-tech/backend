// backend/src/routes/analytics.routes.ts
import { Router } from "express";
import {
  getDashboardStats, getRevenueChart, getTopProducts,
  getInventoryReport, getCustomerStats, getOrdersByStatus, getStaffStats,
} from "../controllers/analytics.controller";
import { protect, staffOrAdmin, adminOnly, salesOrAdmin } from "../middlewares/auth.middleware";

const router = Router();

router.use(protect, staffOrAdmin);

router.get("/dashboard", getDashboardStats);
router.get("/revenue", getRevenueChart);
router.get("/top-products", getTopProducts);
router.get("/inventory", getInventoryReport);
router.get("/customers", getCustomerStats);
router.get("/orders-by-status", getOrdersByStatus);

// Admin + Sales manager only
router.get("/staff-stats", salesOrAdmin, getStaffStats);

export default router;
