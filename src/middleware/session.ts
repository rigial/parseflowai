import type { Context, Next } from 'hono';
import { getCookie } from 'hono/cookie';
import { AuthService } from '../services/auth.service';
import type { AppEnv } from '../types/auth';

export async function sessionAuth(c: Context<AppEnv>, next: Next) {
  const cookieSessionId = getCookie(c, 'session_id');
  const authHeader = c.req.header('Authorization');
  let sessionId = cookieSessionId;

  if (!sessionId && authHeader) {
    if (authHeader.startsWith('Session ') || authHeader.startsWith('Bearer ')) {
      sessionId = authHeader.split(' ')[1];
    }
  }

  if (!sessionId) {
    const xSession = c.req.header('X-Session-Id');
    if (xSession) {
      sessionId = xSession;
    }
  }

  if (!sessionId) {
    return c.json(
      {
        success: false,
        error: {
          code: 'UNAUTHORIZED',
          message: 'Authentication required. Please log in.',
        },
      },
      401
    );
  }

  const result = await AuthService.validateSession(sessionId);
  if (!result) {
    return c.json(
      {
        success: false,
        error: {
          code: 'UNAUTHORIZED',
          message: 'Session is invalid or expired. Please log in again.',
        },
      },
      401
    );
  }

  c.set('user', result.user);
  c.set('session', result.session);

  await next();
}
