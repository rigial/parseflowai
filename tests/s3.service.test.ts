import { describe, it, mock, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { s3Client, fetchFileFromS3, S3Service } from '../src/services/s3.service';
import { env } from '../src/lib/env';

describe('S3 Service', () => {
  beforeEach(() => {
    mock.restoreAll();
  });

  describe('fetchFileFromS3', () => {
    it('fetches file from S3 and returns Buffer from stream', async () => {
      const mockContent = Buffer.from('PDF file binary content mock');
      
      // Create async iterable stream
      async function* createMockStream() {
        yield new Uint8Array(mockContent.subarray(0, 10));
        yield new Uint8Array(mockContent.subarray(10));
      }

      let sentCommand: any = null;
      mock.method(s3Client, 'send', async (command: any) => {
        sentCommand = command;
        return {
          Body: createMockStream(),
        };
      });

      const buffer = await fetchFileFromS3('parseflowai', 'resumes/res_123.pdf');

      assert.ok(sentCommand);
      assert.strictEqual(sentCommand.input.Bucket, 'parseflowai');
      assert.strictEqual(sentCommand.input.Key, 'resumes/res_123.pdf');
      assert.deepStrictEqual(buffer, mockContent);
    });

    it('throws error when response body is empty', async () => {
      mock.method(s3Client, 'send', async () => {
        return {
          Body: undefined,
        };
      });

      await assert.rejects(
        async () => {
          await fetchFileFromS3('parseflowai', 'resumes/res_empty.pdf');
        },
        (err: Error) => {
          return err.message === 'Empty S3 response body';
        }
      );
    });
  });

  describe('generatePresignedUploadUrl', () => {
    it('generates presigned URL with proper parameters and res_ prefix', async () => {
      const result = await S3Service.generatePresignedUploadUrl('application/pdf');

      assert.ok(result.resumeId);
      assert.ok(result.resumeId.startsWith('res_'));
      assert.ok(result.uploadUrl);
      assert.strictEqual(result.expiresIn, env.S3_PRESIGNED_URL_EXPIRY);
    });

    it('uses custom resumeId when provided', async () => {
      const customId = 'res_custom_12345';
      const result = await S3Service.generatePresignedUploadUrl('application/pdf', customId);

      assert.strictEqual(result.resumeId, customId);
      assert.ok(result.uploadUrl);
    });
  });

});
