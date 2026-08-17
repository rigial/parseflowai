import type { Context, Next } from 'hono';
import { UsageService } from '../services/usage.service';
import type { ApiKey, AppEnv, User } from '../types/auth';

export async function usageTracker(c: Context<AppEnv>, next: Next) {
  const start = Date.now();
  await next();
  const durationMs = Date.now() - start;

  const user = c.get('user') as User | undefined;
  const apiKey = c.get('apiKey') as ApiKey | undefined;

  // Only track API requests made with an API Key (developer API hits), NOT internal dashboard session browsing
  if (apiKey && user) {
    const route = c.req.path;
    const method = c.req.method;
    const statusCode = c.res.status || 200;

    UsageService.trackApiRequest({
      userId: user.userId,
      apiKeyId: apiKey.keyId,
      route,
      method,
      statusCode,
      durationMs,
    }).catch(() => {});
  }
}
