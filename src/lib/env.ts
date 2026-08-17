import { z } from 'zod';
import dotenv from 'dotenv';

dotenv.config();

const envSchema = z.object({
  AWS_REGION: z.string().min(1).default(process.env.AWS_REGION || 'ap-south-1'),
  AWS_S3_BUCKET: z.string().min(1).default(process.env.AWS_S3_BUCKET || process.env.S3_BUCKET_NAME || 'parseflowai'),
  S3_BUCKET_NAME: z.string().min(1).default(process.env.S3_BUCKET_NAME || process.env.AWS_S3_BUCKET || 'parseflowai'),
  DYNAMODB_TABLE_NAME: z.string().min(1).default(process.env.DYNAMODB_TABLE_NAME || process.env.AWS_DYNAMODB_TABLE_NAME || 'parseflowai-resumes'),
  S3_PRESIGNED_URL_EXPIRY: z.coerce.number().default(900),
  MAX_FILE_SIZE_MB: z.coerce.number().default(5),
  GEMINI_API_KEY: z.string().min(1).default(process.env.GEMINI_API_KEY || 'test-gemini-key'),
  GEMINI_MODEL: z.string().min(1).default(process.env.GEMINI_MODEL || 'gemini-3.5-flash-lite'),
  API_KEY_SECRET: z.string().optional().default(''),
  RESUME_TTL_HOURS: z.coerce.number().default(24),
  NODE_ENV: z.enum(['development', 'production']).default('development'),
});

const parsedEnv = envSchema.safeParse(process.env);

if (!parsedEnv.success) {
  console.error('❌ Invalid environment variables:', parsedEnv.error.format());
  process.exit(1);
}

export const env = parsedEnv.data;
