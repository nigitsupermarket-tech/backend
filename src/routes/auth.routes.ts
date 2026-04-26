import { Router } from "express";
import {
  register,
  login,
  logout,
  refreshToken,
  silentRefresh,
  verifyEmail,
  resendVerification,
  forgotPassword,
  resetPassword,
  getMe,
  updatePassword,
} from "../controllers/auth.controller";
import { protect } from "../middlewares/auth.middleware";
import {
  validateRegister,
  validateLogin,
  validateEmail,
  validateResetPassword,
  validateUpdatePassword,
} from "../middlewares/validation.middleware";

const router = Router();

// ── Public routes ─────────────────────────────────────────────────────────────
router.post("/register", validateRegister, register);
router.post("/login", validateLogin, login);
router.post("/verify-email", verifyEmail);
router.post("/resend-verification", validateEmail, resendVerification);
router.post("/forgot-password", validateEmail, forgotPassword);
router.post("/reset-password", validateResetPassword, resetPassword);
router.post("/refresh-token", refreshToken);

// ✅ SESSION PERSISTENCE: Silent refresh — called by the frontend on every app
// boot to proactively restore a session using the httpOnly refresh cookie.
// This avoids the 401 → interceptor → refresh dance on page load.
router.get("/silent-refresh", silentRefresh);

// ── Protected routes ──────────────────────────────────────────────────────────
router.use(protect);

router.get("/me", getMe);
router.post("/logout", logout);
router.put("/update-password", validateUpdatePassword, updatePassword);

export default router;
