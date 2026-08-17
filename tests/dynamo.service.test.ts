import { describe, it, mock, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { dynamo, createRecord, getRecord, updateRecord, ResumeRecord } from '../src/services/dynamo.service';
import { logger } from '../src/lib/logger';
import { env } from '../src/lib/env';

describe('DynamoDB Service', () => {
  beforeEach(() => {
    mock.restoreAll();
  });

  describe('createRecord', () => {
    it('creates a resume record with pending status, TTL, and ISO createdAt', async () => {
      let sentCommand: any = null;
      mock.method(dynamo, 'send', async (command: any) => {
        sentCommand = command;
        return {};
      });

      const params = {
        resumeId: 'res_abc123',
        customerId: 'cust_xyz789',
        fileName: 'john-doe.pdf',
        fileSizeBytes: 204800,
      };

      const before = Math.floor(Date.now() / 1000);
      await createRecord(params);
      const after = Math.floor(Date.now() / 1000);

      assert.ok(sentCommand);
      assert.strictEqual(sentCommand.input.TableName, env.DYNAMODB_TABLE_NAME);
      
      const item = sentCommand.input.Item as ResumeRecord;
      assert.strictEqual(item.resumeId, 'res_abc123');
      assert.strictEqual(item.customerId, 'cust_xyz789');
      assert.strictEqual(item.status, 'pending');
      assert.strictEqual(item.fileName, 'john-doe.pdf');
      assert.strictEqual(item.fileSizeBytes, 204800);
      assert.strictEqual(item.extractedText, undefined);

      // Verify ISO date string
      assert.ok(Date.parse(item.createdAt));

      // Verify TTL in seconds
      const expectedTtlMin = before + env.RESUME_TTL_HOURS * 3600;
      const expectedTtlMax = after + env.RESUME_TTL_HOURS * 3600;
      assert.ok(item.expiresAt >= expectedTtlMin && item.expiresAt <= expectedTtlMax);
    });

    it('logs safe error without PII and re-throws when PutCommand fails', async () => {
      let loggedError: any = null;
      mock.method(logger, 'error', (msg: string, meta: any) => {
        loggedError = { msg, meta };
      });

      const customError = new Error('DynamoDB write error');
      customError.name = 'ProvisionedThroughputExceededException';

      mock.method(dynamo, 'send', async () => {
        throw customError;
      });

      await assert.rejects(
        async () => {
          await createRecord({
            resumeId: 'res_err123',
            customerId: 'cust_123',
            fileName: 'test.pdf',
            fileSizeBytes: 100,
          });
        },
        (err: Error) => {
          return err.message === 'DynamoDB write error';
        }
      );

      assert.ok(loggedError);
      assert.strictEqual(loggedError.msg, 'DynamoDB createRecord failed');
      assert.strictEqual(loggedError.meta.resumeId, 'res_err123');
      assert.strictEqual(loggedError.meta.errorCode, 'ProvisionedThroughputExceededException');
    });
  });

  describe('getRecord', () => {
    it('returns ResumeRecord when item is found', async () => {
      const mockRecord: ResumeRecord = {
        resumeId: 'res_found123',
        customerId: 'cust_123',
        status: 'ready',
        extractedText: 'Sample extracted resume text',
        fileName: 'resume.pdf',
        fileSizeBytes: 1024,
        createdAt: new Date().toISOString(),
        expiresAt: Math.floor(Date.now() / 1000) + 86400,
      };

      let sentCommand: any = null;
      mock.method(dynamo, 'send', async (command: any) => {
        sentCommand = command;
        return { Item: mockRecord };
      });

      const record = await getRecord('res_found123');
      assert.ok(sentCommand);
      assert.strictEqual(sentCommand.input.TableName, env.DYNAMODB_TABLE_NAME);
      assert.deepStrictEqual(sentCommand.input.Key, { resumeId: 'res_found123' });
      assert.deepStrictEqual(record, mockRecord);
    });

    it('returns null when item is not found', async () => {
      mock.method(dynamo, 'send', async () => {
        return {};
      });

      const record = await getRecord('res_not_found');
      assert.strictEqual(record, null);
    });

    it('logs safe error and re-throws when GetCommand fails', async () => {
      let loggedError: any = null;
      mock.method(logger, 'error', (msg: string, meta: any) => {
        loggedError = { msg, meta };
      });

      const customError = new Error('ResourceNotFoundException');
      customError.name = 'ResourceNotFoundException';

      mock.method(dynamo, 'send', async () => {
        throw customError;
      });

      await assert.rejects(
        async () => {
          await getRecord('res_err123');
        },
        (err: Error) => {
          return err.message === 'ResourceNotFoundException';
        }
      );

      assert.ok(loggedError);
      assert.strictEqual(loggedError.msg, 'DynamoDB getRecord failed');
      assert.strictEqual(loggedError.meta.resumeId, 'res_err123');
      assert.strictEqual(loggedError.meta.errorCode, 'ResourceNotFoundException');
    });
  });

  describe('updateRecord', () => {
    it('updates status and extractedText when ready', async () => {
      let sentCommand: any = null;
      mock.method(dynamo, 'send', async (command: any) => {
        sentCommand = command;
        return {};
      });

      await updateRecord({
        resumeId: 'res_ready123',
        status: 'ready',
        extractedText: 'Extracted resume content here',
      });

      assert.ok(sentCommand);
      assert.strictEqual(sentCommand.input.TableName, env.DYNAMODB_TABLE_NAME);
      assert.deepStrictEqual(sentCommand.input.Key, { resumeId: 'res_ready123' });
      assert.strictEqual(
        sentCommand.input.UpdateExpression,
        'SET #status = :status, extractedText = :text'
      );
      assert.deepStrictEqual(sentCommand.input.ExpressionAttributeNames, {
        '#status': 'status',
      });
      assert.deepStrictEqual(sentCommand.input.ExpressionAttributeValues, {
        ':status': 'ready',
        ':text': 'Extracted resume content here',
      });
    });

    it('updates only status when extractedText is omitted (failed status)', async () => {
      let sentCommand: any = null;
      mock.method(dynamo, 'send', async (command: any) => {
        sentCommand = command;
        return {};
      });

      await updateRecord({
        resumeId: 'res_failed123',
        status: 'failed',
      });

      assert.ok(sentCommand);
      assert.strictEqual(sentCommand.input.TableName, env.DYNAMODB_TABLE_NAME);
      assert.deepStrictEqual(sentCommand.input.Key, { resumeId: 'res_failed123' });
      assert.strictEqual(
        sentCommand.input.UpdateExpression,
        'SET #status = :status'
      );
      assert.deepStrictEqual(sentCommand.input.ExpressionAttributeNames, {
        '#status': 'status',
      });
      assert.deepStrictEqual(sentCommand.input.ExpressionAttributeValues, {
        ':status': 'failed',
      });
    });

    it('logs safe error without PII and re-throws when UpdateCommand fails', async () => {
      let loggedError: any = null;
      mock.method(logger, 'error', (msg: string, meta: any) => {
        loggedError = { msg, meta };
      });

      const customError = new Error('InternalServerError');
      customError.name = 'InternalServerError';

      mock.method(dynamo, 'send', async () => {
        throw customError;
      });

      await assert.rejects(
        async () => {
          await updateRecord({
            resumeId: 'res_err123',
            status: 'ready',
            extractedText: 'PII Sensitive Data That Should Not Be Logged',
          });
        },
        (err: Error) => {
          return err.message === 'InternalServerError';
        }
      );

      assert.ok(loggedError);
      assert.strictEqual(loggedError.msg, 'DynamoDB updateRecord failed');
      assert.strictEqual(loggedError.meta.resumeId, 'res_err123');
      assert.strictEqual(loggedError.meta.errorCode, 'InternalServerError');
      assert.strictEqual(loggedError.meta.extractedText, undefined);
    });
  });
});
