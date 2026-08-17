# DynamoDB Service — Implementation Guide

> **For Claude Code:** Read this entire file before writing any code.
> Implement exactly as specified. Do not deviate from field names, types, or operation signatures.

---

## Table Reference

| Property | Value |
|---|---|
| Table name | `parseflowai-resumes` |
| Partition key | `resumeId` (String) |
| Sort key | none |
| GSI name | `customerId-createdAt-index` |
| GSI partition key | `customerId` (String) |
| GSI sort key | `createdAt` (String) |
| TTL attribute | `expiresAt` (Number — Unix seconds) |
| Billing | On-demand |

---

## DynamoDB Record Shape

```typescript
type ResumeStatus = "pending" | "ready" | "failed";

interface ResumeRecord {
  resumeId: string;        // PK — "res_" + nanoid
  customerId: string;      // GSI PK — links to API key owner
  status: ResumeStatus;    // updated by Extractor Lambda
  extractedText?: string;  // written when status becomes "ready"
  fileName: string;        // original uploaded filename
  fileSizeBytes: number;   // for validation audit and analytics
  createdAt: string;       // ISO 8601 string — GSI sort key
  expiresAt: number;       // Unix timestamp in SECONDS (not ms) — DynamoDB TTL
}
```

---

## File to Create

**Path:** `src/services/dynamo.service.ts`

---

## Dependencies

Install before writing code:

```bash
pnpm add @aws-sdk/client-dynamodb @aws-sdk/lib-dynamodb
```

---

## Environment Variables Used

```typescript
// These are already validated in src/lib/env.ts — import from there
env.DYNAMODB_TABLE_NAME   // "parseflowai-resumes"
env.AWS_REGION            // "ap-south-1"
env.RESUME_TTL_HOURS      // number — used to compute expiresAt
```

Add `DYNAMODB_TABLE_NAME` to `src/lib/env.ts` Zod schema if not already present:

```typescript
DYNAMODB_TABLE_NAME: z.string().min(1),
```

---

## Client Setup

```typescript
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";

const client = new DynamoDBClient({ region: env.AWS_REGION });
const dynamo = DynamoDBDocumentClient.from(client);
```

> Use `DynamoDBDocumentClient` (from `lib-dynamodb`), NOT the raw `DynamoDBClient` directly.
> `DocumentClient` handles marshalling/unmarshalling automatically — no `{ S: "value" }` syntax needed.

---

## Operations to Implement

### 1. `createRecord`

Called by: `POST /v1/resumes/upload-url` route after generating the presigned URL.

**Signature:**
```typescript
export async function createRecord(params: {
  resumeId: string;
  customerId: string;
  fileName: string;
  fileSizeBytes: number;
}): Promise<void>
```

**Logic:**
- Set `status: "pending"`
- Set `createdAt` to `new Date().toISOString()`
- Set `expiresAt` to `Math.floor(Date.now() / 1000) + (env.RESUME_TTL_HOURS * 3600)`
- Do NOT set `extractedText` — it doesn't exist yet
- Use `PutCommand`

**Example output record written:**
```json
{
  "resumeId": "res_abc123",
  "customerId": "cust_xyz789",
  "status": "pending",
  "fileName": "john-doe.pdf",
  "fileSizeBytes": 204800,
  "createdAt": "2025-08-17T10:30:00.000Z",
  "expiresAt": 1724067000
}
```

---

### 2. `getRecord`

Called by: `POST /v1/resumes/parse` to check status and get `extractedText`.

**Signature:**
```typescript
export async function getRecord(resumeId: string): Promise<ResumeRecord | null>
```

**Logic:**
- Use `GetCommand` with `{ TableName, Key: { resumeId } }`
- If item does not exist, return `null`
- Return the full record as `ResumeRecord`

---

### 3. `updateRecord`

Called by: `src/extractor.ts` (Extractor Lambda) after PDF text extraction completes.

**Signature:**
```typescript
export async function updateRecord(params: {
  resumeId: string;
  status: ResumeStatus;
  extractedText?: string;
}): Promise<void>
```

**Logic:**
- Use `UpdateCommand`
- Always update `status`
- If `extractedText` is provided, update it too
- If `status: "failed"`, `extractedText` will be undefined — that's fine, don't write it

**UpdateExpression when ready:**
```
SET #status = :status, extractedText = :text
```

**UpdateExpression when failed:**
```
SET #status = :status
```

> Use `#status` as an ExpressionAttributeName because `status` is a reserved word in DynamoDB.

---

## Error Handling

- Wrap all operations in `try/catch`
- On error, log the error code and `resumeId` only — never log `extractedText` (contains PII)
- Re-throw a typed error so the caller can return the correct HTTP response

```typescript
// Safe error log example
logger.error("DynamoDB getRecord failed", { resumeId, errorCode: err.name });
```

---

## How `/parse` Uses `getRecord`

The parse route reads the record and branches on `status`:

```typescript
const record = await getRecord(resumeId);

if (!record) {
  // return RESUME_NOT_FOUND 404
}

if (record.status === "pending") {
  // return 202 { success: false, error: { code: "EXTRACTION_PENDING", message: "Resume is still being processed, retry in a few seconds" } }
}

if (record.status === "failed") {
  // return 422 PARSE_FAILED
}

// status === "ready" → proceed
const result = await aiService.parse(record.extractedText!, schema);
```

---

## How Extractor Lambda Uses `updateRecord`

```typescript
// On success
await updateRecord({
  resumeId,
  status: "ready",
  extractedText: extractedText,
});

// On failure
await updateRecord({
  resumeId,
  status: "failed",
});
```

---

## Complete File Structure

```typescript
// src/services/dynamo.service.ts

import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand, GetCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { env } from "../lib/env";
import { logger } from "../lib/logger";

// Types
// Client setup
// createRecord()
// getRecord()
// updateRecord()
```

---

## After Writing the File

Update `AICONTEXT.md`:

1. **File Registry** — mark `src/services/dynamo.service.ts` as `✅ Exists`
2. **Progress Tracker Phase 4** — check off `src/services/dynamo.service.ts — createRecord, getRecord, updateRecord`
3. Add `DYNAMODB_TABLE_NAME` to env vars in `src/lib/env.ts` if not already there and check it off in Phase 1
