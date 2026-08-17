import { describe, it, mock, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import app from '../src/app';
import { dynamo, ResumeRecord, getRecord } from '../src/services/dynamo.service';
import { s3Client } from '../src/services/s3.service';
import { handler as extractorHandler } from '../src/extractor';
import { logger } from '../src/lib/logger';
import { env } from '../src/lib/env';
import { generateApiKey } from '../src/utils/crypto';

describe('Upload URL Route (POST /v1/resumes/upload-url)', { concurrency: 1 }, () => {
  beforeEach(() => {
    mock.restoreAll();
  });

  const { apiKey, secretHash } = generateApiKey('live');
  const mockUser = {
    userId: 'cust_enterprise_01',
    email: 'test@example.com',
    status: 'active',
    plan: 'free',
  };

  const handleAuthDynamo = (command: any) => {
    if (command.input?.Key?.resumeId === `APIKEY_HASH#${secretHash}`) {
      return { Item: { userId: 'cust_enterprise_01', keyId: 'key_123' } };
    }
    if (command.input?.Key?.resumeId === 'APIKEY#key_123') {
      return {
        Item: {
          keyId: 'key_123',
          userId: 'cust_enterprise_01',
          secretHash,
          status: 'active',
        },
      };
    }
    if (command.input?.Key?.resumeId === 'USER#cust_enterprise_01') {
      return { Item: mockUser };
    }
    return null;
  };

  it('generates presigned upload URL and creates pending DynamoDB record successfully', async () => {
    let dynamoItemCreated: any = null;
    mock.method(dynamo, 'send', async (command: any) => {
      const auth = handleAuthDynamo(command);
      if (auth) return auth;

      if (command.input?.Item?.fileName) {
        dynamoItemCreated = command.input.Item;
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
        fileName: 'jane-doe-resume.pdf',
        contentType: 'application/pdf',
        fileSizeBytes: 1048576,
      }),
    });

    assert.strictEqual(response.status, 200);

    const json = await response.json();
    assert.strictEqual(json.success, true);
    assert.ok(json.data.resumeId);
    assert.ok(json.data.resumeId.startsWith('res_'));
    assert.ok(json.data.uploadUrl);
    assert.strictEqual(json.data.expiresIn, undefined);

    // Verify DynamoDB record written
    assert.ok(dynamoItemCreated);
    assert.strictEqual(dynamoItemCreated.resumeId, json.data.resumeId);
    assert.strictEqual(dynamoItemCreated.customerId, 'cust_enterprise_01');
    assert.strictEqual(dynamoItemCreated.userId, 'cust_enterprise_01');
    assert.strictEqual(dynamoItemCreated.apiKeyId, 'key_123');
    assert.strictEqual(dynamoItemCreated.status, 'pending');
    assert.strictEqual(dynamoItemCreated.fileName, 'jane-doe-resume.pdf');
    assert.strictEqual(dynamoItemCreated.fileSizeBytes, 1048576);
    assert.strictEqual(dynamoItemCreated.extractedText, undefined);
    assert.ok(dynamoItemCreated.createdAt);
    assert.ok(dynamoItemCreated.expiresAt > Math.floor(Date.now() / 1000));
  });

  it('works with root /upload-url alias route with API key', async () => {
    let dynamoItemCreated: any = null;
    mock.method(dynamo, 'send', async (command: any) => {
      const auth = handleAuthDynamo(command);
      if (auth) return auth;

      if (command.input?.Item?.fileName) {
        dynamoItemCreated = command.input.Item;
      }
      return {};
    });

    const response = await app.request('/upload-url', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        fileName: 'minimal-resume.pdf',
        contentType: 'application/pdf',
      }),
    });

    assert.strictEqual(response.status, 200);
    const json = await response.json();
    assert.strictEqual(json.success, true);
    assert.strictEqual(dynamoItemCreated.customerId, 'cust_enterprise_01');
    assert.strictEqual(dynamoItemCreated.fileSizeBytes, 0);
    assert.strictEqual(dynamoItemCreated.status, 'pending');
  });

  it('returns 401 UNAUTHORIZED when Authorization header is missing', async () => {
    const response = await app.request('/v1/resumes/upload-url', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        fileName: 'resume.pdf',
        contentType: 'application/pdf',
      }),
    });

    assert.strictEqual(response.status, 401);
    const json = await response.json();
    assert.strictEqual(json.success, false);
    assert.strictEqual(json.error.code, 'UNAUTHORIZED');
  });

  it('returns 400 INVALID_REQUEST when request body is invalid JSON', async () => {
    mock.method(dynamo, 'send', async (command: any) => {
      const auth = handleAuthDynamo(command);
      if (auth) return auth;
      return {};
    });

    const response = await app.request('/v1/resumes/upload-url', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: 'this is not valid json',
    });

    assert.strictEqual(response.status, 400);
    const json = await response.json();
    assert.strictEqual(json.success, false);
    assert.strictEqual(json.error.code, 'INVALID_REQUEST');
  });

  it('returns 400 INVALID_REQUEST when fileName is missing or empty', async () => {
    mock.method(dynamo, 'send', async (command: any) => {
      const auth = handleAuthDynamo(command);
      if (auth) return auth;
      return {};
    });

    const response = await app.request('/v1/resumes/upload-url', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        fileName: '',
        contentType: 'application/pdf',
      }),
    });

    assert.strictEqual(response.status, 400);
    const json = await response.json();
    assert.strictEqual(json.success, false);
    assert.strictEqual(json.error.code, 'INVALID_REQUEST');
  });

  it('returns 415 UNSUPPORTED_FILE_TYPE when contentType is not application/pdf', async () => {
    mock.method(dynamo, 'send', async (command: any) => {
      const auth = handleAuthDynamo(command);
      if (auth) return auth;
      return {};
    });

    const response = await app.request('/v1/resumes/upload-url', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        fileName: 'photo.png',
        contentType: 'image/png',
      }),
    });

    assert.strictEqual(response.status, 415);
    const json = await response.json();
    assert.strictEqual(json.success, false);
    assert.strictEqual(json.error.code, 'UNSUPPORTED_FILE_TYPE');
  });

  it('returns 413 FILE_TOO_LARGE when fileSizeBytes exceeds MAX_FILE_SIZE_MB', async () => {
    mock.method(dynamo, 'send', async (command: any) => {
      const auth = handleAuthDynamo(command);
      if (auth) return auth;
      return {};
    });

    const oversizedBytes = (env.MAX_FILE_SIZE_MB + 1) * 1024 * 1024;
    const response = await app.request('/v1/resumes/upload-url', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        fileName: 'huge-resume.pdf',
        contentType: 'application/pdf',
        fileSizeBytes: oversizedBytes,
      }),
    });

    assert.strictEqual(response.status, 413);
    const json = await response.json();
    assert.strictEqual(json.success, false);
    assert.strictEqual(json.error.code, 'FILE_TOO_LARGE');
  });

  it('returns 500 INTERNAL_ERROR and logs safely when DynamoDB createRecord fails', async () => {
    let errorLogged = false;
    mock.method(logger, 'error', () => {
      errorLogged = true;
    });

    mock.method(dynamo, 'send', async (command: any) => {
      const auth = handleAuthDynamo(command);
      if (auth) return auth;

      if (command.input?.Item?.fileName) {
        throw new Error('AWS DynamoDB connection failure');
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
        fileName: 'resume.pdf',
        contentType: 'application/pdf',
      }),
    });

    assert.strictEqual(response.status, 500);
    const json = await response.json();
    assert.strictEqual(json.success, false);
    assert.strictEqual(json.error.code, 'INTERNAL_ERROR');
    assert.ok(errorLogged);
  });

  it('completes the full flow: upload-url initializes pending -> Extractor Lambda updates to ready with text', async () => {
    const db = new Map<string, ResumeRecord>();

    mock.method(dynamo, 'send', async (command: any) => {
      const auth = handleAuthDynamo(command);
      if (auth) return auth;

      if (command.input?.Item?.fileName) {
        db.set(command.input.Item.resumeId, command.input.Item);
        return {};
      }
      if (command.input?.Key?.resumeId && command.input?.UpdateExpression) {
        const key = command.input.Key.resumeId;
        const existing = db.get(key) || ({} as ResumeRecord);
        existing.status = command.input.ExpressionAttributeValues[':status'];
        if (command.input.ExpressionAttributeValues[':text']) {
          existing.extractedText = command.input.ExpressionAttributeValues[':text'];
        }
        db.set(key, existing);
        return {};
      }
      if (command.input?.Key?.resumeId) {
        const item = db.get(command.input.Key.resumeId);
        return item ? { Item: item } : {};
      }
      return {};
    });

    // 1. Client calls /upload-url with API key
    const uploadRes = await app.request('/v1/resumes/upload-url', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        fileName: 'john-doe-full-flow.pdf',
        contentType: 'application/pdf',
        fileSizeBytes: 204800,
      }),
    });

    assert.strictEqual(uploadRes.status, 200);
    const uploadJson = await uploadRes.json();
    const { resumeId } = uploadJson.data;

    // Immediately after /upload-url, DynamoDB has status: "pending" and no extractedText
    const recordImmediately = await getRecord(resumeId);
    assert.ok(recordImmediately);
    assert.strictEqual(recordImmediately.resumeId, resumeId);
    assert.strictEqual(recordImmediately.status, 'pending');
    assert.strictEqual(recordImmediately.extractedText, undefined);

    // 2. Client uploads PDF to S3, S3 fires Extractor Lambda automatically in background
    const validPdfPath = path.resolve('node_modules/pdf-parse/test/data/01-valid.pdf');
    const validPdfBuffer = fs.readFileSync(validPdfPath);

    async function* createStream() {
      yield new Uint8Array(validPdfBuffer);
    }

    mock.method(s3Client, 'send', async () => {
      return { Body: createStream() };
    });

    const s3Event = {
      Records: [
        {
          eventVersion: '2.1',
          eventSource: 'aws:s3',
          awsRegion: 'ap-south-1',
          eventTime: new Date().toISOString(),
          eventName: 'ObjectCreated:Put',
          userIdentity: { principalId: 'AWS:123' },
          requestParameters: { sourceIPAddress: '127.0.0.1' },
          responseElements: { 'x-amz-request-id': 'req-1', 'x-amz-id-2': 'id-2' },
          s3: {
            s3SchemaVersion: '1.0',
            configurationId: 'pdf-uploaded',
            bucket: { name: 'parseflowai', ownerIdentity: { principalId: 'owner-1' }, arn: 'arn:aws:s3:::parseflowai' },
            object: { key: `${resumeId}.pdf`, size: 204800, eTag: 'e1', sequencer: 's1' },
          },
        },
      ],
    };

    await (extractorHandler as any)(s3Event, {} as any, () => {});

    // 3. Extractor Lambda finished processing in background -> record is now "ready" with extractedText
    const recordAfterExtraction = await getRecord(resumeId);
    assert.ok(recordAfterExtraction);
    assert.strictEqual(recordAfterExtraction.resumeId, resumeId);
    assert.strictEqual(recordAfterExtraction.status, 'ready');
    assert.ok(recordAfterExtraction.extractedText);
    assert.ok(recordAfterExtraction.extractedText.length > 20);
    assert.strictEqual(recordAfterExtraction.fileName, 'john-doe-full-flow.pdf');
    assert.strictEqual(recordAfterExtraction.customerId, 'cust_enterprise_01');
  });
});
