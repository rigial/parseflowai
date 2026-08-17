import { z } from 'zod';
import dotenv from 'dotenv';

dotenv.config();

const envSchema = z.object({
  AWS_REGION: z.string().min(1),
  AWS_S3_BUCKET: z.string().min(1),
  DYNAMODB_TABLE_NAME: z.string().min(1).default(process.env.AWS_DYNAMODB_TABLE_NAME || 'parseflowai-resumes'),
  S3_PRESIGNED_URL_EXPIRY: z.coerce.number().default(900),
  MAX_FILE_SIZE_MB: z.coerce.number().default(5),
  GEMINI_API_KEY: z.string().min(1),
  API_KEY_SECRET: z.string().min(1),
  RESUME_TTL_HOURS: z.coerce.number().default(24),
  NODE_ENV: z.enum(['development', 'production']).default('development'),
});

const parsedEnv = envSchema.safeParse(process.env);

if (!parsedEnv.success) {
  console.error('❌ Invalid environment variables:', parsedEnv.error.format());
  process.exit(1);
}

export const env = parsedEnv.data;
