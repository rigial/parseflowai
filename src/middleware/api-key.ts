import type { Context, Next } from 'hono';
import { ApiKeyService } from '../services/api-key.service';
import type { AppEnv } from '../types/auth';

export async function apiKeyAuth(c: Context<AppEnv>, next: Next) {
  const authHeader = c.req.header('Authorization');

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return c.json(
      {
        success: false,
        error: {
          code: 'UNAUTHORIZED',
          message: 'Missing or malformed Authorization header. Expected Bearer <api_key>',
        },
      },
      401
    );
  }

  const rawApiKey = authHeader.replace(/^Bearer\s+/i, '').trim();

  if (!rawApiKey) {
    return c.json(
      {
        success: false,
        error: {
          code: 'INVALID_API_KEY',
          message: 'API key is required',
        },
      },
      401
    );
  }

  const result = await ApiKeyService.validateApiKey(rawApiKey);

  if (!result.success) {
    if (result.error === 'API_KEY_REVOKED') {
      return c.json(
        {
          success: false,
          error: {
            code: 'API_KEY_REVOKED',
            message: 'This API key has been revoked',
          },
        },
        401
      );
    }

    if (result.error === 'USER_SUSPENDED') {
      return c.json(
        {
          success: false,
          error: {
            code: 'UNAUTHORIZED',
            message: 'User account has been suspended',
          },
        },
        403
      );
    }

    return c.json(
      {
        success: false,
        error: {
          code: 'INVALID_API_KEY',
          message: 'Invalid API key',
        },
      },
      401
    );
  }

  c.set('user', result.user);
  c.set('apiKey', result.apiKey);

  await next();
}
