import type { Context, Next } from 'hono';
import { UsageService } from '../services/usage.service';
import type { ApiKey, AppEnv, User } from '../types/auth';

export async function usageTracker(c: Context<AppEnv>, next: Next) {
  const start = Date.now();
  await next();
  const durationMs = Date.now() - start;

  const user = c.get('user') as User | undefined;
  const apiKey = c.get('apiKey') as ApiKey | undefined;

  if (user) {
    const route = c.req.path;
    const method = c.req.method;
    const statusCode = c.res.status || 200;

    UsageService.trackApiRequest({
      userId: user.userId,
      apiKeyId: apiKey ? apiKey.keyId : 'session',
      route,
      method,
      statusCode,
      durationMs,
    }).catch(() => {});
  }
}
