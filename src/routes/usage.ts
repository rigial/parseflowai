import { Hono } from 'hono';
import { UsageService } from '../services/usage.service';
import { usageQuerySchema } from '../schemas/usage.schema';
import { dualAuth } from '../middleware/auth';
import type { AppEnv, User } from '../types/auth';

const usage = new Hono<AppEnv>();

// Usage endpoints can be called from Dashboard (Session) or via API Key
usage.use('*', dualAuth);

/**
 * GET / (also /v1/usage)
 * Returns aggregated usage summary metrics for a period.
 */
usage.get('/', async (c) => {
  const user = c.get('user') as User;
  const rawQuery = c.req.query();
  const validation = usageQuerySchema.safeParse(rawQuery);

  const period = validation.success ? validation.data.period : 'current_month';
  const summary = await UsageService.getUsageSummary(user.userId, period);

  return c.json(summary, 200);
});

/**
 * GET /daily (also /v1/usage/daily)
 * Returns daily breakdown of usage over a period.
 */
usage.get('/daily', async (c) => {
  const user = c.get('user') as User;
  const rawQuery = c.req.query();
  const validation = usageQuerySchema.safeParse(rawQuery);

  const period = validation.success ? validation.data.period : 'current_month';
  const breakdown = await UsageService.getDailyBreakdown(user.userId, period);

  return c.json(breakdown, 200);
});

export default usage;
