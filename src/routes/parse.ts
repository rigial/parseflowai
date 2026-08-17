import { Hono } from "hono";
import type { Context } from "hono";
import { parseRequestSchema } from "../schemas/parse.schema";
import { parseResume } from "../services/resume.service";
import { UsageService } from "../services/usage.service";
import { apiKeyAuth } from "../middleware/api-key";
import type { ApiKey, AppEnv, User } from "../types/auth";

const parse = new Hono<AppEnv>();

// Protect parse endpoints with API key authentication
parse.use("*", apiKeyAuth);

async function handleParse(c: Context<AppEnv>) {
  const user = c.get("user") as User;
  const apiKey = c.get("apiKey") as ApiKey | undefined;

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json(
      {
        success: false,
        error: { code: "INVALID_REQUEST", message: "Invalid JSON request body" },
      },
      400
    );
  }

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

  // Track start of parse
  UsageService.trackParseStarted({
    userId: user.userId,
    apiKeyId: apiKey?.keyId,
    resumeId,
  }).catch(() => {});

  const result = await parseResume(resumeId, schema, user.userId);

  switch (result.outcome) {
    case "not_found":
    case "unauthorized":
      return c.json(
        {
          success: false,
          error: { code: "RESUME_NOT_FOUND", message: "Resume not found" },
        },
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
      await UsageService.trackParseFailure({
        userId: user.userId,
        apiKeyId: apiKey?.keyId,
        resumeId,
      });
      return c.json(
        {
          success: false,
          error: { code: "PARSE_FAILED", message: "Could not extract text from this PDF" },
        },
        422
      );

    case "ai_error":
      await UsageService.trackParseFailure({
        userId: user.userId,
        apiKeyId: apiKey?.keyId,
        resumeId,
      });
      return c.json(
        {
          success: false,
          error: { code: "AI_ERROR", message: "AI failed to process the resume" },
        },
        502
      );

    case "success":
      await UsageService.trackParseSuccess({
        userId: user.userId,
        apiKeyId: apiKey?.keyId,
        resumeId,
        durationMs: result.durationMs,
        tokenUsage: result.tokenUsage,
      });
      return c.json({ success: true, data: result.data }, 200);
  }
}

parse.post("/v1/resumes/parse", handleParse);
parse.post("/parse", handleParse);

export default parse;