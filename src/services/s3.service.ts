import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import crypto from 'node:crypto';
import { env } from '../lib/env.js';

const s3Client = new S3Client({ region: env.AWS_REGION });

export class S3Service {
  /**
   * Generates a presigned URL for uploading a resume.
   * @param contentType The MIME type of the file.
   * @returns An object containing the upload URL, the generated resume ID, and the expiration time.
   */
  static async generatePresignedUploadUrl(contentType: string) {
    const resumeId = crypto.randomUUID();
    const key = `resumes/${resumeId}.pdf`;

    const command = new PutObjectCommand({
      Bucket: env.AWS_S3_BUCKET,
      Key: key,
      ContentType: contentType,
    });

    const uploadUrl = await getSignedUrl(s3Client, command, {
      expiresIn: env.S3_PRESIGNED_URL_EXPIRY,
    });

    return {
      uploadUrl,
      resumeId,
      expiresIn: env.S3_PRESIGNED_URL_EXPIRY,
    };
  }
}
