// backend/src/routes/report.routes.ts
import { Router } from "express";
import { generateReport, getReportUsers } from "../controllers/report.controller";
import { protect, reportsAccess } from "../middlewares/auth.middleware";

const router = Router();

// Every staff-side role can hit this route — role-based scoping (own data
// vs any user vs org-wide) happens inside the controller.
router.use(protect, reportsAccess);

router.get("/users", getReportUsers); // user picker for scoped reports
router.get("/", generateReport);

export default router;
