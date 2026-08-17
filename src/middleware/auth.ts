import type { Context, Next } from 'hono';
import { getCookie } from 'hono/cookie';
import { ApiKeyService } from '../services/api-key.service';
import { AuthService } from '../services/auth.service';
import type { AppEnv } from '../types/auth';

/**
 * Dual authentication middleware that accepts either:
 * 1. Bearer API key (Authorization: Bearer pf_live_...)
 * 2. Browser session cookie / header (session_id cookie or Session <id>)
 */
export async function dualAuth(c: Context<AppEnv>, next: Next) {
  const authHeader = c.req.header('Authorization');

  // Check Bearer API key first
  if (authHeader && authHeader.startsWith('Bearer ') && !authHeader.startsWith('Bearer ses_')) {
    const rawKey = authHeader.replace(/^Bearer\s+/i, '').trim();
    const result = await ApiKeyService.validateApiKey(rawKey);

    if (result.success) {
      c.set('user', result.user);
      c.set('apiKey', result.apiKey);
      return next();
    }

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

  // Check Session Cookie / Header
  const cookieSessionId = getCookie(c, 'session_id');
  let sessionId = cookieSessionId;

  if (!sessionId && authHeader) {
    if (authHeader.startsWith('Session ') || authHeader.startsWith('Bearer ses_')) {
      sessionId = authHeader.split(' ')[1];
    }
  }

  if (!sessionId) {
    const xSession = c.req.header('X-Session-Id');
    if (xSession) {
      sessionId = xSession;
    }
  }

  if (sessionId) {
    const result = await AuthService.validateSession(sessionId);
    if (result) {
      c.set('user', result.user);
      c.set('session', result.session);
      return next();
    }
  }

  return c.json(
    {
      success: false,
      error: {
        code: 'UNAUTHORIZED',
        message: 'Authentication required. Provide an API key or log in.',
      },
    },
    401
  );
}
