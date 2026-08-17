import { S3Client, PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import crypto from "node:crypto";
import { env } from "../lib/env";

export const s3Client = new S3Client({ region: env.AWS_REGION });

export async function fetchFileFromS3(bucket: string, key: string): Promise<Buffer> {
  const command = new GetObjectCommand({ Bucket: bucket, Key: key });
  const response = await s3Client.send(command);

  const stream = response.Body;
  if (!stream) throw new Error("Empty S3 response body");

  // Convert readable stream to Buffer
  const chunks: Uint8Array[] = [];
  for await (const chunk of stream as AsyncIterable<Uint8Array>) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

export class S3Service {
  /**
   * Generates a presigned URL for uploading a resume.
   * @param contentType The MIME type of the file.
   * @param customResumeId Optional custom resume ID to use.
   * @returns An object containing the upload URL, the generated resume ID, and the expiration time.
   */
  static async generatePresignedUploadUrl(contentType: string, customResumeId?: string) {
    const resumeId = customResumeId || `res_${crypto.randomUUID().replace(/-/g, '')}`;
    const key = `${resumeId}.pdf`;

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

