import { Hono } from 'hono';
import { S3Service } from '../services/s3.service';
import { createRecord } from '../services/dynamo.service';
import { uploadRequestSchema } from '../schemas/upload.schema';
import { env } from '../lib/env';
import { logger } from '../lib/logger';

const resumes = new Hono();

resumes.post('/upload-url', async (c) => {
  try {
    let body: any;
    try {
      body = await c.req.json();
    } catch {
      return c.json({
        success: false,
        error: {
          code: 'INVALID_REQUEST',
          message: 'Invalid JSON request body',
        },
      }, 400);
    }

    if (!body || typeof body !== 'object') {
      return c.json({
        success: false,
        error: {
          code: 'INVALID_REQUEST',
          message: 'Request body must be a valid JSON object',
        },
      }, 400);
    }

    // Check for unsupported file types
    if (body.contentType !== undefined && body.contentType !== 'application/pdf') {
      return c.json({
        success: false,
        error: {
          code: 'UNSUPPORTED_FILE_TYPE',
          message: 'Only PDF files are supported',
        },
      }, 415);
    }

    // Check for file size exceeding MAX_FILE_SIZE_MB
    const maxSizeBytes = env.MAX_FILE_SIZE_MB * 1024 * 1024;
    if (typeof body.fileSizeBytes === 'number' && body.fileSizeBytes > maxSizeBytes) {
      return c.json({
        success: false,
        error: {
          code: 'FILE_TOO_LARGE',
          message: `File size exceeds the maximum limit of ${env.MAX_FILE_SIZE_MB}MB`,
        },
      }, 413);
    }

    const parsed = uploadRequestSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({
        success: false,
        error: {
          code: 'INVALID_REQUEST',
          message: parsed.error.issues[0]?.message || 'Invalid request body',
        },
      }, 400);
    }

    const { fileName, contentType, fileSizeBytes, customerId } = parsed.data;

    // 1. Generate presigned S3 upload URL and unique resumeId
    const uploadData = await S3Service.generatePresignedUploadUrl(contentType);
    const { uploadUrl, resumeId, expiresIn } = uploadData;

    // 2. Initialize resume record in DynamoDB with status: "pending"
    await createRecord({
      resumeId,
      customerId: customerId || 'anonymous',
      fileName,
      fileSizeBytes: fileSizeBytes || 0,
    });

    logger.info('Upload URL generated and DynamoDB record created', {
      resumeId,
      fileName,
    });

    // 3. Return response to client immediately
    return c.json({
      success: true,
      data: {
        resumeId,
        uploadUrl,
      },
    }, 200);
  } catch (error) {
    logger.error('Failed to generate upload URL', {
      error: (error as Error).message,
    });

    return c.json({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Failed to generate upload URL',
      },
    }, 500);
  }
});

export default resumes;