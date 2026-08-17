# ParseFlowAI — AI Context File

> **Instructions for AI:** Always read this file at the start of every session before making any changes.
> After completing any task, update the relevant sections below — especially `## Progress Tracker`, `## File Registry`, and `## Decision Log`.
> Never contradict decisions already logged here unless the user explicitly changes them.

---

## Project Identity

| Field | Value |
|---|---|
| **Project** | ParseFlowAI |
| **Type** | Developer API — Resume → Structured JSON |
| **Stage** | MVP (setup complete, building) |
| **PRD Source** | `PRD.md` (root of project) |
| **Key Differentiator** | "Give us any resume and the JSON schema you need. ParseFlowAI returns the resume in exactly that structure." |

---

## Tech Stack (Locked)

| Layer | Choice |
|---|---|
| Language | TypeScript |
| Framework | Hono |
| Runtime | Node.js 20+ |
| Package Manager | pnpm |
| Compute | AWS Lambda |
| API Gateway | AWS API Gateway |
| Storage | AWS S3 |
| AI Model | Gemini 3.5 Flash-Lite |
| Validation | Zod |
| Build | esbuild |
| Monitoring | CloudWatch |

> Do not suggest swapping any of these unless the user explicitly requests it.

---

## MVP API Surface

| Status | Method | Endpoint | Purpose |
|---|---|---|---|
| ✅ Done | GET | `/health` | Health check |
| ✅ Done | POST | `/v1/resumes/upload-url` | Generate S3 presigned upload URL |
| ✅ Done | POST | `/v1/resumes/parse` | Parse resume with custom schema |
| 🔜 Post-MVP | DELETE | `/v1/resumes/:id` | Delete resume |

---

## Project Structure (Canonical)

```
parseflowai/
│
├── src/
│   ├── index.ts              ← Lambda entry point
│   ├── dev.ts                ← Local dev server
│   ├── app.ts                ← Hono app setup
│   │
│   ├── routes/
│   │   ├── health.ts
│   │   ├── resumes.ts        ← upload-url route
│   │   └── parse.ts          ← parse route
│   │
│   ├── services/
│   │   ├── s3.service.ts     ← Presigned URL, delete, fetch
│   │   ├── pdf.service.ts    ← Text extraction from PDF
│   │   ├── resume.service.ts ← Orchestrates parse flow
│   │   └── ai.service.ts     ← Gemini abstraction (swappable)
│   │
│   ├── schemas/
│   │   ├── upload.schema.ts  ← Zod: upload request/response
│   │   └── parse.schema.ts   ← Zod: parse request/response
│   │
│   └── lib/
│       ├── env.ts            ← Validated env vars (Zod)
│       └── logger.ts         ← Safe logger (no PII)
│
├── .env
├── .env.example
├── .gitignore
├── package.json
├── pnpm-lock.yaml
└── README.md
```

---

## Progress Tracker

### Phase 1 — Project Bootstrap
- [x] `package.json` with pnpm + all dependencies
- [x] `tsconfig.json`
- [x] `esbuild` build script
- [x] `.env.example` with all required vars
- [x] `src/lib/env.ts` — Zod-validated env
- [x] `src/lib/logger.ts` — PII-safe logger
- [x] `src/app.ts` — Hono app
- [x] `src/index.ts` — Lambda handler
- [x] `src/dev.ts` — Local dev with `@hono/node-server`

### Phase 2 — Health Route
- [x] `src/routes/health.ts`
- [x] Registered in `app.ts`
- [x] Tested locally

### Phase 3 — Upload URL
- [x] `src/schemas/upload.schema.ts`
- [x] `src/services/s3.service.ts` — presigned PUT URL
- [x] `src/routes/resumes.ts` — upload-url route with DynamoDB pending record creation
- [x] Tested locally & route integration tests with simulated S3 extractor event flow

### Phase 4 — PDF Parsing & Persistence
- [x] `src/services/dynamo.service.ts` — `createRecord`, `getRecord`, `updateRecord`
- [x] `src/services/pdf.service.ts`
- [x] Text extraction from buffer (text-based PDFs)
- [x] Tested with sample resume PDF

### Phase 5 — AI Service
- [x] `src/services/ai.service.ts`
- [x] Gemini 2.5 / 3.1 Flash-Lite configurable integration
- [x] Dynamic shorthand schema → Gemini responseSchema converter
- [x] Zod validation of customer shorthand schema
- [x] Tested with real prompt & unit tests

### Phase 6 — Parse Route
- [x] `src/schemas/parse.schema.ts`
- [x] `src/services/resume.service.ts`
- [x] `src/routes/parse.ts`
- [x] End-to-end tested

### Phase 7 — Security Hardening
- [ ] API key auth middleware (`Authorization: Bearer rp_live_...`)
- [ ] Rate limiting middleware
- [ ] File type validation
- [ ] File size validation
- [ ] S3 auto-delete after 24h (Lambda TTL or S3 lifecycle rule)
- [ ] No PII in logs confirmed

### Phase 8 — Deployment
- [x] API Lambda packaged via esbuild
- [x] Extractor Lambda packaged separately via esbuild
- [x] GitHub Actions CI/CD workflow (`.github/workflows/deploy.yml`)
- [x] API Gateway setup (`https://xaz11sovtd.execute-api.ap-south-1.amazonaws.com`)
- [x] S3 bucket (private, 24h lifecycle rules, S3 event trigger for .pdf uploads)
- [x] CloudWatch logging (`/aws/lambda/parseflowai-api`, `/aws/lambda/parseflowai-extractor`)
- [x] Environment variables in Lambda console
- [x] Smoke test on live URL (verified /health and full async S3 extractor flow)

---

## File Registry

> Update this every time a file is created or significantly changed.

| File | Status | Notes |
|---|---|---|
| `PRD.md` | ✅ Exists | Source of truth for requirements |
| `AICONTEXT.md` | ✅ Exists | This file — always update after changes |
| `docs/dynamo-service.md` | ✅ Exists | DynamoDB Service specification |
| `docs/s3-event-trigger.md` | ✅ Exists | S3 Event Trigger + Extractor Lambda specification |
| `docs/cicd-deployment.md` | ✅ Exists | CI/CD GitHub Actions to AWS Lambda specification |
| `docs/ai-service-parse-endpoint.md` | ✅ Exists | AI Service + Parse endpoint specification |
| `.github/workflows/deploy.yml` | ✅ Exists | GitHub Actions CI/CD for both Lambdas |
| `public/index.html` | ✅ Exists | Test UI for presigned upload to S3 |
| `public/parse.html` | ✅ Exists | Test UI for resume parsing with schema editor & JSON viewer |
| `src/index.ts` | ✅ Exists | Lambda entry point for parseflowai-api (`index.handler`) |
| `src/dev.ts` | ✅ Exists | Local dev server with `@hono/node-server` |
| `src/extractor.ts` | ✅ Exists | Extractor Lambda handler (S3 event trigger) |
| `src/services/dynamo.service.ts` | ✅ Exists | DynamoDB operations: createRecord, getRecord, updateRecord |
| `src/services/pdf.service.ts` | ✅ Exists | Text extraction from PDF buffer via pdf-parse |
| `src/services/s3.service.ts` | ✅ Exists | Presigned URL generation and fetchFileFromS3 added |
| `src/services/ai.service.ts` | ✅ Exists | Gemini abstraction with shorthand-to-Gemini converter |
| `src/services/resume.service.ts` | ✅ Exists | Orchestrates parse flow: DynamoDB lookup, status branching, AI call |
| `src/lib/env.ts` | ✅ Exists | Validated env vars with Zod schema |
| `src/lib/logger.ts` | ✅ Exists | Safe PII-free logger |
| `src/routes/health.ts` | ✅ Exists | Health check route |
| `src/routes/resumes.ts` | ✅ Exists | Upload URL route with DynamoDB pending record creation |
| `src/routes/parse.ts` | ✅ Exists | Full implementation of /v1/resumes/parse and /parse |
| `src/schemas/upload.schema.ts` | ✅ Exists | Upload request validation schema with fileSizeBytes & customerId |
| `src/schemas/parse.schema.ts` | ✅ Exists | Shorthand schema validator and parse request schema |
| `tests/dynamo.service.test.ts` | ✅ Exists | Unit tests for DynamoDB service |
| `tests/pdf.service.test.ts` | ✅ Exists | Unit tests for PDF service |
| `tests/s3.service.test.ts` | ✅ Exists | Unit tests for S3 service |
| `tests/extractor.test.ts` | ✅ Exists | Unit tests for Extractor Lambda handler |
| `tests/upload.route.test.ts` | ✅ Exists | Unit & end-to-end integration tests for /upload-url route and extractor |
| `tests/ai.service.test.ts` | ✅ Exists | Unit tests for AI service and schema conversion |
| `tests/parse.route.test.ts` | ✅ Exists | Integration tests for /v1/resumes/parse endpoint |

---

## Decision Log

> Record every significant technical or product decision here. AI must not contradict these.

| # | Decision | Reason | Date |
|---|---|---|---|
| 1 | Use Gemini 2.5 Flash-Lite | Lowest AI cost for MVP; target ₹500–₹1,500/month infra spend | — |
| 2 | AI layer isolated in `ai.service.ts` | So another model can be swapped in without touching routes or services | — |
| 3 | Presigned S3 URLs for upload | Client uploads directly to S3; Lambda never handles binary file data | — |
| 4 | Delete `/v1/resumes/:id` is post-MVP | Only 3 endpoints in v1: health, upload-url, parse | — |
| 5 | Text-based PDF extraction locally | Avoid AI/cloud cost for text extraction where possible; fallback for scanned PDFs is a future feature | — |
| 6 | Zod validation on AI output | AI can hallucinate structure; always validate before returning to client | — |
| 7 | No PII in logs | Resumes contain sensitive data; logger must strip or never receive personal info | — |
| 8 | Resumes auto-deleted after 24h | Configurable; default 24h via S3 lifecycle rule | — |
| 9 | `pdf-parse` for PDF extraction | Lightweight, Buffer-based, no filesystem dependency — correct for Lambda | — |
| 10 | Async PDF extraction via S3 trigger | `/upload-url` generates presigned URL & creates DynamoDB pending record; S3 trigger runs Extractor Lambda in background so client never waits | 2026-08-17 |
| 11 | GitHub Actions chosen for CI/CD | Free tier (2000 min/month), zero infrastructure, native AWS credential support via `aws-actions/configure-aws-credentials` | 2026-08-17 |
| 12 | `--external:@aws-sdk/*` in esbuild | AWS SDK excluded from bundle since Lambda runtime includes it, reduces bundle size significantly | 2026-08-17 |
| 13 | Region `ap-south-1` for Lambdas & DynamoDB & S3 | Deployed in Mumbai (`ap-south-1`) with API Gateway v2 integration for low latency | 2026-08-17 |
| 14 | `GEMINI_MODEL` kept as env var | Model name configurable via env var; avoids code deployment when changing model strings | 2026-08-17 |
| 15 | Shorthand-to-Gemini schema converter | Customers use simple flat/nested shorthand (per PRD); `ai.service.ts` translates to Gemini JSON schema internally | 2026-08-17 |
| 16 | All customer schema fields marked `required` | Forces consistent response shape rather than Gemini silently omitting fields it could not find | 2026-08-17 |

---

## Environment Variables

> All vars must be defined in `.env.example`. Validated at startup via `src/lib/env.ts`.

| Variable | Required | Description |
|---|---|---|
| `AWS_REGION` | ✅ | AWS region |
| `AWS_S3_BUCKET` | ✅ | Private S3 bucket for resumes |
| `DYNAMODB_TABLE_NAME` | ✅ | DynamoDB table name for resume metadata |
| `S3_PRESIGNED_URL_EXPIRY` | ✅ | Seconds before upload URL expires (default: 900) |
| `MAX_FILE_SIZE_MB` | ✅ | Max upload size in MB |
| `GEMINI_API_KEY` | ✅ | Gemini API key |
| `GEMINI_MODEL` | ✅ | Gemini model name (default: gemini-3.5-flash-lite) |
| `API_KEY_SECRET` | ✅ | Shared secret for `rp_live_` bearer auth (MVP) |
| `RESUME_TTL_HOURS` | ✅ | Hours before S3/DynamoDB record expires (default: 24) |
| `NODE_ENV` | ✅ | `development` or `production` |

---

## Error Codes Reference

| Code | HTTP Status | When |
|---|---|---|
| `INVALID_REQUEST` | 400 | Malformed body / schema |
| `UNAUTHORIZED` | 401 | Missing or invalid API key |
| `RESUME_NOT_FOUND` | 404 | `resumeId` doesn't exist in S3 |
| `UNSUPPORTED_FILE_TYPE` | 415 | Not a PDF |
| `FILE_TOO_LARGE` | 413 | Exceeds `MAX_FILE_SIZE_MB` |
| `PARSE_FAILED` | 422 | Could not extract text from PDF |
| `AI_ERROR` | 502 | Gemini call failed or returned unusable response |
| `RATE_LIMITED` | 429 | Too many requests |
| `INTERNAL_ERROR` | 500 | Unexpected server error |

---

## Performance Targets

| Operation | Target |
|---|---|
| Upload URL generation | < 300ms |
| API validation | < 100ms |
| Resume parsing (end-to-end) | < 10 seconds |

---

## Standard Response Shapes

**Success (`/v1/resumes/upload-url`):**
```json
{
  "success": true,
  "data": {
    "resumeId": "res_a26814f7ca6d40bf8e06defd5d849364",
    "uploadUrl": "https://parseflowai.s3.ap-south-1.amazonaws.com/..."
  }
}
```

**Error:**
```json
{
  "success": false,
  "error": {
    "code": "ERROR_CODE",
    "message": "Human readable message"
  }
}
```

---

## Future Scope (Do Not Build in MVP)

- v1.1: DOCX support, OCR, result caching, request IDs, usage tracking
- v1.2: API key dashboard, rate limit config, usage analytics
- v2: Billing, Stripe/Razorpay, batch parsing, webhooks, async parsing (`POST /v1/resumes/parse/async`)

---

## How to Use This File

**At the start of every session:**
> "Read AICONTEXT.md before doing anything."

**After completing a task:**
> "Update AICONTEXT.md — mark X as done, add Y to the file registry, log the decision about Z."

**When asking the AI to build a file:**
> "Build `src/services/ai.service.ts` per AICONTEXT.md specs."

**When making a new decision:**
> "Log this to AICONTEXT.md decision log: we decided to use pdf-parse instead of pdfjs-dist because…"