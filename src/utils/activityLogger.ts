// backend/src/utils/activityLogger.ts
// Central fire-and-forget activity logger — never throws, never blocks responses.

import prisma from "../config/database";
import { Request } from "express";

interface LogParams {
  userId?: string | null;
  action: string;
  entity?: string;
  entityId?: string;
  metadata?: Record<string, any>;
  req?: Request;
}

export function log(params: LogParams): void {
  const ipAddress =
    (params.req?.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() ||
    params.req?.socket?.remoteAddress ||
    undefined;

  const userAgent = params.req?.headers["user-agent"] as string | undefined;

  prisma.activityLog
    .create({
      data: {
        userId: params.userId || undefined,
        action: params.action,
        entity: params.entity,
        entityId: params.entityId,
        metadata: params.metadata,
        ipAddress,
        userAgent,
      },
    })
    .catch((err) =>
      console.error("[activityLogger] Failed to write log:", err?.message),
    );
}
