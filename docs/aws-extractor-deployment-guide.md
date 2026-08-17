# AWS Extractor Lambda & S3 Event Trigger Setup Guide

This guide walks you through deploying the `parseflowai-extractor` Lambda to AWS and configuring the automatic S3 event trigger so that every PDF uploaded to the `parseflowai` S3 bucket automatically invokes extraction in the background.

---

## Architecture Flow

```
1. Client calls /upload-url
   └── Returns { resumeId, uploadUrl } & saves DynamoDB record with status: "pending"

2. Client uploads PDF (HTTP PUT to uploadUrl)
   └── PDF binary lands in AWS S3 bucket: parseflowai/<resumeId>.pdf

3. S3 fires ObjectCreated:Put event automatically
   └── S3 invokes parseflowai-extractor Lambda in background (client does not wait)

4. Extractor Lambda runs (dist/extractor.handler)
   ├── 1. Fetches PDF bytes from S3 (s3:GetObject)
   ├── 2. Extracts full plain text via pdf-parse
   └── 3. Updates DynamoDB table parseflowai-resumes
          └── status: "ready", extractedText: "...", fileSizeBytes: N
```

---

## Step 1 — Build & Package the Extractor Lambda

From the project root:

```bash
pnpm package
```

This compiles `src/extractor.ts` using `esbuild` and creates `dist/extractor.zip` (standalone bundle ~2MB with all dependencies included).

---

## Step 2 — Create the Extractor Lambda on AWS

1. Go to **AWS Console $\rightarrow$ Lambda $\rightarrow$ Create function**
2. Choose **Author from scratch**:
   * **Function name**: `parseflowai-extractor`
   * **Runtime**: `Node.js 20.x`
   * **Architecture**: `x86_64`
3. Click **Create function**.

---

## Step 3 — Upload the Code & Configure Handler

1. In your `parseflowai-extractor` Lambda page:
   * Click **Upload from $\rightarrow$ .zip file**
   * Select `dist/extractor.zip` and click **Save**.
2. Scroll down to **Runtime settings** and click **Edit**:
   * **Handler**: `extractor.handler`
   * Click **Save**.

---

## Step 4 — Set Environment Variables

Go to **Configuration $\rightarrow$ Environment variables $\rightarrow$ Edit**:

| Key | Value | Notes |
|---|---|---|
| `AWS_REGION` | `ap-south-1` | Your AWS region |
| `DYNAMODB_TABLE_NAME` | `parseflowai-resumes` | Your DynamoDB table |
| `RESUME_TTL_HOURS` | `24` | Record TTL |
| `NODE_ENV` | `production` | Environment mode |

*(Note: The Extractor Lambda only needs S3 read + DynamoDB update permissions; it does not require Gemini or API key secrets.)*

---

## Step 5 — Configure Lambda Timeout & Memory

PDF extraction on multi-page resumes requires more than the default 3 seconds:

1. Go to **Configuration $\rightarrow$ General configuration $\rightarrow$ Edit**:
   * **Memory**: `256 MB`
   * **Timeout**: `30 seconds`
2. Click **Save**.

---

## Step 6 — Configure IAM Execution Role

Go to **Configuration $\rightarrow$ Permissions $\rightarrow$ Click on the Execution Role name**:

Attach an inline policy (or managed policy) allowing:
- `s3:GetObject` on `arn:aws:s3:::parseflowai/*`
- `dynamodb:UpdateItem` on `arn:aws:dynamodb:ap-south-1:*:table/parseflowai-resumes`
- CloudWatch logs (`logs:CreateLogGroup`, `logs:CreateLogStream`, `logs:PutLogEvents`)

**Example IAM Policy:**
```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "S3ReadAccess",
      "Effect": "Allow",
      "Action": [
        "s3:GetObject"
      ],
      "Resource": "arn:aws:s3:::parseflowai/*"
    },
    {
      "Sid": "DynamoDBUpdateAccess",
      "Effect": "Allow",
      "Action": [
        "dynamodb:UpdateItem"
      ],
      "Resource": "arn:aws:dynamodb:ap-south-1:*:table/parseflowai-resumes"
    }
  ]
}
```

---

## Step 7 — Add the S3 Event Notification Trigger

There are two ways to add the S3 trigger:

### Method A: From the S3 Console (Recommended)
1. Go to **AWS Console $\rightarrow$ Amazon S3 $\rightarrow$ Buckets $\rightarrow$ `parseflowai`**
2. Click the **Properties** tab
3. Scroll down to **Event notifications** $\rightarrow$ Click **Create event notification**
4. Set:
   * **Event name**: `pdf-upload-extractor-trigger`
   * **Prefix**: *(leave blank)*
   * **Suffix**: `.pdf`
   * **Event types**: Check `s3:ObjectCreated:Put` (or `All object create events`)
   * **Destination**: Choose **Lambda function**
   * **Lambda function**: Select `parseflowai-extractor`
5. Click **Save changes**.

### Method B: From the Lambda Console
1. In the `parseflowai-extractor` Lambda page, click **Add trigger**
2. Select **S3**
3. Select Bucket: `parseflowai`
4. Event type: `All object create events` (or `s3:ObjectCreated:Put`)
5. Suffix: `.pdf`
6. Check the acknowledgment box and click **Add**.

---

## Step 8 — Testing the Live Flow

1. Upload a PDF using the test UI (`public/index.html`) or API:
   ```bash
   # 1. Get presigned URL
   curl -X POST http://localhost:3000/v1/resumes/upload-url \
     -H "Content-Type: application/json" \
     -d '{"fileName":"test-resume.pdf", "contentType":"application/pdf"}'
   ```
2. PUT the PDF file to the returned `uploadUrl`:
   ```bash
   curl -X PUT "<uploadUrl>" \
     -H "Content-Type: application/pdf" \
     --data-binary @"sample.pdf"
   ```
3. Check AWS:
   * **CloudWatch Logs** ($\rightarrow$ `/aws/lambda/parseflowai-extractor`): Look for `[INFO] Extractor triggered` and `[INFO] Extraction complete`.
   * **DynamoDB** ($\rightarrow$ `parseflowai-resumes` table): Find your `resumeId`. The `status` will be `"ready"`, `fileSizeBytes` will match the PDF size, and `extractedText` will contain the parsed resume content.
