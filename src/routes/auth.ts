import { Hono } from 'hono';
import { setCookie, deleteCookie, getCookie } from 'hono/cookie';
import { AuthService } from '../services/auth.service';
import { signupSchema, loginSchema } from '../schemas/auth.schema';
import { sessionAuth } from '../middleware/session';
import { env } from '../lib/env';
import type { AppEnv, User } from '../types/auth';

const auth = new Hono<AppEnv>();

/**
 * POST /signup (also /v1/auth/signup)
 */
auth.post('/signup', async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json(
      {
        success: false,
        error: {
          code: 'INVALID_REQUEST',
          message: 'Invalid JSON request body',
        },
      },
      400
    );
  }

  const validation = signupSchema.safeParse(body);
  if (!validation.success) {
    return c.json(
      {
        success: false,
        error: {
          code: 'INVALID_REQUEST',
          message: validation.error.issues[0]?.message || 'Invalid signup input',
        },
      },
      400
    );
  }

  try {
    const result = await AuthService.signup(validation.data);
    return c.json(
      {
        success: true,
        user: {
          userId: result.user.userId,
          email: result.user.email,
        },
      },
      201
    );
  } catch (error: any) {
    if (error.name === 'EmailAlreadyExistsError') {
      return c.json(
        {
          success: false,
          error: {
            code: 'EMAIL_ALREADY_EXISTS',
            message: 'An account with this email address already exists',
          },
        },
        409
      );
    }

    return c.json(
      {
        success: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to create user account',
        },
      },
      500
    );
  }
});

/**
 * POST /login (also /v1/auth/login)
 */
auth.post('/login', async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json(
      {
        success: false,
        error: {
          code: 'INVALID_REQUEST',
          message: 'Invalid JSON request body',
        },
      },
      400
    );
  }

  const validation = loginSchema.safeParse(body);
  if (!validation.success) {
    return c.json(
      {
        success: false,
        error: {
          code: 'INVALID_REQUEST',
          message: validation.error.issues[0]?.message || 'Invalid login input',
        },
      },
      400
    );
  }

  try {
    const { user, session } = await AuthService.login(validation.data);

    // Set secure HTTP-only cookie for session
    const isProduction = env.NODE_ENV === 'production';
    setCookie(c, 'session_id', session.sessionId, {
      httpOnly: true,
      secure: isProduction,
      sameSite: 'Lax',
      path: '/',
      maxAge: 30 * 24 * 60 * 60, // 30 days
    });

    return c.json(
      {
        success: true,
        user: {
          userId: user.userId,
          email: user.email,
        },
      },
      200
    );
  } catch (error: any) {
    if (error.name === 'AccountSuspendedError') {
      return c.json(
        {
          success: false,
          error: {
            code: 'UNAUTHORIZED',
            message: 'Your account has been suspended. Please contact support.',
          },
        },
        403
      );
    }

    return c.json(
      {
        success: false,
        error: {
          code: 'INVALID_CREDENTIALS',
          message: 'Invalid email or password',
        },
      },
      401
    );
  }
});

/**
 * POST /logout (also /v1/auth/logout)
 */
auth.post('/logout', async (c) => {
  const cookieSessionId = getCookie(c, 'session_id');
  const authHeader = c.req.header('Authorization');
  let sessionId = cookieSessionId;

  if (!sessionId && authHeader) {
    if (authHeader.startsWith('Session ') || authHeader.startsWith('Bearer ')) {
      sessionId = authHeader.split(' ')[1];
    }
  }

  if (sessionId) {
    await AuthService.logout(sessionId).catch(() => {});
  }

  deleteCookie(c, 'session_id', { path: '/' });

  return c.json(
    {
      success: true,
      message: 'Logged out successfully',
    },
    200
  );
});

/**
 * GET /me (also /v1/auth/me)
 */
auth.get('/me', sessionAuth, async (c) => {
  const user = c.get('user') as User;
  return c.json(
    {
      success: true,
      user: {
        userId: user.userId,
        email: user.email,
        status: user.status,
        plan: user.plan,
        createdAt: user.createdAt,
        lastLoginAt: user.lastLoginAt,
      },
    },
    200
  );
});

export default auth;
