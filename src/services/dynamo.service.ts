import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  PutCommand,
  GetCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";
import { env } from "../lib/env";
import { logger } from "../lib/logger";

export type ResumeStatus = "pending" | "ready" | "failed";

export interface ResumeRecord {
  resumeId: string; // PK — "res_" + nanoid
  customerId: string; // GSI PK — links to API key owner
  status: ResumeStatus; // updated by Extractor Lambda
  extractedText?: string; // written when status becomes "ready"
  fileName: string; // original uploaded filename
  fileSizeBytes: number; // for validation audit and analytics
  createdAt: string; // ISO 8601 string — GSI sort key
  expiresAt: number; // Unix timestamp in SECONDS (not ms) — DynamoDB TTL
}

const client = new DynamoDBClient({ region: env.AWS_REGION });
const dynamo = DynamoDBDocumentClient.from(client);

/**
 * Creates a new resume record in DynamoDB with "pending" status.
 * Called after generating the presigned upload URL.
 */
export async function createRecord(params: {
  resumeId: string;
  customerId: string;
  fileName: string;
  fileSizeBytes: number;
}): Promise<void> {
  const { resumeId, customerId, fileName, fileSizeBytes } = params;
  const createdAt = new Date().toISOString();
  const expiresAt = Math.floor(Date.now() / 1000) + env.RESUME_TTL_HOURS * 3600;

  const item: ResumeRecord = {
    resumeId,
    customerId,
    status: "pending",
    fileName,
    fileSizeBytes,
    createdAt,
    expiresAt,
  };

  try {
    await dynamo.send(
      new PutCommand({
        TableName: env.DYNAMODB_TABLE_NAME,
        Item: item,
      })
    );
  } catch (error) {
    const err = error as Error;
    logger.error("DynamoDB createRecord failed", {
      resumeId,
      errorCode: err.name,
    });
    throw error;
  }
}

/**
 * Retrieves a resume record by resumeId from DynamoDB.
 * Returns null if the item does not exist.
 */
export async function getRecord(
  resumeId: string
): Promise<ResumeRecord | null> {
  try {
    const response = await dynamo.send(
      new GetCommand({
        TableName: env.DYNAMODB_TABLE_NAME,
        Key: { resumeId },
      })
    );

    if (!response.Item) {
      return null;
    }

    return response.Item as ResumeRecord;
  } catch (error) {
    const err = error as Error;
    logger.error("DynamoDB getRecord failed", {
      resumeId,
      errorCode: err.name,
    });
    throw error;
  }
}

/**
 * Updates status and optionally extractedText of a resume record in DynamoDB.
 * Uses `#status` ExpressionAttributeName because `status` is a reserved word in DynamoDB.
 */
export async function updateRecord(params: {
  resumeId: string;
  status: ResumeStatus;
  extractedText?: string;
  fileSizeBytes?: number;
}): Promise<void> {
  const { resumeId, status, extractedText, fileSizeBytes } = params;

  const expressions: string[] = ["#status = :status"];
  const expressionAttributeNames: Record<string, string> = {
    "#status": "status",
  };
  const expressionAttributeValues: Record<string, any> = {
    ":status": status,
  };

  if (extractedText !== undefined) {
    expressions.push("extractedText = :text");
    expressionAttributeValues[":text"] = extractedText;
  }

  if (fileSizeBytes !== undefined && fileSizeBytes > 0) {
    expressions.push("fileSizeBytes = :fileSizeBytes");
    expressionAttributeValues[":fileSizeBytes"] = fileSizeBytes;
  }

  try {
    await dynamo.send(
      new UpdateCommand({
        TableName: env.DYNAMODB_TABLE_NAME,
        Key: { resumeId },
        UpdateExpression: `SET ${expressions.join(", ")}`,
        ExpressionAttributeNames: expressionAttributeNames,
        ExpressionAttributeValues: expressionAttributeValues,
      })
    );
  } catch (error) {
    const err = error as Error;
    logger.error("DynamoDB updateRecord failed", {
      resumeId,
      errorCode: err.name,
    });
    throw error;
  }
}

export { dynamo, client };
