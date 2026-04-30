import { Request, Response, NextFunction } from "express";
import crypto from "crypto";
import axios from "axios";
import prisma from "../config/database";
import { AppError, NotFoundError } from "../utils/appError";
import { AuthRequest } from "../middlewares/auth.middleware";
import {
  sendOrderConfirmationEmail,
  sendBankTransferInstructionsEmail,
  sendBankTransferConfirmedEmail,
} from "../services/email.service";

const PAYSTACK_SECRET = () => process.env.PAYSTACK_SECRET_KEY!;
const paystackHeaders = () => ({
  Authorization: `Bearer ${PAYSTACK_SECRET()}`,
  "Content-Type": "application/json",
});

// ─── Bank account details from env ───────────────────────────────────────────
const getBankConfig = () => ({
  bankName: process.env.BANK_NAME || "First Bank Nigeria",
  accountName: process.env.BANK_ACCOUNT_NAME || "NigiTriple Industry Ltd",
  accountNumber: process.env.BANK_ACCOUNT_NUMBER || "0000000000",
  sortCode: process.env.BANK_SORT_CODE || "", // optional
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/v1/payment/bank-details
// Returns bank details for display on the frontend (no auth required)
// ─────────────────────────────────────────────────────────────────────────────
export const getBankDetails = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    res.status(200).json({ success: true, data: getBankConfig() });
  } catch (error) {
    next(error);
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/v1/payment/initialize
// Initialises a Paystack transaction for a PAYSTACK order
// ─────────────────────────────────────────────────────────────────────────────
export const initializePayment = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const { orderId } = req.body;

    const order = await prisma.order.findUnique({ where: { id: orderId } });
    if (!order) throw new NotFoundError("Order not found");
    if (order.userId !== req.user?.userId)
      throw new AppError("Not authorized", 403);
    if (order.paymentStatus === "PAID")
      throw new AppError("Order is already paid", 400);
    if (order.paymentMethod !== "PAYSTACK")
      throw new AppError("This order does not use Paystack", 400);

    const reference = `NGT-${order.orderNumber}-${Date.now()}`;

    // ── Paystack API call with debug logging ─────────────────────────────────
    const paystackPayload = {
      email: order.customerEmail,
      amount: Math.round(order.total * 100), // kobo
      reference,
      callback_url: `${process.env.CLIENT_URL}/checkout/verify`,
      metadata: {
        orderId: order.id,
        orderNumber: order.orderNumber,
        customerId: req.user?.userId,
      },
    };

    console.log("[Paystack] Initializing payment:", {
      orderId: order.id,
      orderNumber: order.orderNumber,
      email: order.customerEmail,
      amount: paystackPayload.amount,
      reference,
      callback_url: paystackPayload.callback_url,
      secretKeyPresent: !!process.env.PAYSTACK_SECRET_KEY,
      secretKeyPrefix: process.env.PAYSTACK_SECRET_KEY?.slice(0, 8),
    });

    let response: any;
    try {
      response = await axios.post(
        "https://api.paystack.co/transaction/initialize",
        paystackPayload,
        { headers: paystackHeaders(), timeout: 30000 },
      );
      console.log("[Paystack] Initialize success:", {
        status: response.data?.status,
        hasAuthUrl: !!response.data?.data?.authorization_url,
      });
    } catch (paystackErr: any) {
      console.error("[Paystack] Initialize FAILED:", {
        code: paystackErr?.code,
        message: paystackErr?.message,
        responseStatus: paystackErr?.response?.status,
        responseData: paystackErr?.response?.data,
        isTimeout: paystackErr?.code === "ECONNABORTED",
      });
      throw new AppError(
        paystackErr?.code === "ECONNABORTED"
          ? "Payment gateway timed out. Please try again."
          : `Payment gateway error: ${paystackErr?.response?.data?.message || paystackErr.message}`,
        502,
      );
    }
    // ─────────────────────────────────────────────────────────────────────────

    await prisma.order.update({
      where: { id: orderId },
      data: { paymentReference: reference },
    });

    res.status(200).json({
      success: true,
      data: {
        authorizationUrl: response.data.data.authorization_url,
        accessCode: response.data.data.access_code,
        reference,
      },
    });
  } catch (error) {
    next(error);
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/v1/payment/verify/:reference
// Verifies a Paystack transaction after redirect
// ─────────────────────────────────────────────────────────────────────────────
export const verifyPayment = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const { reference } = req.params;

    const response = await axios.get(
      `https://api.paystack.co/transaction/verify/${reference}`,
      { headers: paystackHeaders() },
    );

    const { status, metadata } = response.data.data;

    if (status === "success" && metadata?.orderId) {
      const order = await prisma.order.findUnique({
        where: { id: metadata.orderId },
      });

      if (order && order.paymentStatus !== "PAID") {
        await prisma.$transaction([
          prisma.order.update({
            where: { id: metadata.orderId },
            data: {
              paymentStatus: "PAID",
              status: "CONFIRMED",
              paidAt: new Date(),
              confirmedAt: new Date(),
            },
          }),
          prisma.orderStatusHistory.create({
            data: {
              orderId: metadata.orderId,
              status: "CONFIRMED",
              notes: `Payment verified via Paystack — Ref: ${reference}`,
            },
          }),
        ]);

        sendOrderConfirmationEmail(
          order.customerEmail,
          order.customerName,
          order.orderNumber,
          order.total,
        ).catch(console.error);
      }
    }

    res.status(200).json({ success: true, data: response.data.data });
  } catch (error) {
    next(error);
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/v1/payment/webhook
// Paystack calls this — raw body required for HMAC verification
// ─────────────────────────────────────────────────────────────────────────────
export const paystackWebhook = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const signature = req.headers["x-paystack-signature"] as string;
    const hash = crypto
      .createHmac("sha512", PAYSTACK_SECRET())
      .update(JSON.stringify(req.body))
      .digest("hex");

    if (hash !== signature) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid signature" });
    }

    const { event, data } = req.body;

    if (event === "charge.success") {
      const { reference, metadata } = data;

      if (metadata?.orderId) {
        const order = await prisma.order.findUnique({
          where: { id: metadata.orderId },
        });

        if (order && order.paymentStatus !== "PAID") {
          await prisma.$transaction([
            prisma.order.update({
              where: { id: metadata.orderId },
              data: {
                paymentStatus: "PAID",
                status: "CONFIRMED",
                paidAt: new Date(),
                confirmedAt: new Date(),
              },
            }),
            prisma.orderStatusHistory.create({
              data: {
                orderId: metadata.orderId,
                status: "CONFIRMED",
                notes: `Webhook: payment confirmed via Paystack — Ref: ${reference}`,
              },
            }),
          ]);
        }
      }
    }

    if (event === "refund.processed") {
      const { metadata } = data;
      if (metadata?.orderId) {
        await prisma.order.update({
          where: { id: metadata.orderId },
          data: { paymentStatus: "REFUNDED", status: "REFUNDED" },
        });
      }
    }

    res.status(200).json({ success: true });
  } catch (error) {
    next(error);
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/v1/payment/bank-transfer/notify
// Called immediately after a BANK_TRANSFER order is created.
// Sends the customer an email with bank account details + order reference.
// ─────────────────────────────────────────────────────────────────────────────
export const notifyBankTransfer = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const { orderId } = req.body;

    const order = await prisma.order.findUnique({ where: { id: orderId } });
    if (!order) throw new NotFoundError("Order not found");
    if (order.userId !== req.user?.userId)
      throw new AppError("Not authorized", 403);
    if (order.paymentMethod !== "BANK_TRANSFER")
      throw new AppError("This order does not use Bank Transfer", 400);

    const bank = getBankConfig();

    // Send instructions email (non-blocking)
    sendBankTransferInstructionsEmail(
      order.customerEmail,
      order.customerName,
      order.orderNumber,
      order.total,
      bank,
    ).catch(console.error);

    res.status(200).json({
      success: true,
      message: "Bank transfer instructions sent to your email",
      data: { bank, orderNumber: order.orderNumber, amount: order.total },
    });
  } catch (error) {
    next(error);
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/v1/payment/bank-transfer/proof
// Customer uploads proof of payment (Cloudinary URL from the upload endpoint).
// Sets paymentStatus → AWAITING_PROOF so staff know to review.
// ─────────────────────────────────────────────────────────────────────────────
export const submitProofOfPayment = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const { orderId, proofUrl } = req.body;

    if (!proofUrl)
      throw new AppError("Proof of payment image URL is required", 400);

    const order = await prisma.order.findUnique({ where: { id: orderId } });
    if (!order) throw new NotFoundError("Order not found");
    if (order.userId !== req.user?.userId)
      throw new AppError("Not authorized", 403);
    if (order.paymentMethod !== "BANK_TRANSFER")
      throw new AppError("This order does not use Bank Transfer", 400);
    if (order.paymentStatus === "PAID")
      throw new AppError("This order has already been confirmed as paid", 400);

    await prisma.$transaction([
      prisma.order.update({
        where: { id: orderId },
        data: {
          proofOfPaymentUrl: proofUrl,
          proofSubmittedAt: new Date(),
          paymentStatus: "AWAITING_PROOF",
        },
      }),
      prisma.orderStatusHistory.create({
        data: {
          orderId,
          status: order.status, // status stays the same — staff still needs to confirm
          notes: "Customer submitted proof of bank transfer payment.",
        },
      }),
    ]);

    res.status(200).json({
      success: true,
      message:
        "Proof of payment submitted. Our team will verify and confirm your order shortly.",
    });
  } catch (error) {
    next(error);
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/v1/payment/bank-transfer/confirm
// Staff/Admin confirms that a bank transfer has been received.
// Sets paymentStatus → PAID and order status → CONFIRMED.
// ─────────────────────────────────────────────────────────────────────────────
export const confirmBankTransfer = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const role = req.user?.role;
    if (role !== "ADMIN" && role !== "STAFF")
      throw new AppError("Only staff can confirm bank transfers", 403);

    const { orderId, notes } = req.body;

    const order = await prisma.order.findUnique({ where: { id: orderId } });
    if (!order) throw new NotFoundError("Order not found");
    if (order.paymentMethod !== "BANK_TRANSFER")
      throw new AppError("This order does not use Bank Transfer", 400);
    if (order.paymentStatus === "PAID")
      throw new AppError("Payment has already been confirmed", 400);

    await prisma.$transaction([
      prisma.order.update({
        where: { id: orderId },
        data: {
          paymentStatus: "PAID",
          status: "CONFIRMED",
          paidAt: new Date(),
          confirmedAt: new Date(),
          adminNotes: notes
            ? `[Bank Transfer Confirmed] ${notes}`
            : "[Bank Transfer Confirmed by staff]",
        },
      }),
      prisma.orderStatusHistory.create({
        data: {
          orderId,
          status: "CONFIRMED",
          notes: notes
            ? `Bank transfer confirmed by staff. Note: ${notes}`
            : "Bank transfer payment confirmed by staff.",
        },
      }),
    ]);

    // Notify customer
    sendBankTransferConfirmedEmail(
      order.customerEmail,
      order.customerName,
      order.orderNumber,
      order.total,
    ).catch(console.error);

    res.status(200).json({
      success: true,
      message: "Bank transfer confirmed. Order is now CONFIRMED.",
    });
  } catch (error) {
    next(error);
  }
};
