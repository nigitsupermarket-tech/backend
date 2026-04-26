import nodemailer from "nodemailer";

// ✅ FIX: Centralised brand colours — was using #C71EFF (purple) which belongs
// to a different project (EquipUniverse/SuperBusinessWoman). NigitTriple is green.
const BRAND_GREEN = "#166534"; // green-800
const BRAND_GREEN_LIGHT = "#16a34a"; // green-600
const BRAND_GOLD = "#d97706"; // amber-600

const createTransporter = () => {
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT),
    secure: Number(process.env.SMTP_PORT) === 465,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASSWORD,
    },
  });
};

interface EmailData {
  to: string;
  subject: string;
  html: string;
  text?: string;
}

const baseStyles = `
  body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; margin: 0; padding: 0; background: #f9fafb; }
  .wrapper { padding: 32px 16px; }
  .container { max-width: 600px; margin: 0 auto; }
  .header { background: ${BRAND_GREEN}; padding: 28px 32px; text-align: center; border-radius: 8px 8px 0 0; }
  .header h1 { margin: 0; color: #fff; font-size: 24px; font-weight: 700; letter-spacing: -0.5px; }
  .header span { color: ${BRAND_GOLD}; }
  .content { padding: 32px; background: #fff; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 8px 8px; }
  .content h2 { margin-top: 0; color: #111827; }
  .content p { color: #4b5563; margin: 0 0 16px; }
  .button { display: inline-block; padding: 13px 32px; background: ${BRAND_GREEN_LIGHT}; color: #fff !important; text-decoration: none; border-radius: 8px; font-weight: 600; font-size: 15px; }
  .link-fallback { word-break: break-all; color: ${BRAND_GREEN_LIGHT}; font-size: 13px; }
  .note { color: #9ca3af; font-size: 13px; }
  .footer { text-align: center; padding: 20px; color: #9ca3af; font-size: 13px; }
`;

export async function sendEmail(data: EmailData): Promise<void> {
  try {
    const transporter = createTransporter();
    await transporter.sendMail({
      from: `${process.env.EMAIL_FROM_NAME || "Nigittriple Industry"} <${process.env.EMAIL_FROM}>`,
      to: data.to,
      subject: data.subject,
      html: data.html,
      text: data.text,
    });
    console.log(`✉️  Email sent to ${data.to}: ${data.subject}`);
  } catch (error) {
    console.error("Email sending error:", error);
    throw new Error("Failed to send email");
  }
}

/**
 * Verification email — sent on register and resend-verification
 */
export async function sendVerificationEmail(
  email: string,
  name: string,
  verificationToken: string,
): Promise<void> {
  const verificationUrl = `${process.env.CLIENT_URL}/verify-email?token=${verificationToken}`;

  const html = `
    <!DOCTYPE html><html><head><meta charset="utf-8"><style>${baseStyles}</style></head>
    <body><div class="wrapper"><div class="container">
      <div class="header"><h1>Nigit<span>Triple</span> Industry</h1></div>
      <div class="content">
        <h2>Welcome, ${name}!</h2>
        <p>Thank you for registering. Please verify your email address to activate your account.</p>
        <p style="text-align:center;margin:28px 0;">
          <a href="${verificationUrl}" class="button">Verify Email Address</a>
        </p>
        <p>Or copy and paste this link into your browser:</p>
        <p><a href="${verificationUrl}" class="link-fallback">${verificationUrl}</a></p>
        <p class="note">This link expires in 24 hours. If you didn't create an account, you can safely ignore this email.</p>
      </div>
      <div class="footer"><p>© ${new Date().getFullYear()} Nigittriple Industry. All rights reserved.</p></div>
    </div></div></body></html>
  `;

  await sendEmail({
    to: email,
    subject: "Verify Your Email Address – Nigittriple Industry",
    html,
    text: `Welcome ${name}! Verify your email by visiting: ${verificationUrl}\n\nThis link expires in 24 hours.`,
  });
}

/**
 * Password reset email
 */
export async function sendPasswordResetEmail(
  email: string,
  name: string,
  resetToken: string,
): Promise<void> {
  const resetUrl = `${process.env.CLIENT_URL}/reset-password?token=${resetToken}`;

  const html = `
    <!DOCTYPE html><html><head><meta charset="utf-8"><style>${baseStyles}</style></head>
    <body><div class="wrapper"><div class="container">
      <div class="header"><h1>Nigit<span>Triple</span> Industry</h1></div>
      <div class="content">
        <h2>Reset Your Password</h2>
        <p>Hi ${name},</p>
        <p>We received a request to reset your password. Click the button below to set a new password:</p>
        <p style="text-align:center;margin:28px 0;">
          <a href="${resetUrl}" class="button">Reset Password</a>
        </p>
        <p>Or copy and paste this link:</p>
        <p><a href="${resetUrl}" class="link-fallback">${resetUrl}</a></p>
        <p class="note">This link expires in 1 hour. If you didn't request a password reset, please ignore this email — your password won't change.</p>
      </div>
      <div class="footer"><p>© ${new Date().getFullYear()} Nigittriple Industry. All rights reserved.</p></div>
    </div></div></body></html>
  `;

  await sendEmail({
    to: email,
    subject: "Reset Your Password – Nigittriple Industry",
    html,
    text: `Hi ${name}, reset your password by visiting: ${resetUrl}\n\nThis link expires in 1 hour.`,
  });
}

/**
 * Welcome email — sent after email verification succeeds
 */
export async function sendWelcomeEmail(
  email: string,
  name: string,
): Promise<void> {
  const shopUrl = `${process.env.CLIENT_URL}/products`;

  const html = `
    <!DOCTYPE html><html><head><meta charset="utf-8"><style>${baseStyles}</style></head>
    <body><div class="wrapper"><div class="container">
      <div class="header"><h1>Nigit<span>Triple</span> Industry</h1></div>
      <div class="content">
        <h2>Welcome to Nigittriple Industry! 🎉</h2>
        <p>Hi ${name},</p>
        <p>Your email has been verified and your account is now active. We're excited to have you!</p>
        <p>Browse hundreds of quality grocery products delivered fast across Port Harcourt and Rivers State.</p>
        <p style="text-align:center;margin:28px 0;">
          <a href="${shopUrl}" class="button">Start Shopping</a>
        </p>
        <p class="note">Questions? Contact us at <a href="mailto:${process.env.EMAIL_FROM}" style="color:${BRAND_GREEN_LIGHT};">${process.env.EMAIL_FROM}</a></p>
      </div>
      <div class="footer"><p>© ${new Date().getFullYear()} Nigittriple Industry. All rights reserved.</p></div>
    </div></div></body></html>
  `;

  await sendEmail({
    to: email,
    subject: "Welcome to Nigittriple Industry!",
    html,
    text: `Welcome ${name}! Your email is verified. Start shopping at ${shopUrl}`,
  });
}

/**
 * Order confirmation email
 */
export async function sendOrderConfirmationEmail(
  email: string,
  name: string,
  orderNumber: string,
  orderTotal: number,
): Promise<void> {
  const orderUrl = `${process.env.CLIENT_URL}/orders/${orderNumber}`;

  const html = `
    <!DOCTYPE html><html><head><meta charset="utf-8"><style>${baseStyles}
      .order-box { background:#f0fdf4; border:1px solid #86efac; border-radius:8px; padding:20px; margin:20px 0; }
    </style></head>
    <body><div class="wrapper"><div class="container">
      <div class="header"><h1>Order Confirmed ✓</h1></div>
      <div class="content">
        <p>Hi ${name},</p>
        <p>Thank you for your order! We've received it and will start processing shortly.</p>
        <div class="order-box">
          <p style="margin:0;"><strong>Order Number:</strong> ${orderNumber}</p>
          <p style="margin:8px 0 0;"><strong>Total:</strong> ₦${orderTotal.toLocaleString()}</p>
        </div>
        <p style="text-align:center;margin:28px 0;">
          <a href="${orderUrl}" class="button">View Order</a>
        </p>
      </div>
      <div class="footer"><p>© ${new Date().getFullYear()} Nigittriple Industry. All rights reserved.</p></div>
    </div></div></body></html>
  `;

  await sendEmail({
    to: email,
    subject: `Order Confirmed – ${orderNumber}`,
    html,
    text: `Hi ${name}, your order ${orderNumber} (₦${orderTotal.toLocaleString()}) is confirmed. View at: ${orderUrl}`,
  });
}

/**
 * Order tracking update email
 */
export async function sendTrackingUpdateEmail(
  email: string,
  name: string,
  orderNumber: string,
  status: string,
  message: string,
  location?: string,
): Promise<void> {
  const trackingUrl = `${process.env.CLIENT_URL}/orders/${orderNumber}/tracking`;

  const html = `
    <!DOCTYPE html><html><head><meta charset="utf-8"><style>${baseStyles}
      .update-box { background:#f0fdf4; border-left:4px solid ${BRAND_GREEN_LIGHT}; padding:20px; margin:20px 0; border-radius:0 8px 8px 0; }
    </style></head>
    <body><div class="wrapper"><div class="container">
      <div class="header"><h1>📦 Order Update</h1></div>
      <div class="content">
        <p>Hi ${name},</p>
        <p>Your order <strong>${orderNumber}</strong> has been updated:</p>
        <div class="update-box">
          <h3 style="margin:0 0 8px;color:${BRAND_GREEN};">🚚 ${status}</h3>
          <p style="margin:0 0 8px;">${message}</p>
          ${location ? `<p style="margin:0;color:#6b7280;"><strong>📍 Location:</strong> ${location}</p>` : ""}
        </div>
        <p style="text-align:center;margin:28px 0;">
          <a href="${trackingUrl}" class="button">Track Your Order</a>
        </p>
      </div>
      <div class="footer"><p>© ${new Date().getFullYear()} Nigittriple Industry. All rights reserved.</p></div>
    </div></div></body></html>
  `;

  await sendEmail({
    to: email,
    subject: `Order Update: ${status} – ${orderNumber}`,
    html,
    text: `Hi ${name}, your order ${orderNumber} update: ${status} - ${message}. Track at: ${trackingUrl}`,
  });
}

/**
 * Order shipped email
 */
export async function sendOrderShippedEmail(
  email: string,
  name: string,
  orderNumber: string,
  trackingNumber?: string,
  trackingUrl?: string,
  estimatedDelivery?: Date,
): Promise<void> {
  const orderTrackingUrl = `${process.env.CLIENT_URL}/orders/${orderNumber}/tracking`;

  const html = `
    <!DOCTYPE html><html><head><meta charset="utf-8"><style>${baseStyles}
      .ship-box { background:#f0fdf4; border:1px solid #86efac; border-radius:8px; padding:20px; margin:20px 0; }
    </style></head>
    <body><div class="wrapper"><div class="container">
      <div class="header"><h1>🚚 Your Order Has Shipped!</h1></div>
      <div class="content">
        <p>Hi ${name},</p>
        <p>Great news! Your order <strong>${orderNumber}</strong> is on its way.</p>
        <div class="ship-box">
          ${trackingNumber ? `<p style="margin:0 0 8px;"><strong>Tracking Number:</strong> ${trackingNumber}</p>` : ""}
          ${estimatedDelivery ? `<p style="margin:0;"><strong>Estimated Delivery:</strong> ${estimatedDelivery.toLocaleDateString("en-NG", { dateStyle: "full" })}</p>` : ""}
        </div>
        <p style="text-align:center;margin:28px 0;">
          <a href="${orderTrackingUrl}" class="button">Track on Our Site</a>
          ${trackingUrl ? `&nbsp;&nbsp;<a href="${trackingUrl}" class="button" style="background:#6b7280;">Track with Carrier</a>` : ""}
        </p>
      </div>
      <div class="footer"><p>© ${new Date().getFullYear()} Nigittriple Industry. All rights reserved.</p></div>
    </div></div></body></html>
  `;

  await sendEmail({
    to: email,
    subject: `Order Shipped – ${orderNumber}`,
    html,
    text: `Hi ${name}, order ${orderNumber} shipped! ${trackingNumber ? `Tracking: ${trackingNumber}. ` : ""}Track at: ${orderTrackingUrl}`,
  });
}

/**
 * Order delivered email
 */
export async function sendOrderDeliveredEmail(
  email: string,
  name: string,
  orderNumber: string,
): Promise<void> {
  const reviewUrl = `${process.env.CLIENT_URL}/orders/${orderNumber}`;

  const html = `
    <!DOCTYPE html><html><head><meta charset="utf-8"><style>${baseStyles}</style></head>
    <body><div class="wrapper"><div class="container">
      <div class="header"><h1>✅ Order Delivered!</h1></div>
      <div class="content">
        <p>Hi ${name},</p>
        <p>Your order <strong>${orderNumber}</strong> has been successfully delivered. We hope you love your purchase!</p>
        <p>If you have any questions or concerns, please don't hesitate to contact us.</p>
        <p style="text-align:center;margin:28px 0;">
          <a href="${reviewUrl}" class="button">Rate Your Purchase</a>
        </p>
        <p>Thank you for shopping with Nigittriple Industry!</p>
      </div>
      <div class="footer"><p>© ${new Date().getFullYear()} Nigittriple Industry. All rights reserved.</p></div>
    </div></div></body></html>
  `;

  await sendEmail({
    to: email,
    subject: `Order Delivered – ${orderNumber}`,
    html,
    text: `Hi ${name}, your order ${orderNumber} has been delivered! Thank you for shopping with us.`,
  });
}
