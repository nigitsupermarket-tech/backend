// backend/src/utils/password.ts
//
// One place for the password-strength rule so every path that sets a
// password (register, reset link, change password, admin-created account,
// admin reset) enforces the same thing. Mirrors the express-validator rules
// in middlewares/validation.middleware.ts.
import { AppError } from "./appError";

export function passwordProblem(password: unknown): string | null {
  if (typeof password !== "string" || password.length === 0)
    return "Password is required";
  if (password.length < 8) return "Password must be at least 8 characters";
  if (!/[A-Z]/.test(password))
    return "Password must contain at least one uppercase letter (A-Z)";
  if (!/[a-z]/.test(password))
    return "Password must contain at least one lowercase letter (a-z)";
  if (!/[0-9]/.test(password))
    return "Password must contain at least one number (0-9)";
  if (!/[!@#$%^&*(),.?":{}|<>]/.test(password))
    return "Password must contain at least one special character (!@#$%^&*)";
  return null;
}

export function assertStrongPassword(password: unknown): asserts password is string {
  const problem = passwordProblem(password);
  if (problem) throw new AppError(problem, 400);
}

// Fields to clear whenever a password changes, so existing sessions can't be
// silently refreshed afterwards. `previousRefreshToken*` is the short grace
// window kept for rotating refresh tokens — it must die too, or the old
// session could still refresh for a few minutes after the change.
export const REVOKE_SESSIONS = {
  refreshToken: null,
  previousRefreshToken: null,
  previousRefreshTokenExpiresAt: null,
} as const;
