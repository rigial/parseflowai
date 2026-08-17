# ParseFlowAI — Authentication, API Keys & Usage Tracking

## 1. Objective

Build the foundation for ParseFlowAI's self-serve SaaS layer without overbuilding a full enterprise dashboard.

The current product is an API that:

1. Generates a presigned S3 URL for resume uploads.
2. Parses a resume according to a caller-provided schema.
3. Returns structured JSON extracted by AI.

We now need:

- User signup
- User login
- Session management
- User/API-key ownership
- Secure API key generation and rotation
- API authentication using the generated API key
- Usage tracking
- Basic dashboard-ready usage data
- Tracking of uploaded resumes, parsed resumes, AI token usage, and request counts

The implementation must be designed so a dashboard UI can be added later without redesigning the backend.

---

# 2. Important Product Decision

Do NOT build a large dashboard in this task.

The goal is to build the backend foundation required for a self-serve SaaS product.

Build:

- Auth APIs
- API key APIs
- Usage/account APIs
- Database models
- Authentication middleware
- Usage tracking
- Basic account limits

Do NOT build:

- Billing
- Stripe integration
- Team/workspace management
- RBAC
- Admin dashboard
- Complex analytics
- Email marketing
- Social login
- Password reset email infrastructure unless already available in the codebase

Those can be added later.

---

# 3. Existing Technology Stack

The project currently uses:

- TypeScript
- Hono
- Node.js 20
- AWS Lambda
- AWS S3
- DynamoDB
- Zod
- AWS SDK v3
- esbuild
- pnpm

Existing package examples:

```json
{
  "dependencies": {
    "@aws-sdk/client-s3": "...",
    "@aws-sdk/s3-request-presigner": "...",
    "@hono/node-server": "...",
    "dotenv": "...",
    "hono": "...",
    "zod": "..."
  }
}
```

Continue using this stack unless there is a strong technical reason to change it.

---

# 4. High-Level Architecture

```text
                         ParseFlowAI
                              |
                    API Gateway / Lambda
                              |
                         Hono API
                              |
          +-------------------+-------------------+
          |                   |                   |
          v                   v                   v
       Auth APIs          API Key APIs        Usage APIs
          |                   |                   |
          +-------------------+-------------------+
                              |
                              v
                         DynamoDB
                              |
          +-------------------+-------------------+
          |                   |                   |
          v                   v                   v
         S3               Resume Parser        AI Provider
          |                   |                   |
          v                   v                   v
       Resume             Parse Result       Token Usage
       Storage
```

---

# 5. User Model

Create a `users` entity.

Minimum fields:

```ts
type User = {
  userId: string;
  email: string;
  passwordHash: string;

  status: "active" | "suspended";

  createdAt: string;
  updatedAt: string;
  lastLoginAt?: string;
};
```

Requirements:

- `userId` must be generated server-side.
- Email must be normalized to lowercase.
- Email must be unique.
- Never store a plaintext password.
- Never log passwords.
- Never return `passwordHash` in an API response.

---

# 6. Signup

Endpoint:

```http
POST /v1/auth/signup
```

Request:

```json
{
  "email": "user@example.com",
  "password": "strong-password"
}
```

Validation:

- Valid email
- Minimum password length: 8 characters
- Reject obviously invalid input
- Normalize email to lowercase

Response:

```json
{
  "user": {
    "userId": "usr_...",
    "email": "user@example.com"
  }
}
```

Do not return:

- password
- passwordHash
- API secret

---

# 7. Login

Endpoint:

```http
POST /v1/auth/login
```

Request:

```json
{
  "email": "user@example.com",
  "password": "strong-password"
}
```

Response should create an authenticated session.

Preferred response:

```json
{
  "user": {
    "userId": "usr_...",
    "email": "user@example.com"
  }
}
```

Use a secure HTTP-only cookie for the browser session if implementing browser authentication.

Cookie requirements:

- HttpOnly
- Secure in production
- SameSite=Lax or stricter where appropriate
- Appropriate expiration
- Do not store session secrets in localStorage

For API-only clients, API keys are used instead of browser sessions.

---

# 8. Session Model

Create a server-side session entity or equivalent secure session mechanism.

Example:

```ts
type Session = {
  sessionId: string;
  userId: string;

  createdAt: string;
  expiresAt: string;
};
```

Never expose the raw session identifier in application logs.

Provide:

```http
POST /v1/auth/logout
```

Logout must invalidate the current session.

---

# 9. API Key System

This is one of the most important parts of the project.

A logged-in user can create an API key that they use from their backend/application to call ParseFlowAI.

Endpoint:

```http
POST /v1/api-keys
```

Authenticated using the browser session.

Example response:

```json
{
  "apiKey": {
    "id": "key_...",
    "name": "Production",
    "key": "pf_live_...",
    "createdAt": "2026-08-17T00:00:00.000Z"
  }
}
```

## Critical Security Rule

The complete API key/secret must be shown ONLY once.

After creation:

- Store only a secure hash of the secret.
- Do not store the plaintext API secret.
- Do not return the plaintext API secret again.
- Do not log the plaintext API secret.

The user must copy it when it is created.

---

# 10. API Key Format

Use a recognizable format.

Example:

```text
pf_live_<random-secret>
```

or:

```text
pf_test_<random-secret>
```

The random secret must come from a cryptographically secure random generator.

Do NOT use:

- Math.random()
- timestamps
- UUID alone as the secret
- predictable values

The key should have enough entropy to prevent brute-force attacks.

---

# 11. API Key Storage

Store something similar to:

```ts
type ApiKey = {
  keyId: string;
  userId: string;

  name: string;

  keyPrefix: string;
  secretHash: string;

  environment: "live" | "test";

  status: "active" | "revoked";

  createdAt: string;
  lastUsedAt?: string;
  revokedAt?: string;
};
```

`keyPrefix` is safe to display in the dashboard.

Example:

```text
pf_live_abc123...
```

Do not store the complete secret.

---

# 12. API Key Authentication Middleware

Existing API endpoints should eventually support:

```http
Authorization: Bearer pf_live_xxxxxxxxx
```

Example:

```http
Authorization: Bearer pf_live_abc123...
```

Create Hono middleware:

```text
src/middleware/api-key.ts
```

Responsibilities:

1. Read Authorization header.
2. Validate Bearer format.
3. Extract API key.
4. Find the API key record.
5. Validate the secret against the stored hash.
6. Check key status.
7. Find the associated user.
8. Attach authenticated user context to Hono context.
9. Continue request.

Example conceptual context:

```ts
c.set("user", user);
c.set("apiKey", apiKey);
```

Routes can then access:

```ts
const user = c.get("user");
const apiKey = c.get("apiKey");
```

---

# 13. API Key Management

Authenticated users need:

### Create

```http
POST /v1/api-keys
```

### List

```http
GET /v1/api-keys
```

Response should contain only safe metadata:

```json
{
  "apiKeys": [
    {
      "id": "key_123",
      "name": "Production",
      "keyPrefix": "pf_live_abc...",
      "status": "active",
      "createdAt": "...",
      "lastUsedAt": "..."
    }
  ]
}
```

### Revoke

```http
DELETE /v1/api-keys/:keyId
```

Revoked keys must immediately stop working.

### Rotate

Rotation can be implemented as:

1. Create a new key.
2. Show the new secret once.
3. Keep the old key active until explicitly revoked.

Do not silently revoke the old key unless explicitly requested.

---

# 14. Resume Usage Tracking

Track every important resume lifecycle event.

At minimum:

```text
resume_uploaded
resume_parse_started
resume_parse_completed
resume_parse_failed
```

Track:

- userId
- apiKeyId
- resumeId
- timestamp
- status
- file size
- file type
- processing time

Example:

```ts
type ResumeUsage = {
  resumeId: string;
  userId: string;
  apiKeyId?: string;

  event:
    | "uploaded"
    | "parse_started"
    | "parse_completed"
    | "parse_failed";

  fileSize?: number;
  fileType?: string;

  processingTimeMs?: number;

  createdAt: string;
};
```

---

# 15. Usage Metrics

The system must be able to answer:

### Account-level

- How many resumes were uploaded?
- How many resumes were parsed?
- How many parsing requests failed?
- How many API requests were made?
- How many AI tokens were consumed?
- How many input tokens?
- How many output tokens?
- How many total tokens?
- How much processing time was used?

### Time-based

Support aggregation by:

- today
- last 7 days
- current month
- previous month

The data model should allow future daily/monthly aggregation.

---

# 16. AI Token Tracking

Whenever the AI provider returns usage information, capture it.

Example:

```ts
type TokenUsage = {
  userId: string;
  apiKeyId?: string;
  resumeId?: string;

  provider: string;
  model: string;

  inputTokens: number;
  outputTokens: number;
  totalTokens: number;

  createdAt: string;
};
```

Do not estimate token usage when the provider gives actual usage.

Use the provider's returned usage values.

Example:

```json
{
  "provider": "openai",
  "model": "gpt-...",
  "inputTokens": 1200,
  "outputTokens": 450,
  "totalTokens": 1650
}
```

---

# 17. API Request Tracking

Track API requests independently from resume parsing.

Example:

```ts
type ApiUsage = {
  userId: string;
  apiKeyId: string;

  route: string;
  method: string;

  statusCode: number;

  durationMs: number;

  createdAt: string;
};
```

Do not store sensitive request bodies.

Do not store:

- passwords
- Authorization header
- API secret
- complete resume contents
- raw AI prompts containing personal data

---

# 18. Usage Summary

Create an endpoint:

```http
GET /v1/usage
```

Example response:

```json
{
  "period": "current_month",
  "requests": 1240,
  "resumesUploaded": 500,
  "resumesParsed": 482,
  "parseFailures": 18,
  "inputTokens": 1250000,
  "outputTokens": 310000,
  "totalTokens": 1560000
}
```

Also support:

```http
GET /v1/usage?period=7d
GET /v1/usage?period=30d
GET /v1/usage?period=current_month
```

---

# 19. Usage Dashboard Data

The backend should provide enough information for a future dashboard to display:

```text
Current Month

API Requests
1,240

Resumes Uploaded
500

Resumes Parsed
482

Parse Failures
18

AI Tokens
1.56M

API Keys
2
```

Also provide daily usage data:

```json
{
  "daily": [
    {
      "date": "2026-08-11",
      "requests": 120,
      "resumesParsed": 45,
      "tokens": 120000
    }
  ]
}
```

---

# 20. DynamoDB Design

Prefer a single-table design if practical, but keep the implementation understandable.

Possible structure:

```text
PK                  SK

USER#usr_123        PROFILE

USER#usr_123        APIKEY#key_123

USER#usr_123        SESSION#session_123

USER#usr_123        USAGE#2026-08-17

USER#usr_123        RESUME#resume_123

USER#usr_123        TOKEN#resume_123
```

The exact DynamoDB indexes can be adjusted based on existing project structure.

Prioritize:

- predictable queries
- low read/write cost
- easy future aggregation

---

# 21. Usage Aggregation Strategy

Do not scan all usage records every time `/v1/usage` is called.

Prefer maintaining daily counters.

Example:

```text
USER#usr_123
USAGE#2026-08-17
```

contains:

```json
{
  "requests": 120,
  "resumesUploaded": 45,
  "resumesParsed": 42,
  "parseFailures": 3,
  "inputTokens": 120000,
  "outputTokens": 30000,
  "totalTokens": 150000
}
```

Use atomic DynamoDB updates where appropriate.

This makes usage reads cheap and fast.

---

# 22. Idempotency

Resume parsing and usage tracking should consider duplicate requests.

Eventually support:

```http
Idempotency-Key: <client-generated-key>
```

for expensive parse requests.

Do not implement complex idempotency behavior unless the existing architecture already supports it, but design the code so it can be added.

---

# 23. Security Requirements

This is a SaaS product handling resumes and personally identifiable information.

Mandatory:

- Passwords must be hashed.
- API secrets must be hashed.
- HTTPS in production.
- Never log API keys.
- Never log passwords.
- Never log Authorization headers.
- Never log full resume contents.
- Never expose S3 objects publicly.
- Use S3 presigned URLs.
- Use IAM roles in Lambda.
- Validate all request bodies using Zod.
- Validate API key authentication.
- Rate-limit authentication endpoints.
- Rate-limit API key creation.
- Rate-limit expensive resume parsing.
- Return generic authentication errors where appropriate.
- Do not reveal whether an arbitrary email exists during signup/login if that creates account enumeration risk.
- Use secure cookies for browser sessions.

---

# 24. Environment Variables

Use:

```env
AWS_REGION=ap-south-1
S3_BUCKET_NAME=parseflowai-resumes

# Authentication/session secrets
SESSION_SECRET=

# AI provider
AI_API_KEY=
```

Do not require AWS access keys in Lambda.

Lambda should use its IAM execution role.

For local development, use AWS CLI credentials or a local AWS credential provider.

Never commit secrets.

---

# 25. Project Structure

Prefer something close to:

```text
src/
├── index.ts
├── app.ts
│
├── routes/
│   ├── auth.ts
│   ├── api-keys.ts
│   ├── usage.ts
│   ├── upload.ts
│   └── parse.ts
│
├── middleware/
│   ├── auth.ts
│   ├── api-key.ts
│   └── rate-limit.ts
│
├── services/
│   ├── auth.service.ts
│   ├── api-key.service.ts
│   ├── usage.service.ts
│   ├── resume.service.ts
│   ├── s3.service.ts
│   └── ai.service.ts
│
├── repositories/
│   ├── user.repository.ts
│   ├── api-key.repository.ts
│   ├── session.repository.ts
│   └── usage.repository.ts
│
├── schemas/
│   ├── auth.schema.ts
│   ├── api-key.schema.ts
│   └── usage.schema.ts
│
├── utils/
│   ├── crypto.ts
│   ├── id.ts
│   └── time.ts
│
└── types/
    └── auth.ts
```

Adjust this to the existing project instead of unnecessarily restructuring working code.

---

# 26. API Authentication Model

There are two different authentication mechanisms.

## Browser/dashboard

```text
Email + Password
       ↓
Session Cookie
       ↓
Authenticated dashboard APIs
```

## Developer/API usage

```text
API Key
       ↓
Authorization: Bearer pf_live_...
       ↓
API Key Middleware
       ↓
User
       ↓
Resume API
```

Do not mix these mechanisms.

---

# 27. Resume API Authorization

Existing resume endpoints should require an API key.

Example:

```http
POST /v1/resumes/upload-url
Authorization: Bearer pf_live_xxx
```

and:

```http
POST /v1/resumes/parse
Authorization: Bearer pf_live_xxx
```

The authenticated user should be attached to the request context.

Every resume and usage record must contain the correct `userId`.

A user must never be able to access another user's:

- resumes
- parse results
- usage
- API keys
- sessions

---

# 28. Limits

Prepare the system for account limits.

Example initial limits:

```ts
type UsageLimits = {
  resumesPerMonth: number;
  apiRequestsPerMonth: number;
  maxFileSizeBytes: number;
};
```

Do not hard-code limits throughout the application.

Keep them in one place so a future billing system can provide:

```text
Free
Pro
Business
Enterprise
```

For now, use a simple default plan:

```ts
plan: "free"
```

---

# 29. Error Responses

Use consistent API errors.

Example:

```json
{
  "error": {
    "code": "INVALID_API_KEY",
    "message": "Invalid API key"
  }
}
```

Suggested codes:

```text
INVALID_REQUEST
UNAUTHORIZED
INVALID_CREDENTIALS
INVALID_API_KEY
API_KEY_REVOKED
USER_NOT_FOUND
EMAIL_ALREADY_EXISTS
RATE_LIMITED
USAGE_LIMIT_EXCEEDED
RESUME_NOT_FOUND
PARSE_FAILED
INTERNAL_ERROR
```

Do not expose internal AWS/AI errors directly to users.

---

# 30. Logging

Logs should be structured.

Good:

```json
{
  "event": "resume_parse_completed",
  "userId": "usr_123",
  "resumeId": "res_123",
  "durationMs": 1820,
  "totalTokens": 1450
}
```

Bad:

```text
API KEY: pf_live_abc...
PASSWORD: ...
RESUME CONTENT: John Doe...
```

Never log secrets or resume content.

---

# 31. Testing

Add tests for:

### Auth

- signup success
- duplicate email
- invalid email
- weak password
- login success
- login failure
- logout
- expired session

### API Keys

- create key
- key is only returned once
- key is hashed in storage
- valid key authentication
- invalid key
- revoked key
- key belongs to correct user

### Usage

- upload increments usage
- parse success increments parsed count
- parse failure increments failure count
- token usage is recorded
- daily aggregation works
- users cannot access another user's usage

### Authorization

Verify that:

```text
User A API key
    ↓
User A resources = allowed

User A API key
    ↓
User B resources = denied
```

---

# 32. Implementation Order

Implement in this order:

## Phase 1 — Data layer

- User model
- API key model
- Session model
- Usage model
- DynamoDB repository layer

## Phase 2 — Authentication

- Signup
- Login
- Logout
- Session middleware

## Phase 3 — API keys

- Create API key
- List API keys
- Revoke API key
- API key authentication middleware

## Phase 4 — Existing API integration

Protect:

```text
POST /v1/resumes/upload-url
POST /v1/resumes/parse
```

with API-key authentication.

Attach:

```text
userId
apiKeyId
```

to every operation.

## Phase 5 — Usage

Track:

- API requests
- resumes uploaded
- resumes parsed
- parse failures
- AI input tokens
- AI output tokens
- total tokens
- processing duration

## Phase 6 — Usage API

Implement:

```text
GET /v1/usage
GET /v1/usage/daily
```

## Phase 7 — Limits

Add a basic free plan and usage enforcement.

---

# 33. Definition of Done

The implementation is complete when:

- A user can sign up.
- A user can log in.
- A user receives a secure browser session.
- A user can log out.
- A logged-in user can create an API key.
- The complete API key is shown only once.
- API secrets are never stored in plaintext.
- API keys can be listed safely.
- API keys can be revoked.
- Resume upload requires a valid API key.
- Resume parsing requires a valid API key.
- Every operation is associated with a user.
- Resume uploads are tracked.
- Resume parses are tracked.
- Parse failures are tracked.
- AI input tokens are tracked.
- AI output tokens are tracked.
- Total tokens are tracked.
- Daily usage is aggregated.
- Monthly usage can be calculated.
- Usage can be queried through an API.
- Basic monthly limits exist.
- One user cannot access another user's data.
- Secrets are not logged.
- Tests cover authentication, authorization, API keys, and usage tracking.
- Existing resume upload/parse functionality continues to work.

---

# 34. Important Implementation Principle

Do not over-engineer.

The immediate goal is:

```text
User
  ↓
Signup/Login
  ↓
Create API Key
  ↓
Developer copies API Key
  ↓
Uses ParseFlowAI API
  ↓
Every request is associated with the user
  ↓
Usage is tracked
```

The future dashboard should consume the same backend APIs rather than introducing a second tracking system.

Build the backend foundation cleanly so that billing, plans, teams, and a full dashboard can be added later without changing the core API authentication model.
