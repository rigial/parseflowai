import { z } from 'zod';

export const usageQuerySchema = z.object({
  period: z
    .enum(['today', '7d', '30d', 'current_month', 'previous_month'])
    .default('current_month'),
});

export type UsageQueryInput = z.infer<typeof usageQuerySchema>;
