import { z } from 'zod';

export const createApiKeySchema = z.object({
  name: z.string().trim().min(1, 'Key name is required').max(64, 'Key name too long').default('Default'),
  environment: z.enum(['live', 'test']).default('live'),
});

export type CreateApiKeyInput = z.infer<typeof createApiKeySchema>;
