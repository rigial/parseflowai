import { getRecord } from "./dynamo.service";
import { extractStructuredData, type AiTokenUsage } from "./ai.service";
import { logger } from "../lib/logger";
import type { SchemaShorthand } from "../schemas/parse.schema";

export type ParseResult =
  | { outcome: "not_found" }
  | { outcome: "unauthorized" }
  | { outcome: "pending" }
  | { outcome: "failed" }
  | { outcome: "ai_error" }
  | {
      outcome: "success";
      data: unknown;
      tokenUsage?: AiTokenUsage;
      durationMs?: number;
    };

export async function parseResume(
  resumeId: string,
  schema: Record<string, SchemaShorthand>,
  userId?: string
): Promise<ParseResult> {
  const startTime = Date.now();
  const record = await getRecord(resumeId);

  if (!record) {
    return { outcome: "not_found" };
  }

  // Enforce customer/user isolation
  if (userId) {
    const ownerId = record.userId || record.customerId;
    if (ownerId && ownerId !== 'anonymous' && ownerId !== userId) {
      logger.warn("Unauthorized resume access attempt", {
        resumeId,
        requestingUserId: userId,
        ownerId,
      });
      return { outcome: "unauthorized" };
    }
  }

  if (record.status === "pending") {
    return { outcome: "pending" };
  }

  if (record.status === "failed") {
    return { outcome: "failed" };
  }

  // status === "ready"
  if (!record.extractedText) {
    logger.error("Record marked ready but extractedText missing", { resumeId });
    return { outcome: "ai_error" };
  }

  try {
    const result = await extractStructuredData(record.extractedText, schema);
    const durationMs = Date.now() - startTime;
    return {
      outcome: "success",
      data: result.data,
      tokenUsage: result.tokenUsage,
      durationMs,
    };
  } catch (err) {
    logger.error("AI extraction failed", {
      resumeId,
      errorMessage: (err as Error).message,
    });
    return { outcome: "ai_error" };
  }
}
