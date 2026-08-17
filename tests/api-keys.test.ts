import { describe, it, mock, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import app from '../src/app';
import { dynamo } from '../src/services/dynamo.service';
import { generateApiKey, hashSecret } from '../src/utils/crypto';

describe('API Key Management & Authentication (/v1/api-keys)', { concurrency: 1 }, () => {
  beforeEach(() => {
    mock.restoreAll();
  });

  const mockSession = {
    sessionId: 'ses_test_session',
    userId: 'usr_owner_123',
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 86400000).toISOString(),
  };

  const mockUser = {
    userId: 'usr_owner_123',
    email: 'dev@example.com',
    status: 'active',
    plan: 'free',
  };

  describe('POST /v1/api-keys (Create Key)', () => {
    it('creates a new API key and returns plaintext secret ONLY once', async () => {
      const itemsWritten: any[] = [];
      mock.method(dynamo, 'send', async (command: any) => {
        if (command.input?.Key?.PK === 'SESSION#ses_test_session') {
          return { Item: mockSession };
        }
        if (command.input?.Key?.PK === 'USER#usr_owner_123' && command.input?.Key?.SK === 'PROFILE') {
          return { Item: mockUser };
        }
        if (command.input?.Item) {
          itemsWritten.push(command.input.Item);
        }
        return {};
      });

      const response = await app.request('/v1/api-keys', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: 'session_id=ses_test_session',
        },
        body: JSON.stringify({
          name: 'Production Server',
          environment: 'live',
        }),
      });

      assert.strictEqual(response.status, 201);
      const json = await response.json();
      assert.ok(json.apiKey);
      assert.ok(json.apiKey.id.startsWith('key_'));
      assert.strictEqual(json.apiKey.name, 'Production Server');
      assert.ok(json.apiKey.key.startsWith('pf_live_'));
      assert.ok(json.apiKey.createdAt);

      // Verify that the secret was hashed before storage
      const userKeyItem = itemsWritten.find((i) => i.entityType === 'API_KEY');
      const lookupItem = itemsWritten.find((i) => i.entityType === 'API_KEY_LOOKUP');

      assert.ok(userKeyItem);
      assert.ok(lookupItem);
      assert.strictEqual(userKeyItem.userId, 'usr_owner_123');
      assert.strictEqual(userKeyItem.name, 'Production Server');
      assert.strictEqual(userKeyItem.status, 'active');
      assert.notStrictEqual(userKeyItem.secretHash, json.apiKey.key); // Hash is stored, not plaintext
      assert.strictEqual(userKeyItem.secretHash, hashSecret(json.apiKey.key));
      assert.strictEqual(userKeyItem.keyPrefix, `pf_live_${json.apiKey.key.slice(8, 16)}...`);
    });

    it('rejects unauthenticated request with 401 UNAUTHORIZED', async () => {
      const response = await app.request('/v1/api-keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Test' }),
      });

      assert.strictEqual(response.status, 401);
      const json = await response.json();
      assert.strictEqual(json.success, false);
      assert.strictEqual(json.error.code, 'UNAUTHORIZED');
    });
  });

  describe('GET /v1/api-keys (List Keys)', () => {
    it('returns only safe metadata without sensitive secrets or hashes', async () => {
      const mockKeyItems = [
        {
          keyId: 'key_1',
          userId: 'usr_owner_123',
          name: 'CI/CD Pipeline',
          keyPrefix: 'pf_live_abc12345...',
          secretHash: 'hash_should_not_leak',
          environment: 'live',
          status: 'active',
          createdAt: '2026-08-17T00:00:00.000Z',
          lastUsedAt: '2026-08-17T12:00:00.000Z',
        },
      ];

      mock.method(dynamo, 'send', async (command: any) => {
        if (command.input?.Key?.PK === 'SESSION#ses_test_session') {
          return { Item: mockSession };
        }
        if (command.input?.Key?.PK === 'USER#usr_owner_123' && command.input?.Key?.SK === 'PROFILE') {
          return { Item: mockUser };
        }
        if (command.input?.KeyConditionExpression) {
          return { Items: mockKeyItems };
        }
        return {};
      });

      const response = await app.request('/v1/api-keys', {
        method: 'GET',
        headers: { Cookie: 'session_id=ses_test_session' },
      });

      assert.strictEqual(response.status, 200);
      const json = await response.json();
      assert.ok(Array.isArray(json.apiKeys));
      assert.strictEqual(json.apiKeys.length, 1);

      const returnedKey = json.apiKeys[0];
      assert.strictEqual(returnedKey.id, 'key_1');
      assert.strictEqual(returnedKey.name, 'CI/CD Pipeline');
      assert.strictEqual(returnedKey.keyPrefix, 'pf_live_abc12345...');
      assert.strictEqual(returnedKey.status, 'active');
      assert.strictEqual(returnedKey.secretHash, undefined);
      assert.strictEqual(returnedKey.key, undefined);
    });
  });

  describe('DELETE /v1/api-keys/:keyId (Revoke Key)', () => {
    it('revokes an API key successfully', async () => {
      let updateCommandExecuted: any = null;
      mock.method(dynamo, 'send', async (command: any) => {
        if (command.input?.Key?.PK === 'SESSION#ses_test_session') {
          return { Item: mockSession };
        }
        if (command.input?.Key?.PK === 'USER#usr_owner_123' && command.input?.Key?.SK === 'PROFILE') {
          return { Item: mockUser };
        }
        if (command.input?.Key?.SK?.startsWith('APIKEY#') && command.input?.UpdateExpression) {
          updateCommandExecuted = command;
          return {};
        }
        if (command.input?.Key?.SK === 'APIKEY#key_to_revoke') {
          return {
            Item: {
              keyId: 'key_to_revoke',
              userId: 'usr_owner_123',
              name: 'Old Key',
              status: 'revoked',
              revokedAt: new Date().toISOString(),
            },
          };
        }
        return {};
      });

      const response = await app.request('/v1/api-keys/key_to_revoke', {
        method: 'DELETE',
        headers: { Cookie: 'session_id=ses_test_session' },
      });

      assert.strictEqual(response.status, 200);
      const json = await response.json();
      assert.strictEqual(json.success, true);
      assert.ok(updateCommandExecuted);
      assert.strictEqual(
        updateCommandExecuted.input.ExpressionAttributeValues[':status'],
        'revoked'
      );
    });
  });

  describe('API Key Authentication Middleware', () => {
    const { apiKey, secretHash } = generateApiKey('live');

    it('authenticates valid Bearer token and attaches user context', async () => {
      mock.method(dynamo, 'send', async (command: any) => {
        // 1. API key lookup by hash
        if (command.input?.Key?.PK === `APIKEY_HASH#${secretHash}`) {
          return { Item: { userId: 'usr_owner_123', keyId: 'key_valid_123' } };
        }
        // 2. Fetch full key
        if (command.input?.Key?.PK === 'USER#usr_owner_123' && command.input?.Key?.SK === 'APIKEY#key_valid_123') {
          return {
            Item: {
              keyId: 'key_valid_123',
              userId: 'usr_owner_123',
              secretHash,
              status: 'active',
            },
          };
        }
        // 3. Fetch user
        if (command.input?.Key?.PK === 'USER#usr_owner_123' && command.input?.Key?.SK === 'PROFILE') {
          return { Item: mockUser };
        }
        return {};
      });

      // Test on usage route (which uses dualAuth/apiKeyAuth)
      const response = await app.request('/v1/usage', {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${apiKey}`,
        },
      });

      assert.strictEqual(response.status, 200);
    });

    it('rejects missing or malformed Authorization header with 401 UNAUTHORIZED', async () => {
      const response = await app.request('/v1/resumes/upload-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileName: 'test.pdf', contentType: 'application/pdf' }),
      });

      assert.strictEqual(response.status, 401);
      const json = await response.json();
      assert.strictEqual(json.success, false);
      assert.strictEqual(json.error.code, 'UNAUTHORIZED');
    });

    it('rejects invalid API key with 401 INVALID_API_KEY', async () => {
      mock.method(dynamo, 'send', async () => {
        return {}; // Not found
      });

      const response = await app.request('/v1/resumes/upload-url', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer pf_live_invalid_secret_key_1234567890',
        },
        body: JSON.stringify({ fileName: 'test.pdf', contentType: 'application/pdf' }),
      });

      assert.strictEqual(response.status, 401);
      const json = await response.json();
      assert.strictEqual(json.success, false);
      assert.strictEqual(json.error.code, 'INVALID_API_KEY');
    });

    it('rejects revoked API key with 401 API_KEY_REVOKED', async () => {
      mock.method(dynamo, 'send', async (command: any) => {
        if (command.input?.Key?.PK === `APIKEY_HASH#${secretHash}`) {
          return { Item: { userId: 'usr_owner_123', keyId: 'key_revoked_123' } };
        }
        if (command.input?.Key?.PK === 'USER#usr_owner_123' && command.input?.Key?.SK === 'APIKEY#key_revoked_123') {
          return {
            Item: {
              keyId: 'key_revoked_123',
              userId: 'usr_owner_123',
              secretHash,
              status: 'revoked',
            },
          };
        }
        return {};
      });

      const response = await app.request('/v1/resumes/upload-url', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({ fileName: 'test.pdf', contentType: 'application/pdf' }),
      });

      assert.strictEqual(response.status, 401);
      const json = await response.json();
      assert.strictEqual(json.success, false);
      assert.strictEqual(json.error.code, 'API_KEY_REVOKED');
    });

    it('rejects API key from suspended user with 403 UNAUTHORIZED', async () => {
      mock.method(dynamo, 'send', async (command: any) => {
        if (command.input?.Key?.PK === `APIKEY_HASH#${secretHash}`) {
          return { Item: { userId: 'usr_owner_123', keyId: 'key_valid_123' } };
        }
        if (command.input?.Key?.PK === 'USER#usr_owner_123' && command.input?.Key?.SK === 'APIKEY#key_valid_123') {
          return {
            Item: {
              keyId: 'key_valid_123',
              userId: 'usr_owner_123',
              secretHash,
              status: 'active',
            },
          };
        }
        if (command.input?.Key?.PK === 'USER#usr_owner_123' && command.input?.Key?.SK === 'PROFILE') {
          return { Item: { ...mockUser, status: 'suspended' } };
        }
        return {};
      });

      const response = await app.request('/v1/resumes/upload-url', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({ fileName: 'test.pdf', contentType: 'application/pdf' }),
      });

      assert.strictEqual(response.status, 403);
      const json = await response.json();
      assert.strictEqual(json.success, false);
      assert.strictEqual(json.error.code, 'UNAUTHORIZED');
    });
  });
});
