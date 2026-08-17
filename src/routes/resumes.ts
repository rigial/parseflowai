import { Hono } from 'hono';
import { S3Service } from '../services/s3.service';
import { createRecord } from '../services/dynamo.service';
import { UsageService } from '../services/usage.service';
import { uploadRequestSchema } from '../schemas/upload.schema';
import { apiKeyAuth } from '../middleware/api-key';
import { env } from '../lib/env';
import { logger } from '../lib/logger';
import type { ApiKey, AppEnv, User } from '../types/auth';

const resumes = new Hono<AppEnv>();

// Protect upload-url route with API key authentication
resumes.use('*', apiKeyAuth);

resumes.post('/upload-url', async (c) => {
  const user = c.get('user') as User;
  const apiKey = c.get('apiKey') as ApiKey | undefined;

  try {
    let body: any;
    try {
      body = await c.req.json();
    } catch {
      return c.json(
        {
          success: false,
          error: {
            code: 'INVALID_REQUEST',
            message: 'Invalid JSON request body',
          },
        },
        400
      );
    }

    if (!body || typeof body !== 'object') {
      return c.json(
        {
          success: false,
          error: {
            code: 'INVALID_REQUEST',
            message: 'Request body must be a valid JSON object',
          },
        },
        400
      );
    }

    // Check for unsupported file types
    if (body.contentType !== undefined && body.contentType !== 'application/pdf') {
      return c.json(
        {
          success: false,
          error: {
            code: 'UNSUPPORTED_FILE_TYPE',
            message: 'Only PDF files are supported',
          },
        },
        415
      );
    }

    // Check for file size exceeding MAX_FILE_SIZE_MB
    const maxSizeBytes = env.MAX_FILE_SIZE_MB * 1024 * 1024;
    if (typeof body.fileSizeBytes === 'number' && body.fileSizeBytes > maxSizeBytes) {
      return c.json(
        {
          success: false,
          error: {
            code: 'FILE_TOO_LARGE',
            message: `File size exceeds the maximum limit of ${env.MAX_FILE_SIZE_MB}MB`,
          },
        },
        413
      );
    }

    const parsed = uploadRequestSchema.safeParse(body);
    if (!parsed.success) {
      return c.json(
        {
          success: false,
          error: {
            code: 'INVALID_REQUEST',
            message: parsed.error.issues[0]?.message || 'Invalid request body',
          },
        },
        400
      );
    }

    const { fileName, contentType, fileSizeBytes } = parsed.data;

    // Check monthly quota limits
    const quota = await UsageService.checkMonthlyQuota(user, 'upload');
    if (!quota.allowed) {
      return c.json(
        {
          success: false,
          error: {
            code: 'USAGE_LIMIT_EXCEEDED',
            message: `Monthly resume upload limit reached (${quota.limit} resumes per month on ${user.plan || 'free'} plan). Please upgrade to parse more resumes.`,
          },
        },
        429
      );
    }

    // 1. Generate presigned S3 upload URL and unique resumeId
    const uploadData = await S3Service.generatePresignedUploadUrl(contentType);
    const { uploadUrl, resumeId } = uploadData;

    // 2. Initialize resume record in DynamoDB with status: "pending"
    await createRecord({
      resumeId,
      customerId: user.userId,
      userId: user.userId,
      apiKeyId: apiKey?.keyId,
      fileName,
      fileSizeBytes: fileSizeBytes || 0,
    });

    // 3. Track upload usage metrics and event
    await UsageService.trackUpload({
      userId: user.userId,
      apiKeyId: apiKey?.keyId,
      resumeId,
      fileSize: fileSizeBytes || 0,
      fileType: contentType,
    });

    logger.info('Upload URL generated and DynamoDB record created', {
      resumeId,
      userId: user.userId,
    });

    // 4. Return response to client
    return c.json(
      {
        success: true,
        data: {
          resumeId,
          uploadUrl,
        },
      },
      200
    );
  } catch (error) {
    logger.error('Failed to generate upload URL', {
      error: (error as Error).message,
    });

    return c.json(
      {
        success: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to generate upload URL',
        },
      },
      500
    );
  }
});

export default resumes;