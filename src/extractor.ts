import type { S3Handler } from "aws-lambda";
import { fetchFileFromS3 } from "./services/s3.service";
import { extractTextFromBuffer } from "./services/pdf.service";
import { updateRecord } from "./services/dynamo.service";
import { logger } from "./lib/logger";

export const handler: S3Handler = async (event) => {
  for (const record of event.Records) {
    const bucket = record.s3.bucket.name;
    const key = decodeURIComponent(record.s3.object.key.replace(/\+/g, " "));
    const resumeId = (key.split("/").pop() || key).replace(".pdf", "");

    logger.info("Extractor triggered", { resumeId, bucket });

    try {
      // Step 1: Fetch PDF from S3
      const pdfBuffer = await fetchFileFromS3(bucket, key);
      const fileSizeBytes = record.s3.object.size || pdfBuffer.length;

      // Step 2: Extract text
      const extractedText = await extractTextFromBuffer(pdfBuffer);

      // Step 3: Write success to DynamoDB
      await updateRecord({ resumeId, status: "ready", extractedText, fileSizeBytes });

      logger.info("Extraction complete", { resumeId, fileSizeBytes });

    } catch (err) {
      // Step 3 (on failure): Write failure to DynamoDB
      const fileSizeBytes = record.s3.object.size;
      logger.error("Extraction failed", { resumeId, error: (err as Error).message });
      await updateRecord({ resumeId, status: "failed", fileSizeBytes });
    }
  }
};
