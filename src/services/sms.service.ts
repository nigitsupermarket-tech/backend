// backend/src/services/sms.service.ts
import axios from "axios";
import prisma from "../config/database";
import { AppError } from "../utils/appError";

export interface SmsSettings {
  smsProvider: string | null;
  smsApiKey: string | null;
  smsSenderId: string | null;
}

export interface SmsProviderStatus {
  provider: string;
  configured: boolean;
  reason?: string;
}

/** Providers with a real send implementation below. Others show a clear "not wired up" error. */
const IMPLEMENTED_PROVIDERS = ["TERMII"];

async function getSmsSettings(): Promise<SmsSettings> {
  const settings = await prisma.siteSetting.findFirst();
  return {
    smsProvider: (settings as any)?.smsProvider || "TERMII",
    smsApiKey: (settings as any)?.smsApiKey || null,
    smsSenderId: (settings as any)?.smsSenderId || null,
  };
}

/**
 * Checks whether bulk SMS can actually be sent right now — used by the
 * admin UI to show a clear banner *before* someone tries to send, instead
 * of only failing at send time.
 */
export async function getSmsProviderStatus(): Promise<SmsProviderStatus> {
  const { smsProvider, smsApiKey } = await getSmsSettings();
  const provider = smsProvider || "TERMII";

  if (!IMPLEMENTED_PROVIDERS.includes(provider)) {
    return {
      provider,
      configured: false,
      reason: `${provider} isn't wired up yet — only Termii is currently implemented. Switch providers or ask your developer to add ${provider} support.`,
    };
  }
  if (!smsApiKey) {
    return {
      provider,
      configured: false,
      reason: `No Termii API key is set. Add one in Settings → SMS to enable bulk SMS.`,
    };
  }
  return { provider, configured: true };
}

/** Throws a clear, user-facing AppError if SMS isn't ready to send — call before any bulk send. */
export async function assertSmsConfigured(): Promise<SmsSettings> {
  const settings = await getSmsSettings();
  const status = await getSmsProviderStatus();
  if (!status.configured) {
    throw new AppError(status.reason || "SMS sending is not configured.", 412);
  }
  return settings;
}

interface SendSmsInput {
  to: string; // phone number, e.g. 2348012345678
  message: string;
}

/**
 * Sends a single SMS via Termii (https://developers.termii.com/messaging).
 * Only called after assertSmsConfigured() has already verified credentials exist,
 * but still handles the "somehow got here unconfigured" case defensively.
 */
export async function sendSms({ to, message }: SendSmsInput): Promise<void> {
  const { smsProvider, smsApiKey, smsSenderId } = await getSmsSettings();
  const provider = smsProvider || "TERMII";

  if (!IMPLEMENTED_PROVIDERS.includes(provider)) {
    throw new AppError(
      `${provider} isn't wired up yet — only Termii is currently implemented.`,
      501,
    );
  }
  if (!smsApiKey) {
    throw new AppError(
      "No Termii API key is set. Add one in Settings → SMS.",
      412,
    );
  }

  try {
    const { data } = await axios.post(
      "https://api.ns.termii.com/api/sms/send",
      {
        to,
        from: smsSenderId || "N-Alert",
        sms: message,
        type: "plain",
        channel: "generic",
        api_key: smsApiKey,
      },
      { timeout: 15000 },
    );

    // Termii returns { code: "ok", message_id: "..." } on success and
    // { code: <error>, message: "..." } on failure — it still responds 200.
    if (data?.code && data.code !== "ok") {
      throw new Error(data.message || `Termii rejected the message (${data.code})`);
    }
  } catch (error: any) {
    if (error instanceof AppError) throw error;
    const providerMessage =
      error.response?.data?.message || error.message || "Unknown error";
    console.error(`Termii SMS send error for ${to}:`, providerMessage);
    throw new Error(`Failed to send SMS to ${to}: ${providerMessage}`);
  }
}
