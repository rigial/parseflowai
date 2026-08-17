import { Hono } from 'hono';

import { S3Service } from '../services/s3.service.js';
import { uploadRequestSchema } from '../schemas/upload.schema.js';

const resumes = new Hono();

resumes.post('/upload-url', async (c) => {
  try {
    const body = await c.req.json();
    const parsed = uploadRequestSchema.safeParse(body);
    
    if (!parsed.success) {
      return c.json({
        success: false,
        error: {
          code: 'INVALID_REQUEST',
          message: parsed.error.issues[0]?.message || 'Invalid request body',
        }
      }, 400);
    }

    const { contentType } = parsed.data;
    const result = await S3Service.generatePresignedUploadUrl(contentType);

    return c.json({
      success: true,
      data: result,
    });
  } catch (error) {
    console.error('Error generating presigned URL:', error);
    return c.json({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Failed to generate upload URL',
      }
    }, 500);
  }
});

export default resumes;