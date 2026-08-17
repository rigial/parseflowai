# AI Service + /v1/resumes/parse — Implementation Guide

> **For Claude Code:** Read this entire file before writing any code.
> Implement exactly as specified. Do not deviate from field names, types, or operation signatures.

---

## ⚠️ Model name mismatch — confirm before building

Two different model names have shown up across this project:

| Source | Model name |
|---|---|
| PRD.md / AICONTEXT.md | `gemini-2.5-flash-lite` |
| This request | `gemini-3.1-flash-lite` |

**Do not hardcode either.** Read the model name from the `GEMINI_MODEL` env var so this is a config change, not a code change, whichever is correct. Verify the exact model string against the current Gemini API docs before first deploy — an incorrect model name fails at request time, not at build time.

---

## How It Works

```
POST /v1/resumes/parse  { resumeId, schema }
        ↓
Zod validates request body
        ↓
dynamo.service.ts → getRecord(resumeId)
        ↓
status === "pending" → 202 EXTRACTION_PENDING
status === "failed"  → 422 PARSE_FAILED
status === "ready"   → continue
        ↓
Convert user's simple schema → Gemini responseSchema format
        ↓
ai.service.ts → Gemini generateContent()
  - contents: extractedText + instructions
  - config.responseSchema: converted schema
  - config.responseMimeType: "application/json"
        ↓
Parse response.text as JSON
        ↓
Zod validates the AI's JSON output against the user's schema
        ↓
success → { success: true, data: {...} }
failure → 502 AI_ERROR
```

---

## Environment Variables

Add to `.env.example` and `src/lib/env.ts`:

```bash
GEMINI_API_KEY=your_key_here
GEMINI_MODEL=gemini-3.1-flash-lite
```

**`src/lib/env.ts` — add to the Zod schema:**

```typescript
GEMINI_API_KEY: z.string().min(1),
GEMINI_MODEL: z.string().min(1),
```

> Confirm both are also set in the `parseflowai-api` Lambda environment variables and in GitHub Secrets (`GEMINI_API_KEY`, `GEMINI_MODEL`). The Extractor Lambda does NOT need these — it never calls Gemini.

---

## Dependencies

```bash
pnpm add @google/genai
```

---

## Files to Create / Modify

```
src/
├── schemas/
│   └── parse.schema.ts      ← NEW — Zod request/response validation
├── services/
│   ├── ai.service.ts        ← NEW — Gemini abstraction
│   └── resume.service.ts    ← NEW — orchestrates the parse flow
└── routes/
    └── parse.ts             ← MODIFY — replace stub with real logic
```

---

## Part 1 — Understanding the schema conversion problem

The customer sends a **simple shorthand schema** in their request, per the PRD:

```json
{
  "resumeId": "res_123",
  "schema": {
    "name": "string",
    "email": "string",
    "skills": ["string"],
    "experience": [
      { "company": "string", "role": "string" }
    ]
  }
}
```

Gemini's `responseSchema` needs a **different, more verbose format**:

```json
{
  "type": "object",
  "properties": {
    "name": { "type": "string" },
    "email": { "type": "string" },
    "skills": { "type": "array", "items": { "type": "string" } },
    "experience": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "company": { "type": "string" },
          "role": { "type": "string" }
        },
        "required": ["company", "role"]
      }
    }
  },
  "required": ["name", "email", "skills", "experience"]
}
```

**You must write a converter function** that transforms the customer's shorthand into Gemini's format. This is the core logic of `ai.service.ts`.

---

## Part 2 — `src/schemas/parse.schema.ts`

```typescript
import { z } from "zod";

// The shorthand schema value types a customer can send.
// Recursive type: string leaf, array of shorthand, or nested object of shorthand.
type SchemaShorthand =
  | "string"
  | "number"
  | "boolean"
  | SchemaShorthand[]
  | { [key: string]: SchemaShorthand };

const schemaShorthandValidator: z.ZodType<SchemaShorthand> = z.lazy(() =>
  z.union([
    z.literal("string"),
    z.literal("number"),
    z.literal("boolean"),
    z.array(schemaShorthandValidator),
    z.record(z.string(), schemaShorthandValidator),
  ])
);

export const parseRequestSchema = z.object({
  resumeId: z.string().min(1),
  schema: z.record(z.string(), schemaShorthandValidator),
});

export type ParseRequest = z.infer<typeof parseRequestSchema>;
export type { SchemaShorthand };
```

> This validates that the customer's `schema` field only contains `"string"`, `"number"`, `"boolean"`, nested objects, or arrays of those — never arbitrary junk. Reject early with `INVALID_REQUEST` if this fails.

---

## Part 3 — `src/services/ai.service.ts`

### 3a. Schema converter — shorthand → Gemini format

```typescript
import type { SchemaShorthand } from "../schemas/parse.schema";

// Converts the customer's shorthand schema into Gemini's responseSchema format.
function convertToGeminiSchema(shorthand: SchemaShorthand): any {
  // Leaf types
  if (shorthand === "string") return { type: "string" };
  if (shorthand === "number") return { type: "number" };
  if (shorthand === "boolean") return { type: "boolean" };

  // Array — shorthand is [itemShorthand], always exactly one element
  if (Array.isArray(shorthand)) {
    return {
      type: "array",
      items: convertToGeminiSchema(shorthand[0]),
    };
  }

  // Object — shorthand is a record of key -> shorthand
  const properties: Record<string, any> = {};
  const required: string[] = [];

  for (const [key, value] of Object.entries(shorthand)) {
    properties[key] = convertToGeminiSchema(value);
    required.push(key); // every field the customer asked for is required
  }

  return {
    type: "object",
    properties,
    required,
  };
}
```

### 3b. Gemini client setup

```typescript
import { GoogleGenAI } from "@google/genai";
import { env } from "../lib/env";

const ai = new GoogleGenAI({ apiKey: env.GEMINI_API_KEY });
```

### 3c. The extraction function

```typescript
import type { SchemaShorthand } from "../schemas/parse.schema";

export async function extractStructuredData(
  resumeText: string,
  schema: Record<string, SchemaShorthand>
): Promise<unknown> {
  const geminiSchema = convertToGeminiSchema(schema);

  const response = await ai.models.generateContent({
    model: env.GEMINI_MODEL,
    contents: `Extract the following information from this resume:\n\n${resumeText}`,
    config: {
      responseMimeType: "application/json",
      responseSchema: geminiSchema,
    },
  });

  if (!response.text) {
    throw new Error("Gemini returned an empty response");
  }

  try {
    return JSON.parse(response.text);
  } catch {
    throw new Error("Gemini response was not valid JSON");
  }
}
```

> **Do not log `resumeText` or the parsed result anywhere in this function.** Both can contain PII. If you add logging here, log only the `resumeId` (passed in from the caller) and success/failure — never resume content.

### 3d. Full file assembly order

```typescript
// src/services/ai.service.ts

import { GoogleGenAI } from "@google/genai";
import { env } from "../lib/env";
import type { SchemaShorthand } from "../schemas/parse.schema";

const ai = new GoogleGenAI({ apiKey: env.GEMINI_API_KEY });

function convertToGeminiSchema(shorthand: SchemaShorthand): any { /* as above */ }

export async function extractStructuredData(
  resumeText: string,
  schema: Record<string, SchemaShorthand>
): Promise<unknown> { /* as above */ }
```

---

## Part 4 — `src/services/resume.service.ts`

This orchestrates the whole parse flow: read DynamoDB, branch on status, call AI, return result.

```typescript
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
```

---

## Part 5 — `src/routes/parse.ts`

Replace the existing stub entirely with this logic.

```typescript
import { Hono } from "hono";
import { parseRequestSchema } from "../schemas/parse.schema";
import { parseResume } from "../services/resume.service";

const parse = new Hono();

parse.post("/v1/resumes/parse", async (c) => {
  const body = await c.req.json().catch(() => null);

  const validation = parseRequestSchema.safeParse(body);
  if (!validation.success) {
    return c.json(
      {
        success: false,
        error: { code: "INVALID_REQUEST", message: "Invalid resume schema" },
      },
      400
    );
  }

  const { resumeId, schema } = validation.data;
  const result = await parseResume(resumeId, schema);

  switch (result.outcome) {
    case "not_found":
      return c.json(
        { success: false, error: { code: "RESUME_NOT_FOUND", message: "Resume not found" } },
        404
      );

    case "pending":
      return c.json(
        {
          success: false,
          error: {
            code: "EXTRACTION_PENDING",
            message: "Resume is still being processed, retry in a few seconds",
          },
        },
        202
      );

    case "failed":
      return c.json(
        { success: false, error: { code: "PARSE_FAILED", message: "Could not extract text from this PDF" } },
        422
      );

    case "ai_error":
      return c.json(
        { success: false, error: { code: "AI_ERROR", message: "AI failed to process the resume" } },
        502
      );

    case "success":
      return c.json({ success: true, data: result.data }, 200);
  }
});

export default parse;
```

> Confirm this router is mounted in `src/app.ts` (it should already be, per the existing stub).

---

## Part 6 — Request / Response Examples

**Request:**
```http
POST /v1/resumes/parse
Authorization: Bearer rp_live_xxxxxxxxx
Content-Type: application/json

{
  "resumeId": "res_abc123",
  "schema": {
    "name": "string",
    "email": "string",
    "skills": ["string"],
    "experience": [
      { "company": "string", "role": "string" }
    ]
  }
}
```

**Success response:**
```json
{
  "success": true,
  "data": {
    "name": "John Doe",
    "email": "john@example.com",
    "skills": ["React Native", "TypeScript", "AWS"],
    "experience": [
      { "company": "ABC Technologies", "role": "Software Engineer" }
    ]
  }
}
```

**Pending response (202):**
```json
{
  "success": false,
  "error": {
    "code": "EXTRACTION_PENDING",
    "message": "Resume is still being processed, retry in a few seconds"
  }
}
```

---

## Part 7 — Testing Locally

1. Confirm `.env` has `GEMINI_API_KEY` and `GEMINI_MODEL` set
2. Upload a real PDF resume through the existing upload flow, wait a few seconds for the Extractor Lambda / local extraction to finish
3. Check DynamoDB — confirm `status: "ready"` and `extractedText` is populated
4. Call `/v1/resumes/parse` with a simple schema:
   ```bash
   curl -X POST http://localhost:3000/v1/resumes/parse \
     -H "Authorization: Bearer rp_live_test" \
     -H "Content-Type: application/json" \
     -d '{"resumeId":"res_abc123","schema":{"name":"string","email":"string","skills":["string"]}}'
   ```
5. Confirm the response matches the schema shape exactly — no extra fields, no missing fields
6. Test the `pending`, `not_found`, and `failed` paths by calling `/parse` with a made-up `resumeId` and with a resume still processing

---

## Part 8 — Cost & Reliability Notes

- **`required` on every field** — the converter marks every customer-requested field as required in the Gemini schema. This forces Gemini to always return every field, using `null` or an empty value if it genuinely can't find something, rather than omitting the key. This keeps the response shape predictable for the customer.
- **No retry logic in this pass.** If Gemini fails or times out, `resume.service.ts` returns `ai_error` immediately. Retry-on-failure is a good v1.1 candidate but is out of scope here — do not add it.
- **Gemini API errors are caught broadly.** Network errors, invalid API key, malformed schema, and rate limits all currently collapse into a generic `AI_ERROR`. This is acceptable for MVP; don't build per-error-type handling yet.

---

## After Writing the Code

Update `AICONTEXT.md`:

1. **File Registry** — mark as `✅ Exists`:
   - `src/schemas/parse.schema.ts`
   - `src/services/ai.service.ts`
   - `src/services/resume.service.ts`
   - `src/routes/parse.ts` — update note from "stub" to "full implementation"

2. **Progress Tracker Phase 6 (AI Service)** and **Phase 7 (Parse Route)** — check off all items once tested end to end

3. **Decision Log** — add:
   - `GEMINI_MODEL` kept as an env var, not hardcoded — model name changed once already during this project; keeping it configurable avoids a code deploy for a config change
   - Shorthand-to-Gemini-schema converter — customers use a simple flat/nested shorthand (per PRD); `ai.service.ts` handles translation to Gemini's verbose JSON Schema format internally so the public API stays simple
   - All customer-requested schema fields marked `required` in the Gemini call — forces consistent response shape rather than Gemini silently omitting fields it couldn't find

4. **Environment Variables table** — add `GEMINI_MODEL` row alongside the existing `GEMINI_API_KEY` row
