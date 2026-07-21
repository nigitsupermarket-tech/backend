// backend/src/app.ts
import express, { Application, Request, Response, NextFunction } from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import dotenv from "dotenv";
import prisma from "./config/database";

// Import routes
import authRoutes from "./routes/auth.routes";
import userRoutes from "./routes/user.routes";
import productRoutes from "./routes/product.routes";
import categoryRoutes from "./routes/category.routes";
import brandRoutes from "./routes/brand.routes";
import cartRoutes from "./routes/cart.routes";
import orderRoutes from "./routes/order.routes";
import reviewRoutes from "./routes/review.routes";
import discountRoutes from "./routes/discount.routes";
import shippingRoutes from "./routes/shipping.routes";
import blogRoutes from "./routes/blog.routes";
import uploadRoutes from "./routes/upload.routes";
import paymentRoutes from "./routes/payment.routes";
import settingsRoutes from "./routes/settings.routes";
import analyticsRoutes from "./routes/analytics.routes";
import marketingRoutes from "./routes/marketing.routes";
import exportRoutes from "./routes/export.routes";
import activityRoutes from "./routes/activity.routes";
import stockApprovalRoutes from "./routes/stockApproval.routes";
import reportRoutes from "./routes/report.routes";
import addressRoutes from "./routes/address.routes";
import posRoutes from "./routes/pos.routes";
import wishlistRoutes from "./routes/wishlist.routes";
import consultationRoutes from "./routes/consultation.routes";
import quotationRoutes from "./routes/quotation.routes";
import contactRoutes from "./routes/contact.routes";

// Import middleware
import { errorHandler } from "./middlewares/errorHandler";
import { notFound } from "./middlewares/notFound";

// Load environment variables
dotenv.config();

// ── Defensive request-logger loader ─────────────────────────────────────────
// A static `import morgan from "morgan"` gets executed the moment this
// module loads, before any try/catch can run — so if morgan (or one of its
// OWN dependencies, e.g. "basic-auth") is ever missing from the deployed
// bundle, the entire function crashes on every single request, regardless
// of whether logging is actually reachable at runtime. A lazy require()
// inside try/catch can actually be caught, so a broken/missing logging
// dependency degrades to "no access logs" instead of "the whole API is down".
function morganMiddleware(format: "dev" | "combined") {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const morgan = require("morgan");
    return morgan(format);
  } catch (err) {
    console.error(
      `[startup] morgan unavailable, request logging disabled:`,
      err,
    );
    return (_req: Request, _res: Response, next: NextFunction) => next();
  }
}

const app: Application = express();

const API_PREFIX = "/api/v1";

// ============================================
// CORS (must come before everything)
// ============================================

const normalizeOrigin = (url?: string) =>
  url?.trim().replace(/\/+$/, "").toLowerCase();

const allowedOrigins = [
  process.env.CLIENT_URL,
  process.env.CLIENT_URL_2,
  process.env.CLIENT_URL_3,
  process.env.CLIENT_URL_4,
]
  .filter(Boolean)
  .map((url) => normalizeOrigin(url) as string);

const corsOptions = {
  origin: (
    origin: string | undefined,
    callback: (err: Error | null, allow?: boolean) => void,
  ) => {
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes(normalizeOrigin(origin) as string))
      return callback(null, true);
    console.warn(
      `[CORS] Rejected origin "${origin}". Allowed: ${allowedOrigins.join(", ") || "(none configured)"}`,
    );
    callback(new Error(`CORS: origin ${origin} not allowed`));
  },
  credentials: true,
  optionsSuccessStatus: 200,
};
app.use(cors(corsOptions));

// ============================================
// GLOBAL MIDDLEWARE
// ============================================
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));
app.use(cookieParser());

if (process.env.NODE_ENV === "development") {
  app.use(morganMiddleware("dev"));
} else {
  app.use(morganMiddleware("combined"));
}

// ============================================
// HEALTH CHECKS
// ============================================

app.get("/health", (req: Request, res: Response) => {
  res.status(200).json({
    success: true,
    message: "Server is running",
    timestamp: new Date().toISOString(),
  });
});

app.get("/", async (req: Request, res: Response) => {
  try {
    await prisma.$connect();
    res.status(200).json({
      success: true,
      message: "🛒 NigitTriple Supermarket API is live",
      version: "2.0.0",
      database: "connected",
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    res.status(200).json({
      success: true,
      message: "🛒 NigitTriple Supermarket API is live",
      version: "2.0.0",
      database: "disconnected",
      timestamp: new Date().toISOString(),
    });
  }
});

// ============================================
// API ROUTES
// ============================================

app.use(`${API_PREFIX}/auth`, authRoutes);
app.use(`${API_PREFIX}/users`, userRoutes);
app.use(`${API_PREFIX}/products`, productRoutes);
app.use(`${API_PREFIX}/stock-approvals`, stockApprovalRoutes);
app.use(`${API_PREFIX}/categories`, categoryRoutes);
app.use(`${API_PREFIX}/brands`, brandRoutes);
app.use(`${API_PREFIX}/cart`, cartRoutes);
app.use(`${API_PREFIX}/orders`, orderRoutes);
app.use(`${API_PREFIX}/reviews`, reviewRoutes);
app.use(`${API_PREFIX}/discounts`, discountRoutes);
app.use(`${API_PREFIX}/shipping`, shippingRoutes);
app.use(`${API_PREFIX}/blog`, blogRoutes);
app.use(`${API_PREFIX}/upload`, uploadRoutes);
app.use(`${API_PREFIX}/payment`, paymentRoutes); // webhook uses raw(), rest use json() internally
app.use(`${API_PREFIX}/settings`, settingsRoutes);
app.use(`${API_PREFIX}/analytics`, analyticsRoutes);
app.use(`${API_PREFIX}/activities`, activityRoutes);
app.use(`${API_PREFIX}/reports`, reportRoutes);
app.use(`${API_PREFIX}/marketing`, marketingRoutes);
app.use(`${API_PREFIX}/export`, exportRoutes);
app.use(`${API_PREFIX}/addresses`, addressRoutes);
app.use(`${API_PREFIX}/pos`, posRoutes);
app.use(`${API_PREFIX}/wishlist`, wishlistRoutes);
app.use(`${API_PREFIX}/consultations`, consultationRoutes);
app.use(`${API_PREFIX}/quotations`, quotationRoutes);
app.use(API_PREFIX, contactRoutes);

// ============================================
// ERROR HANDLING
// ============================================

app.use(notFound);
app.use(errorHandler);

export default app;
