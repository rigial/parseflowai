# ParseFlowAI 🚀

> **Developer API — Resume → Structured JSON**
> "Give us any resume and the JSON schema you need. ParseFlowAI returns the resume in exactly that structure."

---

## 🏗️ Architecture Overview

```
Client
  │
  ├─ 1. POST /v1/resumes/upload-url ──► API Gateway / Lambda (parseflowai-api)
  │                                            │
  │                                     Creates DynamoDB Record (status: "pending")
  │                                     Returns S3 Presigned URL + resumeId
  │
  ├─ 2. PUT {pdf_bytes} ─────────────► S3 Bucket (parseflowai)
  │                                            │
  │                                     S3 Event (s3:ObjectCreated:Put *.pdf)
  │                                            ▼
  │                                    Extractor Lambda (parseflowai-extractor)
  │                                            │
  │                                     Extracts PDF text with pdf-parse
  │                                     Updates DynamoDB (status: "ready" + extractedText)
  │
  └─ 3. POST /v1/resumes/parse ───────► API Gateway / Lambda (parseflowai-api)
                                               │
                                        Fetches text from DynamoDB
                                        Calls Gemini AI with custom schema
                                        Returns structured JSON
```

---

## ☁️ AWS Infrastructure (`ap-south-1`)

| Resource | Identifier / Name | Description |
|---|---|---|
| **Region** | `ap-south-1` (Mumbai) | Primary region for compute, storage, and database |
| **API Lambda** | `parseflowai-api` | Hono HTTP application handler (`index.handler`) |
| **Extractor Lambda** | `parseflowai-extractor` | S3 event trigger handler (`extractor.handler`) |
| **API Gateway** | `https://xaz11sovtd.execute-api.ap-south-1.amazonaws.com` | HTTP API v2 routing to `parseflowai-api` |
| **S3 Bucket** | `parseflowai` | Secure storage for resume PDFs (24h lifecycle expiry) |
| **DynamoDB Table** | `parseflowai-resumes` | Resume metadata and extracted text storage (TTL on `expiresAt`) |
| **IAM Role** | `parseflowai-lambda-execution-role` | Least-privilege execution role for Lambdas |

---

## 🛠️ Tech Stack

- **Framework**: [Hono](https://hono.dev/)
- **Runtime**: Node.js 20.x on AWS Lambda
- **Language**: TypeScript
- **Bundler**: [esbuild](https://esbuild.github.io/)
- **Storage**: AWS S3 & DynamoDB
- **AI Model**: Gemini 2.5 Flash-Lite
- **Validation**: Zod
- **CI/CD**: GitHub Actions

---

## 🚀 Getting Started

### Local Development

1. Clone the repository and install dependencies:
   ```bash
   pnpm install
   ```

2. Configure environment variables in `.env`:
   ```bash
   cp .env.example .env
   ```

3. Run the local dev server:
   ```bash
   pnpm dev
   ```

4. Run tests:
   ```bash
   pnpm test
   ```

5. Build & package for AWS Lambda:
   ```bash
   pnpm package
   ```

---

## 📡 Live API Endpoints

### 1. Health Check
```bash
curl https://xaz11sovtd.execute-api.ap-south-1.amazonaws.com/health
```

**Response:**
```json
{
  "success": true,
  "service": "resume-parser-api",
  "status": "healthy"
}
```

### 2. Request Presigned Upload URL
```bash
curl -X POST https://xaz11sovtd.execute-api.ap-south-1.amazonaws.com/v1/resumes/upload-url \
  -H "Content-Type: application/json" \
  -d '{
    "fileName": "my-resume.pdf",
    "contentType": "application/pdf",
    "fileSizeBytes": 102400
  }'
```

**Response:**
```json
{
  "success": true,
  "data": {
    "resumeId": "res_ae9987ad265546b99a0244cc3b1f1dfe",
    "uploadUrl": "https://parseflowai.s3.ap-south-1.amazonaws.com/res_...pdf?..."
  }
}
```

---

## 🔄 CI/CD with GitHub Actions

The repository includes automated CI/CD via `.github/workflows/deploy.yml`.

On every push to `main`:
1. Dependencies are installed and tests pass
2. Bundles are compiled with `esbuild` (`dist/index.js` and `dist/extractor.js`)
3. Packages are zipped and deployed to `parseflowai-api` and `parseflowai-extractor` in `ap-south-1`

### Required GitHub Repository Secrets

Configure these in **GitHub → Repository → Settings → Secrets and variables → Actions**:

- `AWS_ACCESS_KEY_ID`: IAM access key
- `AWS_SECRET_ACCESS_KEY`: IAM secret key
- `AWS_REGION`: `ap-south-1`
- `S3_BUCKET_NAME`: `parseflowai`
- `DYNAMODB_TABLE_NAME`: `parseflowai-resumes`
- `API_KEY_SECRET`: Live API key secret
- `GEMINI_API_KEY`: Google Gemini API key
