# S3 Event Trigger + Extractor Lambda — Implementation Guide

> **For Claude Code:** Read this entire file before writing any code.
> This covers two things: (1) the code for `src/extractor.ts`, and (2) the AWS setup steps to wire the S3 trigger.
> Implement exactly as specified. Do not deviate from field names, types, or operation signatures.

---

## How It Works

```
Client uploads PDF to S3
        ↓
S3 detects new object in bucket
        ↓
S3 fires an event → invokes Extractor Lambda automatically
        ↓                        (client does NOT wait for this)
Extractor Lambda runs in background:
  1. Read the S3 event to get the bucket + key (resumeId)
  2. Fetch the PDF bytes from S3
  3. Extract text from PDF using pdf.service.ts
  4. Write result to DynamoDB via dynamo.service.ts
     → status: "ready" + extractedText   (success)
     → status: "failed"                  (if extraction fails)
```

---

## Part 1 — Code

### File to Create

**Path:** `src/extractor.ts`

This is a **separate Lambda entry point** — it is NOT part of the Hono app.
It exports a `handler` function that AWS Lambda invokes directly with an S3 event payload.

---

### Dependencies

Install before writing code:

```bash
pnpm add pdf-parse
pnpm add -D @types/pdf-parse @types/aws-lambda
```

> Use `pdf-parse` for text extraction. It works directly on a Buffer — no file system needed, which is correct for Lambda.

---

### S3 Event Type

The event AWS passes to the Lambda looks like this:

```typescript
import type { S3Event, S3Handler } from "aws-lambda";

// AWS calls your handler with this shape:
{
  Records: [
    {
      s3: {
        bucket: { name: "parseflowai" },
        object: { key: "res_abc123.pdf", size: 204800 }
      }
    }
  ]
}
```

> `object.key` is the `resumeId` + `.pdf` — strip `.pdf` to get the `resumeId`.
> Always loop over `Records` — AWS can batch multiple events (rare but possible).

---

### `src/extractor.ts` — Full Implementation Spec

```typescript
import type { S3Handler } from "aws-lambda";
import { fetchFileFromS3 } from "./services/s3.service";
import { extractTextFromBuffer } from "./services/pdf.service";
import { updateRecord } from "./services/dynamo.service";
import { logger } from "./lib/logger";

export const handler: S3Handler = async (event) => {
  for (const record of event.Records) {
    const bucket = record.s3.bucket.name;
    const key = decodeURIComponent(record.s3.object.key.replace(/\+/g, " "));
    const resumeId = key.replace(".pdf", "");

    logger.info("Extractor triggered", { resumeId, bucket });

    try {
      // Step 1: Fetch PDF from S3
      const pdfBuffer = await fetchFileFromS3(bucket, key);

      // Step 2: Extract text
      const extractedText = await extractTextFromBuffer(pdfBuffer);

      // Step 3: Write success to DynamoDB
      await updateRecord({ resumeId, status: "ready", extractedText });

      logger.info("Extraction complete", { resumeId });

    } catch (err) {
      // Step 3 (on failure): Write failure to DynamoDB
      logger.error("Extraction failed", { resumeId, error: (err as Error).message });
      await updateRecord({ resumeId, status: "failed" });
    }
  }
};
```

> **Key detail — URL decode the S3 key:**
> S3 encodes special characters in object keys in the event payload (e.g. spaces become `+`).
> Always decode: `decodeURIComponent(key.replace(/\+/g, " "))`.
> Without this, filenames with spaces or special characters will cause a fetch failure.

---

### `src/services/s3.service.ts` — Add `fetchFileFromS3`

The existing `s3.service.ts` only has presigned URL generation.
Add this new function to it:

```typescript
import { GetObjectCommand } from "@aws-sdk/client-s3";

export async function fetchFileFromS3(bucket: string, key: string): Promise<Buffer> {
  const command = new GetObjectCommand({ Bucket: bucket, Key: key });
  const response = await s3Client.send(command);

  const stream = response.Body;
  if (!stream) throw new Error("Empty S3 response body");

  // Convert readable stream to Buffer
  const chunks: Uint8Array[] = [];
  for await (const chunk of stream as AsyncIterable<Uint8Array>) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}
```

> Do NOT use `streamToBuffer` helpers that depend on Node.js `stream` — use `AsyncIterable` directly.
> It works in both Lambda and local environments without extra dependencies.

---

### `src/services/pdf.service.ts` — Create This File

```typescript
import pdfParse from "pdf-parse";

export async function extractTextFromBuffer(buffer: Buffer): Promise<string> {
  const result = await pdfParse(buffer);
  const text = result.text?.trim();

  if (!text || text.length < 10) {
    throw new Error("PDF appears to be empty or image-based — no extractable text found");
  }

  return text;
}
```

> `pdf-parse` returns `result.text` as a plain string with all text extracted from the PDF.
> The length check (`< 10`) guards against scanned/image-based PDFs that return empty or near-empty text.
> Scanned PDF support (OCR) is a future feature — for now throw and let extractor write `status: "failed"`.

---

### S3 IAM Permission — Add `s3:GetObject`

The Extractor Lambda needs to **read** files from S3.
Your current IAM policy only allows `s3:PutObject`.

Add this to the Extractor Lambda's IAM role policy:

```json
{
  "Sid": "S3GetForExtractor",
  "Effect": "Allow",
  "Action": "s3:GetObject",
  "Resource": "arn:aws:s3:::parseflowai/*"
}
```

---

### Build — Separate esbuild Entry

The Extractor Lambda is packaged **separately** from the API Lambda.
Add this build script to `package.json`:

```json
{
  "scripts": {
    "build:api": "esbuild src/index.ts --bundle --platform=node --target=node20 --outfile=dist/index.js",
    "build:extractor": "esbuild src/extractor.ts --bundle --platform=node --target=node20 --outfile=dist/extractor.js",
    "build": "pnpm build:api && pnpm build:extractor"
  }
}
```

> Two separate bundles:
> - `dist/index.js` → API Lambda (Hono)
> - `dist/extractor.js` → Extractor Lambda (S3 trigger)

---

## Part 2 — AWS Setup

### Step 1 — Create the Extractor Lambda

Go to **AWS Console → Lambda → Create function**:

```
Function name  : parseflowai-extractor
Runtime        : Node.js 20.x
Architecture   : x86_64
```

Under **Permissions**, create or attach an IAM role with:
- `s3:GetObject` on `arn:aws:s3:::parseflowai/*`
- `dynamodb:UpdateItem` on `arn:aws:dynamodb:ap-south-1:*:table/parseflowai-resumes`

---

### Step 2 — Upload the Extractor Lambda Code

After running `pnpm build:extractor`:

```bash
# Zip the bundle
zip dist/extractor.zip dist/extractor.js
```

In AWS Console → your Lambda → **Upload from → .zip file** → upload `extractor.zip`.

Set the **Handler** to:
```
dist/extractor.handler
```

---

### Step 3 — Set Environment Variables on Extractor Lambda

Go to **Lambda → parseflowai-extractor → Configuration → Environment variables**:

```
AWS_REGION            = ap-south-1
DYNAMODB_TABLE_NAME   = parseflowai-resumes
RESUME_TTL_HOURS      = 24
NODE_ENV              = production
```

> The Extractor Lambda does NOT need `GEMINI_API_KEY` or `API_KEY_SECRET` — it only does S3 fetch + PDF extract + DynamoDB write.

---

### Step 4 — Add the S3 Event Trigger

Go to **AWS Console → S3 → parseflowai bucket → Properties → Event notifications → Create event notification**:

```
Event name         : pdf-uploaded
Prefix             : (leave empty)
Suffix             : .pdf
Event types        : ✅ s3:ObjectCreated:Put
Destination        : Lambda function
Lambda function    : parseflowai-extractor
```

> **Suffix `.pdf`** is important — it ensures only PDF uploads trigger the Lambda, not other files.
> **Event type `s3:ObjectCreated:Put`** matches the presigned URL upload method (PUT request).

---

### Step 5 — Set Lambda Timeout

PDF extraction can take a few seconds for large files.
Go to **Lambda → parseflowai-extractor → Configuration → General configuration → Edit**:

```
Timeout : 30 seconds
Memory  : 256 MB
```

> Default timeout is 3 seconds — way too short for PDF processing + DynamoDB write.
> 30 seconds is safe for all normal resume PDFs.

---

### Step 6 — Test the Trigger

Upload any PDF to the S3 bucket manually via AWS Console → S3 → Upload.

Then check:

1. **Lambda logs** → AWS Console → Lambda → parseflowai-extractor → Monitor → **View CloudWatch logs**
   - You should see `"Extractor triggered"` and `"Extraction complete"` log lines

2. **DynamoDB record** → AWS Console → DynamoDB → Tables → parseflowai-resumes → **Explore table items**
   - Find the record by `resumeId` (filename without `.pdf`)
   - `status` should be `"ready"`
   - `extractedText` should contain the resume text

---

## Full Flow Summary

```
POST /v1/resumes/upload-url
        ↓
API Lambda → createRecord() in DynamoDB (status: "pending")
           → returns { resumeId, uploadUrl }
        ↓
Client PUTs PDF to S3 presigned URL
        ↓
S3 fires event → Extractor Lambda triggered (async, background)
        ↓
extractor.ts:
  fetchFileFromS3()        → gets PDF buffer
  extractTextFromBuffer()  → gets plain text string
  updateRecord()           → DynamoDB status: "ready" + extractedText
        ↓
─────────────────────────────────────────
POST /v1/resumes/parse { resumeId, schema }
        ↓
getRecord(resumeId) → reads DynamoDB
  status: "pending" → 202 retry
  status: "failed"  → 422 PARSE_FAILED
  status: "ready"   → extractedText → Gemini → JSON
```

---

## After Writing the Code

Update `AICONTEXT.md`:

1. **File Registry** — mark these as `✅ Exists`:
   - `src/extractor.ts`
   - `src/services/pdf.service.ts`
   - update `src/services/s3.service.ts` — add note: "fetchFileFromS3 added"

2. **Progress Tracker Phase 5** — check off all items once AWS setup and local test are done

3. **Decision Log** — add:
   - `pdf-parse` chosen for PDF text extraction (lightweight, Buffer-based, no filesystem dependency — correct for Lambda)
