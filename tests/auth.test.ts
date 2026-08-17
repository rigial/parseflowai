import { describe, it, mock, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import app from '../src/app';
import { dynamo } from '../src/services/dynamo.service';
import { hashPassword } from '../src/utils/crypto';

describe('Auth Endpoints & Lifecycle (/v1/auth)', { concurrency: 1 }, () => {
  beforeEach(() => {
    mock.restoreAll();
  });

  describe('POST /v1/auth/signup', () => {
    it('successfully registers a new user account with hashed password (201)', async () => {
      const itemsWritten: any[] = [];
      mock.method(dynamo, 'send', async (command: any) => {
        if (command.input?.Item) {
          itemsWritten.push(command.input.Item);
        }
        return {};
      });

      const response = await app.request('/v1/auth/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'Test.User@example.com',
          password: 'superSecretPassword123!',
        }),
      });

      assert.strictEqual(response.status, 201);
      const json = await response.json();
      assert.strictEqual(json.success, true);
      assert.ok(json.user.userId.startsWith('usr_'));
      assert.strictEqual(json.user.email, 'test.user@example.com'); // normalized lowercase
      assert.strictEqual(json.user.password, undefined);
      assert.strictEqual(json.user.passwordHash, undefined);

      // Verify email lookup item and user profile written
      assert.strictEqual(itemsWritten.length, 2);
      const emailItem = itemsWritten.find((i) => i.PK === 'EMAIL#test.user@example.com');
      const userItem = itemsWritten.find((i) => i.PK.startsWith('USER#'));

      assert.ok(emailItem);
      assert.ok(userItem);
      assert.strictEqual(userItem.email, 'test.user@example.com');
      assert.strictEqual(userItem.status, 'active');
      assert.strictEqual(userItem.plan, 'free');
      assert.notStrictEqual(userItem.passwordHash, 'superSecretPassword123!');
      assert.ok(userItem.passwordHash.includes(':')); // salt:hash
    });

    it('rejects duplicate email address with 409 EMAIL_ALREADY_EXISTS', async () => {
      mock.method(dynamo, 'send', async (command: any) => {
        if (command.input?.Key?.PK === 'EMAIL#duplicate@example.com') {
          return { Item: { PK: 'EMAIL#duplicate@example.com', userId: 'usr_existing' } };
        }
        if (command.input?.Key?.PK === 'USER#usr_existing') {
          return {
            Item: {
              userId: 'usr_existing',
              email: 'duplicate@example.com',
              status: 'active',
              plan: 'free',
            },
          };
        }
        const err = new Error('Conditional check failed');
        err.name = 'ConditionalCheckFailedException';
        throw err;
      });

      const response = await app.request('/v1/auth/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'duplicate@example.com',
          password: 'validPassword123',
        }),
      });

      assert.strictEqual(response.status, 409);
      const json = await response.json();
      assert.strictEqual(json.success, false);
      assert.strictEqual(json.error.code, 'EMAIL_ALREADY_EXISTS');
    });

    it('rejects invalid email format with 400 INVALID_REQUEST', async () => {
      const response = await app.request('/v1/auth/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'not-an-email',
          password: 'validPassword123',
        }),
      });

      assert.strictEqual(response.status, 400);
      const json = await response.json();
      assert.strictEqual(json.success, false);
      assert.strictEqual(json.error.code, 'INVALID_REQUEST');
    });

    it('rejects weak password under 8 characters with 400 INVALID_REQUEST', async () => {
      const response = await app.request('/v1/auth/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'user@example.com',
          password: 'short',
        }),
      });

      assert.strictEqual(response.status, 400);
      const json = await response.json();
      assert.strictEqual(json.success, false);
      assert.strictEqual(json.error.code, 'INVALID_REQUEST');
    });
  });

  describe('POST /v1/auth/login', () => {
    const validPassword = 'correctPassword123';
    const mockUserRecord = {
      PK: 'USER#usr_test123',
      SK: 'PROFILE',
      userId: 'usr_test123',
      email: 'login@example.com',
      passwordHash: hashPassword(validPassword),
      status: 'active',
      plan: 'free',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    it('authenticates valid credentials, creates session, and sets session cookie (200)', async () => {
      let sessionItemCreated: any = null;
      mock.method(dynamo, 'send', async (command: any) => {
        if (command.input?.Key?.PK === 'EMAIL#login@example.com') {
          return { Item: { userId: 'usr_test123' } };
        }
        if (command.input?.Key?.PK === 'USER#usr_test123' && command.input?.Key?.SK === 'PROFILE') {
          return { Item: mockUserRecord };
        }
        if (command.input?.Item?.entityType === 'SESSION') {
          sessionItemCreated = command.input.Item;
          return {};
        }
        return {};
      });

      const response = await app.request('/v1/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'LOGIN@example.com',
          password: validPassword,
        }),
      });

      assert.strictEqual(response.status, 200);
      const json = await response.json();
      assert.strictEqual(json.success, true);
      assert.strictEqual(json.user.userId, 'usr_test123');
      assert.strictEqual(json.user.email, 'login@example.com');

      // Verify Set-Cookie header contains session_id
      const setCookie = response.headers.get('Set-Cookie');
      assert.ok(setCookie);
      assert.ok(setCookie.includes('session_id=ses_'));
      assert.ok(setCookie.includes('HttpOnly'));

      // Verify session stored in DB
      assert.ok(sessionItemCreated);
      assert.strictEqual(sessionItemCreated.userId, 'usr_test123');
      assert.ok(sessionItemCreated.sessionId.startsWith('ses_'));
    });

    it('rejects invalid password with 401 INVALID_CREDENTIALS', async () => {
      mock.method(dynamo, 'send', async (command: any) => {
        if (command.input?.Key?.PK === 'EMAIL#login@example.com') {
          return { Item: { userId: 'usr_test123' } };
        }
        if (command.input?.Key?.PK === 'USER#usr_test123' && command.input?.Key?.SK === 'PROFILE') {
          return { Item: mockUserRecord };
        }
        return {};
      });

      const response = await app.request('/v1/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'login@example.com',
          password: 'WRONG_PASSWORD',
        }),
      });

      assert.strictEqual(response.status, 401);
      const json = await response.json();
      assert.strictEqual(json.success, false);
      assert.strictEqual(json.error.code, 'INVALID_CREDENTIALS');
    });

    it('rejects non-existent email with generic 401 INVALID_CREDENTIALS (no email enumeration)', async () => {
      mock.method(dynamo, 'send', async () => {
        return {}; // Not found
      });

      const response = await app.request('/v1/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'nonexistent@example.com',
          password: 'password123',
        }),
      });

      assert.strictEqual(response.status, 401);
      const json = await response.json();
      assert.strictEqual(json.success, false);
      assert.strictEqual(json.error.code, 'INVALID_CREDENTIALS');
    });

    it('rejects suspended user with 403 UNAUTHORIZED', async () => {
      mock.method(dynamo, 'send', async (command: any) => {
        if (command.input?.Key?.PK === 'EMAIL#suspended@example.com') {
          return { Item: { userId: 'usr_suspended' } };
        }
        if (command.input?.Key?.PK === 'USER#usr_suspended' && command.input?.Key?.SK === 'PROFILE') {
          return {
            Item: {
              ...mockUserRecord,
              userId: 'usr_suspended',
              email: 'suspended@example.com',
              status: 'suspended',
            },
          };
        }
        return {};
      });

      const response = await app.request('/v1/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'suspended@example.com',
          password: validPassword,
        }),
      });

      assert.strictEqual(response.status, 403);
      const json = await response.json();
      assert.strictEqual(json.success, false);
      assert.strictEqual(json.error.code, 'UNAUTHORIZED');
    });
  });

  describe('Session Management & /v1/auth/logout', () => {
    it('returns current user details on GET /v1/auth/me when valid session cookie provided', async () => {
      mock.method(dynamo, 'send', async (command: any) => {
        if (command.input?.Key?.PK === 'SESSION#ses_valid123') {
          return {
            Item: {
              sessionId: 'ses_valid123',
              userId: 'usr_test123',
              createdAt: new Date().toISOString(),
              expiresAt: new Date(Date.now() + 86400000).toISOString(),
            },
          };
        }
        if (command.input?.Key?.PK === 'USER#usr_test123' && command.input?.Key?.SK === 'PROFILE') {
          return {
            Item: {
              userId: 'usr_test123',
              email: 'user@example.com',
              status: 'active',
              plan: 'free',
              createdAt: new Date().toISOString(),
            },
          };
        }
        return {};
      });

      const response = await app.request('/v1/auth/me', {
        method: 'GET',
        headers: {
          Cookie: 'session_id=ses_valid123',
        },
      });

      assert.strictEqual(response.status, 200);
      const json = await response.json();
      assert.strictEqual(json.success, true);
      assert.strictEqual(json.user.userId, 'usr_test123');
      assert.strictEqual(json.user.email, 'user@example.com');
    });

    it('rejects GET /v1/auth/me with 401 when session cookie is missing', async () => {
      const response = await app.request('/v1/auth/me', {
        method: 'GET',
      });

      assert.strictEqual(response.status, 401);
      const json = await response.json();
      assert.strictEqual(json.success, false);
      assert.strictEqual(json.error.code, 'UNAUTHORIZED');
    });

    it('rejects GET /v1/auth/me with 401 when session is expired', async () => {
      mock.method(dynamo, 'send', async (command: any) => {
        if (command.input?.Key?.PK === 'SESSION#ses_expired') {
          return {
            Item: {
              sessionId: 'ses_expired',
              userId: 'usr_test123',
              createdAt: new Date(Date.now() - 100000).toISOString(),
              expiresAt: new Date(Date.now() - 50000).toISOString(), // expired
            },
          };
        }
        return {};
      });

      const response = await app.request('/v1/auth/me', {
        method: 'GET',
        headers: { Cookie: 'session_id=ses_expired' },
      });

      assert.strictEqual(response.status, 401);
      const json = await response.json();
      assert.strictEqual(json.success, false);
      assert.strictEqual(json.error.code, 'UNAUTHORIZED');
    });

    it('invalidates session and clears cookie on POST /v1/auth/logout', async () => {
      let sessionDeleted = false;
      mock.method(dynamo, 'send', async (command: any) => {
        if (command.input?.Key?.PK === 'SESSION#ses_logout123') {
          sessionDeleted = true;
        }
        return {};
      });

      const response = await app.request('/v1/auth/logout', {
        method: 'POST',
        headers: { Cookie: 'session_id=ses_logout123' },
      });

      assert.strictEqual(response.status, 200);
      assert.strictEqual(sessionDeleted, true);
    });
  });
});
