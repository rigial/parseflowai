// @ts-ignore
import pdfParse from "pdf-parse/lib/pdf-parse.js";

export async function extractTextFromBuffer(buffer: Buffer): Promise<string> {
  const result = await pdfParse(buffer);
  const text = result.text?.trim();

  if (!text || text.length < 10) {
    throw new Error("PDF appears to be empty or image-based — no extractable text found");
  }

  return text;
}
