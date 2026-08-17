import { Hono } from "hono";
import type { Context } from "hono";
import { parseRequestSchema } from "../schemas/parse.schema";
import { parseResume } from "../services/resume.service";

const parse = new Hono();

async function handleParse(c: Context) {
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
}

parse.post("/v1/resumes/parse", handleParse);
parse.post("/parse", handleParse);

export default parse;