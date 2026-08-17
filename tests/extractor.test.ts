import { describe, it, mock, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import type { S3Event } from 'aws-lambda';
import { handler } from '../src/extractor';
import { s3Client } from '../src/services/s3.service';
import { dynamo } from '../src/services/dynamo.service';
import { logger } from '../src/lib/logger';

describe('Extractor Lambda Handler', () => {
  beforeEach(() => {
    mock.restoreAll();
  });

  it('processes S3 event successfully: fetches PDF, extracts text, and updates DynamoDB to ready', async () => {
    const validPdfPath = path.resolve('node_modules/pdf-parse/test/data/01-valid.pdf');
    const validPdfBuffer = fs.readFileSync(validPdfPath);

    async function* createMockStream() {
      yield new Uint8Array(validPdfBuffer);
    }

    let s3CommandSent: any = null;
    mock.method(s3Client, 'send', async (command: any) => {
      s3CommandSent = command;
      return {
        Body: createMockStream(),
      };
    });

    let dynamoCommandSent: any = null;
    mock.method(dynamo, 'send', async (command: any) => {
      dynamoCommandSent = command;
      return {};
    });

    const infoLogs: Array<{ message: string; meta?: any }> = [];
    mock.method(logger, 'info', (message: string, meta?: any) => {
      infoLogs.push({ message, meta });
    });

    const event: S3Event = {
      Records: [
        {
          eventVersion: '2.1',
          eventSource: 'aws:s3',
          awsRegion: 'ap-south-1',
          eventTime: '2026-08-17T10:00:00.000Z',
          eventName: 'ObjectCreated:Put',
          userIdentity: { principalId: 'AWS:123' },
          requestParameters: { sourceIPAddress: '127.0.0.1' },
          responseElements: { 'x-amz-request-id': 'req-1', 'x-amz-id-2': 'id-2' },
          s3: {
            s3SchemaVersion: '1.0',
            configurationId: 'pdf-uploaded',
            bucket: {
              name: 'parseflowai',
              ownerIdentity: { principalId: 'owner-1' },
              arn: 'arn:aws:s3:::parseflowai',
            },
            object: {
              key: 'res_abc%20123+extra.pdf',
              size: 1024,
              eTag: 'etag-1',
              sequencer: 'seq-1',
            },
          },
        },
      ],
    };

    await (handler as any)(event, {} as any, () => {});

    // Verify S3 GetObjectCommand parameters with URL decode
    assert.ok(s3CommandSent);
    assert.strictEqual(s3CommandSent.input.Bucket, 'parseflowai');
    assert.strictEqual(s3CommandSent.input.Key, 'res_abc 123 extra.pdf');

    // Verify DynamoDB UpdateCommand parameters
    assert.ok(dynamoCommandSent);
    assert.deepStrictEqual(dynamoCommandSent.input.Key, { resumeId: 'res_abc 123 extra' });
    assert.strictEqual(dynamoCommandSent.input.ExpressionAttributeValues[':status'], 'ready');
    assert.ok(typeof dynamoCommandSent.input.ExpressionAttributeValues[':text'] === 'string');
    assert.ok(dynamoCommandSent.input.ExpressionAttributeValues[':text'].length > 10);

    // Verify info logs
    assert.ok(infoLogs.some(l => l.message === 'Extractor triggered' && l.meta?.resumeId === 'res_abc 123 extra'));
    assert.ok(infoLogs.some(l => l.message === 'Extraction complete' && l.meta?.resumeId === 'res_abc 123 extra'));
  });

  it('handles extraction failure: logs error and updates DynamoDB to failed', async () => {
    // Return a corrupt/invalid PDF buffer
    async function* createCorruptStream() {
      yield new Uint8Array(Buffer.from('not a valid pdf content'));
    }

    mock.method(s3Client, 'send', async () => {
      return {
        Body: createCorruptStream(),
      };
    });

    let dynamoCommandSent: any = null;
    mock.method(dynamo, 'send', async (command: any) => {
      dynamoCommandSent = command;
      return {};
    });

    const errorLogs: Array<{ message: string; meta?: any }> = [];
    mock.method(logger, 'error', (message: string, meta?: any) => {
      errorLogs.push({ message, meta });
    });

    const event: S3Event = {
      Records: [
        {
          eventVersion: '2.1',
          eventSource: 'aws:s3',
          awsRegion: 'ap-south-1',
          eventTime: '2026-08-17T10:00:00.000Z',
          eventName: 'ObjectCreated:Put',
          userIdentity: { principalId: 'AWS:123' },
          requestParameters: { sourceIPAddress: '127.0.0.1' },
          responseElements: { 'x-amz-request-id': 'req-1', 'x-amz-id-2': 'id-2' },
          s3: {
            s3SchemaVersion: '1.0',
            configurationId: 'pdf-uploaded',
            bucket: {
              name: 'parseflowai',
              ownerIdentity: { principalId: 'owner-1' },
              arn: 'arn:aws:s3:::parseflowai',
            },
            object: {
              key: 'res_failed_sample.pdf',
              size: 512,
              eTag: 'etag-2',
              sequencer: 'seq-2',
            },
          },
        },
      ],
    };

    await (handler as any)(event, {} as any, () => {});

    // Verify DynamoDB UpdateCommand set status to failed
    assert.ok(dynamoCommandSent);
    assert.deepStrictEqual(dynamoCommandSent.input.Key, { resumeId: 'res_failed_sample' });
    assert.strictEqual(dynamoCommandSent.input.ExpressionAttributeValues[':status'], 'failed');
    assert.strictEqual(dynamoCommandSent.input.ExpressionAttributeValues[':text'], undefined);

    // Verify error was logged
    assert.ok(errorLogs.some(l =>
      l.message === 'Extraction failed' &&
      l.meta?.resumeId === 'res_failed_sample'
    ));
  });

  it('processes multiple records in a batch event', async () => {
    const validPdfPath = path.resolve('node_modules/pdf-parse/test/data/01-valid.pdf');
    const validPdfBuffer = fs.readFileSync(validPdfPath);

    let processedKeys: string[] = [];
    mock.method(s3Client, 'send', async (command: any) => {
      processedKeys.push(command.input.Key);
      async function* createStream() {
        yield new Uint8Array(validPdfBuffer);
      }
      return {
        Body: createStream(),
      };
    });

    let updatedResumeIds: string[] = [];
    mock.method(dynamo, 'send', async (command: any) => {
      updatedResumeIds.push(command.input.Key.resumeId);
      return {};
    });

    const event: S3Event = {
      Records: [
        {
          eventVersion: '2.1',
          eventSource: 'aws:s3',
          awsRegion: 'ap-south-1',
          eventTime: '2026-08-17T10:00:00.000Z',
          eventName: 'ObjectCreated:Put',
          userIdentity: { principalId: 'AWS:123' },
          requestParameters: { sourceIPAddress: '127.0.0.1' },
          responseElements: { 'x-amz-request-id': 'req-1', 'x-amz-id-2': 'id-2' },
          s3: {
            s3SchemaVersion: '1.0',
            configurationId: 'pdf-uploaded',
            bucket: { name: 'parseflowai', ownerIdentity: { principalId: 'owner-1' }, arn: 'arn:aws:s3:::parseflowai' },
            object: { key: 'res_batch1.pdf', size: 100, eTag: 'e1', sequencer: 's1' },
          },
        },
        {
          eventVersion: '2.1',
          eventSource: 'aws:s3',
          awsRegion: 'ap-south-1',
          eventTime: '2026-08-17T10:00:00.000Z',
          eventName: 'ObjectCreated:Put',
          userIdentity: { principalId: 'AWS:123' },
          requestParameters: { sourceIPAddress: '127.0.0.1' },
          responseElements: { 'x-amz-request-id': 'req-2', 'x-amz-id-2': 'id-2' },
          s3: {
            s3SchemaVersion: '1.0',
            configurationId: 'pdf-uploaded',
            bucket: { name: 'parseflowai', ownerIdentity: { principalId: 'owner-1' }, arn: 'arn:aws:s3:::parseflowai' },
            object: { key: 'res_batch2.pdf', size: 200, eTag: 'e2', sequencer: 's2' },
          },
        },
      ],
    };

    await (handler as any)(event, {} as any, () => {});

    assert.deepStrictEqual(processedKeys, ['res_batch1.pdf', 'res_batch2.pdf']);
    assert.deepStrictEqual(updatedResumeIds, ['res_batch1', 'res_batch2']);
  });
});
