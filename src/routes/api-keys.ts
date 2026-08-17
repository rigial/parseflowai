import { Hono } from 'hono';
import { ApiKeyService } from '../services/api-key.service';
import { createApiKeySchema } from '../schemas/api-key.schema';
import { sessionAuth } from '../middleware/session';
import type { AppEnv, User } from '../types/auth';

const apiKeys = new Hono<AppEnv>();

// Protect all API key management routes with session authentication
apiKeys.use('*', sessionAuth);

/**
 * POST / (also /v1/api-keys)
 * Creates a new API key and returns the full key secret ONCE.
 */
apiKeys.post('/', async (c) => {
  const user = c.get('user') as User;
  let body: unknown = {};

  try {
    const rawText = await c.req.text();
    if (rawText && rawText.trim().length > 0) {
      body = JSON.parse(rawText);
    }
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

  const validation = createApiKeySchema.safeParse(body);
  if (!validation.success) {
    return c.json(
      {
        success: false,
        error: {
          code: 'INVALID_REQUEST',
          message: validation.error.issues[0]?.message || 'Invalid API key parameters',
        },
      },
      400
    );
  }

  const { name, environment } = validation.data;
  const result = await ApiKeyService.createApiKey(user.userId, name, environment);

  return c.json(result, 201);
});

/**
 * GET / (also /v1/api-keys)
 * Lists safe metadata for all API keys owned by user.
 */
apiKeys.get('/', async (c) => {
  const user = c.get('user') as User;
  const keys = await ApiKeyService.listApiKeys(user.userId);

  return c.json(
    {
      apiKeys: keys,
    },
    200
  );
});

/**
 * DELETE /:keyId (also /v1/api-keys/:keyId)
 * Revokes an API key immediately.
 */
apiKeys.delete('/:keyId', async (c) => {
  const user = c.get('user') as User;
  const keyId = c.req.param('keyId');

  if (!keyId) {
    return c.json(
      {
        success: false,
        error: {
          code: 'INVALID_REQUEST',
          message: 'API key ID is required',
        },
      },
      400
    );
  }

  const revoked = await ApiKeyService.revokeApiKey(user.userId, keyId);
  if (!revoked) {
    return c.json(
      {
        success: false,
        error: {
          code: 'INVALID_REQUEST',
          message: 'API key not found or could not be revoked',
        },
      },
      404
    );
  }

  return c.json(
    {
      success: true,
      message: 'API key revoked successfully',
    },
    200
  );
});

export default apiKeys;
