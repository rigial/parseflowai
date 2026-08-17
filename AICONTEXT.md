# ParseFlowAI — AI Context File

> **Instructions for AI:** Always read this file at the start of every session before making any changes.
> After completing any task, update the relevant sections below — especially `## Progress Tracker`, `## File Registry`, and `## Decision Log`.
> Never contradict decisions already logged here unless the user explicitly changes them.

---

## Project Identity

| Field | Value |
|---|---|
| **Project** | ParseFlowAI |
| **Type** | Developer API & Self-Serve SaaS — Resume → Structured JSON |
| **Stage** | Backend Foundation (Auth, API Keys, Usage Tracking Complete) |
| **PRD Source** | `PRD.md` & `docs/PARSEFLOWAI_AUTH_API_KEYS_USAGE.md` |
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
| Database | DynamoDB (Single Table Design) |
| AI Model | Gemini 3.5 Flash-Lite |
| Validation | Zod |
| Build | esbuild |
| Monitoring | CloudWatch |

> Do not suggest swapping any of these unless the user explicitly requests it.

---

## API Surface

| Status | Method | Endpoint | Auth | Purpose |
|---|---|---|---|---|
| ✅ Done | GET | `/health` | None | Health check |
| ✅ Done | POST | `/v1/auth/signup` | None | User signup (email + password) |
| ✅ Done | POST | `/v1/auth/login` | None | User login (creates session cookie) |
| ✅ Done | POST | `/v1/auth/logout` | Session | Invalidate session & clear cookie |
| ✅ Done | GET | `/v1/auth/me` | Session | Get authenticated user info |
| ✅ Done | POST | `/v1/api-keys` | Session | Create API key (shown once) |
| ✅ Done | GET | `/v1/api-keys` | Session | List safe API key metadata |
| ✅ Done | DELETE | `/v1/api-keys/:keyId` | Session | Revoke API key |
| ✅ Done | GET | `/v1/usage` | Session / API Key | Aggregated usage summary by period |
| ✅ Done | GET | `/v1/usage/daily` | Session / API Key | Daily breakdown of requests & tokens |
| ✅ Done | POST | `/v1/resumes/upload-url` | API Key | Generate S3 presigned upload URL |
| ✅ Done | POST | `/v1/resumes/parse` | API Key | Parse resume with custom schema |
| 🔜 Post-MVP | DELETE | `/v1/resumes/:id` | API Key | Delete resume |

---

## Project Structure (Canonical)

```
parseflowai/
│
├── src/
│   ├── index.ts              ← Lambda entry point
│   ├── dev.ts                ← Local dev server
│   ├── app.ts                ← Hono app setup
│   ├── extractor.ts          ← Extractor Lambda (S3 event trigger)
│   │
│   ├── routes/
│   │   ├── health.ts         ← Health check route
│   │   ├── auth.ts           ← Signup, login, logout, me
│   │   ├── api-keys.ts       ← Create, list, revoke API keys
│   │   ├── usage.ts          ← Usage summary & daily metrics
│   │   ├── resumes.ts        ← upload-url route (API key protected)
│   │   └── parse.ts          ← parse route (API key protected)
│   │
│   ├── middleware/
│   │   ├── session.ts        ← Session cookie auth
│   │   ├── api-key.ts        ← Bearer API key auth
│   │   ├── auth.ts           ← Dual session/api-key auth
│   │   └── usage-tracker.ts  ← API request & duration tracking
│   │
│   ├── services/
│   │   ├── auth.service.ts   ← User signup, login, session lifecycle
│   │   ├── api-key.service.ts← API key generation, hashing, validation
│   │   ├── usage.service.ts  ← Usage tracking, tokens, periods, quota
│   │   ├── limits.service.ts ← Free/Pro/Enterprise plan limits
│   │   ├── resume.service.ts ← Orchestrates parse flow & user isolation
│   │   ├── s3.service.ts     ← Presigned URL, delete, fetch
│   │   ├── pdf.service.ts    ← Text extraction from PDF
│   │   ├── ai.service.ts     ← Gemini integration with token usage metadata
│   │   └── dynamo.service.ts ← DynamoDB client & resume records
│   │
│   ├── repositories/
│   │   ├── user.repository.ts   ← User & email lookup single-table queries
│   │   ├── session.repository.ts← Session storage with TTL
│   │   ├── api-key.repository.ts← API key and hash lookup queries
│   │   └── usage.repository.ts  ← Daily counters, atomic ADD, event logs
│   │
│   ├── schemas/
│   │   ├── auth.schema.ts    ← Zod: signup and login validation
│   │   ├── api-key.schema.ts ← Zod: API key creation validation
│   │   ├── usage.schema.ts   ← Zod: usage period queries
│   │   ├── upload.schema.ts  ← Zod: upload request validation
│   │   └── parse.schema.ts   ← Zod: shorthand schema validator
│   │
│   ├── utils/
│   │   ├── crypto.ts         ← Salted scrypt, SHA-256, secure tokens
│   │   └── time.ts           ← Period date calculations & formatting
│   │
│   ├── types/
│   │   ├── auth.ts           ← User, Session, ApiKey, AppEnv types
│   │   └── usage.ts          ← Usage, Token, Event, Summary types
│   │
│   └── lib/
│       ├── env.ts            ← Validated env vars (Zod)
│       └── logger.ts         ← Safe logger (no PII)
│
├── tests/
│   ├── auth.test.ts          ← Unit & integration tests for auth flow
│   ├── api-keys.test.ts      ← Unit & integration tests for API keys
│   ├── usage.test.ts         ← Unit & integration tests for usage tracking
│   ├── upload.route.test.ts  ← Upload route tests with auth & extraction
│   ├── parse.route.test.ts   ← Parse route tests with auth & user isolation
│   ├── ai.service.test.ts    ← AI service & token usage tests
│   ├── dynamo.service.test.ts← DynamoDB service tests
│   ├── pdf.service.test.ts   ← PDF extraction tests
│   ├── s3.service.test.ts    ← S3 service tests
│   └── extractor.test.ts     ← Extractor Lambda tests
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
- [x] Token usage metadata extraction (`promptTokenCount`, `candidatesTokenCount`, `totalTokenCount`)
- [x] Tested with real prompt & unit tests

### Phase 6 — Parse Route
- [x] `src/schemas/parse.schema.ts`
- [x] `src/services/resume.service.ts`
- [x] `src/routes/parse.ts`
- [x] End-to-end tested

### Phase 7 — Authentication, API Keys & Usage Tracking
- [x] Password hashing with salted scrypt & constant-time comparison (`src/utils/crypto.ts`)
- [x] High-entropy API key generation (`pf_live_...`, `pf_test_...`) and SHA-256 hashing
- [x] User repository with atomic email uniqueness check (`src/repositories/user.repository.ts`)
- [x] Session repository with TTL (`src/repositories/session.repository.ts`)
- [x] API key repository with fast hash lookup (`src/repositories/api-key.repository.ts`)
- [x] Usage repository with atomic daily counters and event tracking (`src/repositories/usage.repository.ts`)
- [x] Auth service (`signup`, `login`, `logout`, `validateSession`)
- [x] API key service (`createApiKey`, `listApiKeys`, `revokeApiKey`, `validateApiKey`)
- [x] Usage service (`trackUpload`, `trackParseStarted`, `trackParseSuccess`, `trackParseFailure`, `trackApiRequest`, `getUsageSummary`, `getDailyBreakdown`, `checkMonthlyQuota`)
- [x] Limits service with Free, Pro, Enterprise tiers (`src/services/limits.service.ts`)
- [x] Session authentication middleware (`src/middleware/session.ts`)
- [x] API key authentication middleware (`src/middleware/api-key.ts`)
- [x] Dual auth middleware (`src/middleware/auth.ts`)
- [x] Request tracking middleware (`src/middleware/usage-tracker.ts`)
- [x] Auth routes (`/v1/auth/signup`, `/v1/auth/login`, `/v1/auth/logout`, `/v1/auth/me`)
- [x] API key routes (`/v1/api-keys`, `GET`, `POST`, `DELETE /:keyId`)
- [x] Usage routes (`/v1/usage`, `GET`, `GET /daily`)
- [x] Resume endpoints protected with API key auth & user isolation enforced
- [x] Comprehensive test suite (73 tests passing across 28 suites)

---

## File Registry

| File | Status | Notes |
|---|---|---|
| `PRD.md` | ✅ Exists | Source of truth for requirements |
| `AICONTEXT.md` | ✅ Exists | This file — always update after changes |
| `docs/PARSEFLOWAI_AUTH_API_KEYS_USAGE.md` | ✅ Exists | Specification for Auth, API Keys, and Usage tracking |
| `src/types/auth.ts` | ✅ Exists | User, Session, ApiKey, and AppEnv type definitions |
| `src/types/usage.ts` | ✅ Exists | Usage, Token, Daily, and Summary type definitions |
| `src/utils/crypto.ts` | ✅ Exists | Scrypt password hashing, SHA-256, API key generation |
| `src/utils/time.ts` | ✅ Exists | UTC date helpers and period date calculation |
| `src/schemas/auth.schema.ts` | ✅ Exists | Zod validation for signup & login |
| `src/schemas/api-key.schema.ts` | ✅ Exists | Zod validation for API key creation |
| `src/schemas/usage.schema.ts` | ✅ Exists | Zod validation for usage query parameters |
| `src/repositories/user.repository.ts` | ✅ Exists | User profile & email index single-table operations |
| `src/repositories/session.repository.ts` | ✅ Exists | Session management with TTL in DynamoDB |
| `src/repositories/api-key.repository.ts` | ✅ Exists | API key storage, safe listing, and hash lookup |
| `src/repositories/usage.repository.ts` | ✅ Exists | Atomic daily counters (ADD) and event logs |
| `src/services/auth.service.ts` | ✅ Exists | User signup, login, session creation and validation |
| `src/services/api-key.service.ts` | ✅ Exists | API key generation, revocation, and Bearer validation |
| `src/services/limits.service.ts` | ✅ Exists | Plan limits & quota enforcement |
| `src/services/usage.service.ts` | ✅ Exists | Usage tracking, token aggregation, and period summary |
| `src/services/ai.service.ts` | ✅ Exists | Gemini abstraction with token usage metadata capture |
| `src/services/resume.service.ts` | ✅ Exists | Resume parsing orchestration with user isolation |
| `src/services/dynamo.service.ts` | ✅ Exists | Resume record DynamoDB operations |
| `src/services/pdf.service.ts` | ✅ Exists | Text extraction from PDF buffer via pdf-parse |
| `src/services/s3.service.ts` | ✅ Exists | Presigned URL generation and fetchFileFromS3 |
| `src/middleware/session.ts` | ✅ Exists | Session cookie authentication middleware |
| `src/middleware/api-key.ts` | ✅ Exists | Bearer API key authentication middleware |
| `src/middleware/auth.ts` | ✅ Exists | Dual session / API key auth middleware |
| `src/middleware/usage-tracker.ts` | ✅ Exists | Request counter & latency tracking middleware |
| `src/routes/auth.ts` | ✅ Exists | Signup, login, logout, me endpoints |
| `src/routes/api-keys.ts` | ✅ Exists | Create, list, revoke API key endpoints |
| `src/routes/usage.ts` | ✅ Exists | Usage summary & daily metrics endpoints |
| `src/routes/resumes.ts` | ✅ Exists | Upload URL route with API key protection & quota check |
| `src/routes/parse.ts` | ✅ Exists | Parse route with API key protection & token tracking |
| `tests/auth.test.ts` | ✅ Exists | Unit & integration tests for auth routes & sessions |
| `tests/api-keys.test.ts` | ✅ Exists | Unit & integration tests for API key management & auth |
| `tests/usage.test.ts` | ✅ Exists | Unit & integration tests for usage aggregation & quotas |
| `tests/upload.route.test.ts` | ✅ Exists | Upload route tests with API key authentication |
| `tests/parse.route.test.ts` | ✅ Exists | Parse route tests with API key auth & user isolation |
| `tests/ai.service.test.ts` | ✅ Exists | AI service tests with token usage metadata |

---

## Decision Log

| # | Decision | Reason | Date |
|---|---|---|---|
| 17 | Salted scrypt for password hashing | Industry-standard crypto with random 16-byte salt and constant-time buffer comparison (`crypto.timingSafeEqual`) | 2026-08-17 |
| 18 | `pf_live_` / `pf_test_` API key format | High entropy (256-bit), recognizable prefix, raw secret returned only once, SHA-256 stored | 2026-08-17 |
| 19 | Fast API key lookup by hash | `APIKEY_HASH#<sha256>` partition key item enables O(1) Bearer authentication without scans or GSI queries | 2026-08-17 |
| 20 | Atomic daily counters for usage | `ADD` operations on `USER#<userId>` / `USAGE#<YYYY-MM-DD>` allow cheap O(1) writes and fast range queries for period summaries | 2026-08-17 |
| 21 | Customer isolation on resume parsing | Resume parse endpoint verifies `record.userId === user.userId` to ensure complete tenant data isolation | 2026-08-17 |
| 22 | Token usage capture from Gemini | Captured from `response.usageMetadata` (`promptTokenCount`, `candidatesTokenCount`, `totalTokenCount`) | 2026-08-17 |
| 23 | Secure HTTP-only cookies for browser auth | Dashboard sessions use `HttpOnly`, `SameSite=Lax`, 30-day expiry to prevent XSS credential theft | 2026-08-17 |