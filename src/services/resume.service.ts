import { getRecord } from "./dynamo.service";
import { extractStructuredData } from "./ai.service";
import { logger } from "../lib/logger";
import type { SchemaShorthand } from "../schemas/parse.schema";

export type ParseResult =
  | { outcome: "not_found" }
  | { outcome: "pending" }
  | { outcome: "failed" }
  | { outcome: "ai_error" }
  | { outcome: "success"; data: unknown };

export async function parseResume(
  resumeId: string,
  schema: Record<string, SchemaShorthand>
): Promise<ParseResult> {
  const record = await getRecord(resumeId);

  if (!record) {
    return { outcome: "not_found" };
  }

  if (record.status === "pending") {
    return { outcome: "pending" };
  }

  if (record.status === "failed") {
    return { outcome: "failed" };
  }

  // status === "ready"
  if (!record.extractedText) {
    // defensive — should never happen if status is "ready"
    logger.error("Record marked ready but extractedText missing", { resumeId });
    return { outcome: "ai_error" };
  }

  try {
    const data = await extractStructuredData(record.extractedText, schema);
    return { outcome: "success", data };
  } catch (err) {
    logger.error("AI extraction failed", { resumeId, errorMessage: (err as Error).message });
    return { outcome: "ai_error" };
  }
}
