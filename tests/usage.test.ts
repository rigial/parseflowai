import { describe, it, mock, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import app from '../src/app';
import { dynamo } from '../src/services/dynamo.service';
import { generateApiKey, hashSecret } from '../src/utils/crypto';
import { UsageService } from '../src/services/usage.service';
import { UsageRepository } from '../src/repositories/usage.repository';

describe('Usage Tracking, Metrics & Quota Limits (/v1/usage)', { concurrency: 1 }, () => {
  beforeEach(() => {
    mock.restoreAll();
  });

  const { apiKey, secretHash } = generateApiKey('live');

  const mockUser = {
    userId: 'usr_usage_user_1',
    email: 'usage@example.com',
    status: 'active',
    plan: 'free',
  };

  const setupAuthMocks = () => {
    return (command: any) => {
      if (command.input?.Key?.PK === `APIKEY_HASH#${secretHash}`) {
        return { Item: { userId: 'usr_usage_user_1', keyId: 'key_usage_1' } };
      }
      if (
        command.input?.Key?.PK === 'USER#usr_usage_user_1' &&
        command.input?.Key?.SK === 'APIKEY#key_usage_1'
      ) {
        return {
          Item: {
            keyId: 'key_usage_1',
            userId: 'usr_usage_user_1',
            secretHash,
            status: 'active',
          },
        };
      }
      if (
        command.input?.Key?.PK === 'USER#usr_usage_user_1' &&
        command.input?.Key?.SK === 'PROFILE'
      ) {
        return { Item: mockUser };
      }
      return null;
    };
  };

  describe('UsageService & Repository Increment Operations', () => {
    it('trackUpload increments daily resumesUploaded and records audit event', async () => {
      let updateCommand: any = null;
      let putCommand: any = null;

      mock.method(dynamo, 'send', async (command: any) => {
        if (command.input?.UpdateExpression) {
          updateCommand = command;
        }
        if (command.input?.Item) {
          putCommand = command;
        }
        return {};
      });

      await UsageService.trackUpload({
        userId: 'usr_usage_user_1',
        apiKeyId: 'key_usage_1',
        resumeId: 'res_123',
        fileSize: 1024,
        fileType: 'application/pdf',
      });

      assert.ok(updateCommand);
      assert.strictEqual(
        updateCommand.input.ExpressionAttributeValues[':inc_resumesUploaded'],
        1
      );
      assert.ok(putCommand);
      assert.strictEqual(putCommand.input.Item.event, 'uploaded');
      assert.strictEqual(putCommand.input.Item.resumeId, 'res_123');
    });

    it('trackParseSuccess increments daily resumesParsed, tokens, and records audit event', async () => {
      let updateCommand: any = null;

      mock.method(dynamo, 'send', async (command: any) => {
        if (command.input?.UpdateExpression) {
          updateCommand = command;
        }
        return {};
      });

      await UsageService.trackParseSuccess({
        userId: 'usr_usage_user_1',
        apiKeyId: 'key_usage_1',
        resumeId: 'res_123',
        durationMs: 1500,
        tokenUsage: {
          inputTokens: 1200,
          outputTokens: 450,
          totalTokens: 1650,
          provider: 'google-genai',
          model: 'gemini-3.5-flash-lite',
        },
      });

      assert.ok(updateCommand);
      assert.strictEqual(
        updateCommand.input.ExpressionAttributeValues[':inc_resumesParsed'],
        1
      );
      assert.strictEqual(
        updateCommand.input.ExpressionAttributeValues[':inc_inputTokens'],
        1200
      );
      assert.strictEqual(
        updateCommand.input.ExpressionAttributeValues[':inc_outputTokens'],
        450
      );
      assert.strictEqual(
        updateCommand.input.ExpressionAttributeValues[':inc_totalTokens'],
        1650
      );
    });

    it('trackParseFailure increments daily parseFailures counter', async () => {
      let updateCommand: any = null;

      mock.method(dynamo, 'send', async (command: any) => {
        if (command.input?.UpdateExpression) {
          updateCommand = command;
        }
        return {};
      });

      await UsageService.trackParseFailure({
        userId: 'usr_usage_user_1',
        apiKeyId: 'key_usage_1',
        resumeId: 'res_123',
        durationMs: 500,
      });

      assert.ok(updateCommand);
      assert.strictEqual(
        updateCommand.input.ExpressionAttributeValues[':inc_parseFailures'],
        1
      );
    });
  });

  describe('GET /v1/usage (Aggregated Summary)', () => {
    it('aggregates daily metrics over requested period correctly', async () => {
      const authHandler = setupAuthMocks();
      const mockDailyRecords = [
        {
          date: '2026-08-15',
          requests: 50,
          resumesUploaded: 20,
          resumesParsed: 18,
          parseFailures: 2,
          inputTokens: 20000,
          outputTokens: 5000,
          totalTokens: 25000,
        },
        {
          date: '2026-08-16',
          requests: 70,
          resumesUploaded: 25,
          resumesParsed: 24,
          parseFailures: 1,
          inputTokens: 30000,
          outputTokens: 7000,
          totalTokens: 37000,
        },
      ];

      mock.method(dynamo, 'send', async (command: any) => {
        const authRes = authHandler(command);
        if (authRes) return authRes;

        if (command.input?.KeyConditionExpression) {
          return { Items: mockDailyRecords };
        }
        return {};
      });

      const response = await app.request('/v1/usage?period=current_month', {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${apiKey}`,
        },
      });

      assert.strictEqual(response.status, 200);
      const json = await response.json();

      assert.strictEqual(json.period, 'current_month');
      assert.strictEqual(json.requests, 120);
      assert.strictEqual(json.resumesUploaded, 45);
      assert.strictEqual(json.resumesParsed, 42);
      assert.strictEqual(json.parseFailures, 3);
      assert.strictEqual(json.inputTokens, 50000);
      assert.strictEqual(json.outputTokens, 12000);
      assert.strictEqual(json.totalTokens, 62000);
    });
  });

  describe('GET /v1/usage/daily (Daily Breakdown)', () => {
    it('returns daily breakdown metrics array', async () => {
      const authHandler = setupAuthMocks();
      mock.method(dynamo, 'send', async (command: any) => {
        const authRes = authHandler(command);
        if (authRes) return authRes;

        if (command.input?.KeyConditionExpression) {
          return {
            Items: [
              {
                date: '2026-08-17',
                requests: 10,
                resumesParsed: 5,
                totalTokens: 8000,
              },
            ],
          };
        }
        return {};
      });

      const response = await app.request('/v1/usage/daily?period=today', {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${apiKey}`,
        },
      });

      assert.strictEqual(response.status, 200);
      const json = await response.json();
      assert.ok(Array.isArray(json.daily));
      assert.ok(json.daily.length > 0);
    });
  });

  describe('Quota Limit Enforcement', () => {
    it('returns 429 USAGE_LIMIT_EXCEEDED when monthly upload limit is reached', async () => {
      const authHandler = setupAuthMocks();

      // Mock user has already uploaded 50 resumes (free plan limit is 50)
      mock.method(dynamo, 'send', async (command: any) => {
        const authRes = authHandler(command);
        if (authRes) return authRes;

        if (command.input?.KeyConditionExpression) {
          return {
            Items: [
              {
                date: '2026-08-01',
                resumesUploaded: 50,
              },
            ],
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
        body: JSON.stringify({
          fileName: 'overflow.pdf',
          contentType: 'application/pdf',
        }),
      });

      assert.strictEqual(response.status, 429);
      const json = await response.json();
      assert.strictEqual(json.success, false);
      assert.strictEqual(json.error.code, 'USAGE_LIMIT_EXCEEDED');
      assert.ok(json.error.message.includes('Monthly resume upload limit reached'));
    });
  });
});
