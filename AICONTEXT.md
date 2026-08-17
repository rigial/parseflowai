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
| AI Model | Gemini 2.5 Flash-Lite |
| Validation | Zod |
| Build | esbuild |
| Monitoring | CloudWatch |

> Do not suggest swapping any of these unless the user explicitly requests it.

---

## MVP API Surface

| Status | Method | Endpoint | Purpose |
|---|---|---|---|
| ⬜ Not started | GET | `/health` | Health check |
| ⬜ Not started | POST | `/v1/resumes/upload-url` | Generate S3 presigned upload URL |
| ⬜ Not started | POST | `/v1/resumes/parse` | Parse resume with custom schema |
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
- [x] `package.json` with pnpm + all dependencies (added `tsx` for dev watch)
- [x] `tsconfig.json`
- [x] `esbuild` build script
- [x] `.env.example` with all required vars
- [ ] `src/lib/env.ts` — Zod-validated env
- [ ] `src/lib/logger.ts` — PII-safe logger
- [x] `src/app.ts` — Hono app
- [x] `src/index.ts` — Local dev server entry with `@hono/node-server`

### Phase 2 — Health Route
- [x] `src/routes/health.ts`
- [x] Registered in `app.ts`
- [x] Tested locally

### Phase 3 — Upload URL
- [ ] `src/schemas/upload.schema.ts`
- [ ] `src/services/s3.service.ts` — presigned PUT URL
- [x] `src/routes/resumes.ts` (stub)
- [ ] Tested locally with real S3 bucket

### Phase 4 — PDF Parsing
- [ ] `src/services/pdf.service.ts`
- [ ] Text extraction from buffer (text-based PDFs)
- [ ] Tested with sample resume PDF

### Phase 5 — AI Service
- [ ] `src/services/ai.service.ts`
- [ ] Gemini 2.5 Flash-Lite integration
- [ ] Dynamic schema → prompt builder
- [ ] Zod validation of AI response
- [ ] Tested with real prompt

### Phase 6 — Parse Route
- [ ] `src/schemas/parse.schema.ts`
- [ ] `src/services/resume.service.ts`
- [x] `src/routes/parse.ts` (stub)
- [ ] End-to-end tested

### Phase 7 — Security Hardening
- [ ] API key auth middleware (`Authorization: Bearer rp_live_...`)
- [ ] Rate limiting middleware
- [ ] File type validation
- [ ] File size validation
- [ ] S3 auto-delete after 24h (Lambda TTL or S3 lifecycle rule)
- [ ] No PII in logs confirmed

### Phase 8 — Deployment
- [ ] AWS Lambda packaging via esbuild
- [ ] API Gateway setup
- [ ] S3 bucket (private, lifecycle rules)
- [ ] CloudWatch logging
- [ ] Environment variables in Lambda console
- [ ] Smoke test on live URL

---

## File Registry

> Update this every time a file is created or significantly changed.

| File | Status | Notes |
|---|---|---|
| `PRD.md` | ✅ Exists | Source of truth for requirements |
| `AICONTEXT.md` | ✅ Exists | This file — always update after changes |
| `package.json` | ✅ Updated | Added tsx for local dev script |
| `src/index.ts` | ✅ Updated | Server entry point with dotenv |
| `src/app.ts` | ✅ Exists | Hono application routes |
| `src/routes/health.ts` | ✅ Exists | Health check route |
| `src/routes/resumes.ts` | ✅ Exists | Resume upload route stub |
| `src/routes/parse.ts` | ✅ Exists | Parse route stub |

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

---

## Environment Variables

> All vars must be defined in `.env.example`. Validated at startup via `src/lib/env.ts`.

| Variable | Required | Description |
|---|---|---|
| `AWS_REGION` | ✅ | AWS region |
| `S3_BUCKET_NAME` | ✅ | Private S3 bucket for resumes |
| `S3_PRESIGNED_URL_EXPIRY` | ✅ | Seconds before upload URL expires (default: 900) |
| `MAX_FILE_SIZE_MB` | ✅ | Max upload size in MB |
| `GEMINI_API_KEY` | ✅ | Gemini API key |
| `API_KEY_SECRET` | ✅ | Shared secret for `rp_live_` bearer auth (MVP) |
| `RESUME_TTL_HOURS` | ✅ | Hours before S3 file is deleted (default: 24) |
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

**Success:**
```json
{
  "success": true,
  "data": { }
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