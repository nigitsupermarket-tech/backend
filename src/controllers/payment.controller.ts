import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import axios from 'axios';
import prisma from '../config/database';
import { AppError, NotFoundError } from '../utils/appError';
import { AuthRequest } from '../middlewares/auth.middleware';
import { sendOrderConfirmationEmail } from '../services/email.service';

const PAYSTACK_SECRET = () => process.env.PAYSTACK_SECRET_KEY!;
const paystackHeaders = () => ({
  Authorization: `Bearer ${PAYSTACK_SECRET()}`,
  'Content-Type': 'application/json',
});

// POST /api/v1/payment/initialize
export const initializePayment = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { orderId } = req.body;

    const order = await prisma.order.findUnique({ where: { id: orderId } });
    if (!order) throw new NotFoundError('Order not found');
    if (order.userId !== req.user?.userId) throw new AppError('Not authorized', 403);
    if (order.paymentStatus === 'PAID') throw new AppError('Order is already paid', 400);
    if (order.paymentMethod !== 'PAYSTACK') throw new AppError('This order does not use Paystack', 400);

    const reference = `SBW-${order.orderNumber}-${Date.now()}`;

    const response = await axios.post(
      'https://api.paystack.co/transaction/initialize',
      {
        email: order.customerEmail,
        amount: Math.round(order.total * 100), // Paystack expects amount in kobo
        reference,
        callback_url: `${process.env.CLIENT_URL}/checkout/verify?reference=${reference}`,
        metadata: {
          orderId: order.id,
          orderNumber: order.orderNumber,
          customerId: req.user?.userId,
        },
      },
      { headers: paystackHeaders() }
    );

    // Save reference on order
    await prisma.order.update({ where: { id: orderId }, data: { paymentReference: reference } });

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

// GET /api/v1/payment/verify/:reference
export const verifyPayment = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { reference } = req.params;

    const response = await axios.get(
      `https://api.paystack.co/transaction/verify/${reference}`,
      { headers: paystackHeaders() }
    );

    const { status, metadata, amount } = response.data.data;

    if (status === 'success' && metadata?.orderId) {
      const order = await prisma.order.findUnique({ where: { id: metadata.orderId } });

      if (order && order.paymentStatus !== 'PAID') {
        await prisma.$transaction([
          prisma.order.update({
            where: { id: metadata.orderId },
            data: {
              paymentStatus: 'PAID',
              status: 'CONFIRMED',
              paidAt: new Date(),
              confirmedAt: new Date(),
            },
          }),
          prisma.orderStatusHistory.create({
            data: {
              orderId: metadata.orderId,
              status: 'CONFIRMED',
              notes: `Payment verified — Ref: ${reference}`,
            },
          }),
        ]);

        // Send confirmation email (non-blocking)
        sendOrderConfirmationEmail(
          order.customerEmail,
          order.customerName,
          order.orderNumber,
          order.total
        ).catch(console.error);
      }
    }

    res.status(200).json({ success: true, data: response.data.data });
  } catch (error) {
    next(error);
  }
};

// POST /api/v1/payment/webhook  (Paystack calls this)
export const paystackWebhook = async (req: Request, res: Response, next: NextFunction) => {
  try {
    // Validate signature
    const signature = req.headers['x-paystack-signature'] as string;
    const hash = crypto
      .createHmac('sha512', PAYSTACK_SECRET())
      .update(JSON.stringify(req.body))
      .digest('hex');

    if (hash !== signature) {
      return res.status(400).json({ success: false, message: 'Invalid signature' });
    }

    const { event, data } = req.body;

    if (event === 'charge.success') {
      const { reference, metadata } = data;

      if (metadata?.orderId) {
        const order = await prisma.order.findUnique({ where: { id: metadata.orderId } });

        if (order && order.paymentStatus !== 'PAID') {
          await prisma.$transaction([
            prisma.order.update({
              where: { id: metadata.orderId },
              data: {
                paymentStatus: 'PAID',
                status: 'CONFIRMED',
                paidAt: new Date(),
                confirmedAt: new Date(),
              },
            }),
            prisma.orderStatusHistory.create({
              data: {
                orderId: metadata.orderId,
                status: 'CONFIRMED',
                notes: `Webhook payment confirmed — Ref: ${reference}`,
              },
            }),
          ]);
        }
      }
    }

    if (event === 'refund.processed') {
      const { metadata, amount } = data;
      if (metadata?.orderId) {
        await prisma.order.update({
          where: { id: metadata.orderId },
          data: { paymentStatus: 'REFUNDED', status: 'REFUNDED' },
        });
      }
    }

    res.status(200).json({ success: true });
  } catch (error) {
    next(error);
  }
};
