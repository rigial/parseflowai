import { GoogleGenAI } from "@google/genai";
import { env } from "../lib/env";
import type { SchemaShorthand } from "../schemas/parse.schema";

export const ai = new GoogleGenAI({ apiKey: env.GEMINI_API_KEY });

export interface AiTokenUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  provider: string;
  model: string;
}

export interface AiExtractionResult {
  data: unknown;
  tokenUsage?: AiTokenUsage;
}

// Converts the customer's shorthand schema into Gemini's responseSchema format.
export function convertToGeminiSchema(shorthand: SchemaShorthand): any {
  // Leaf types
  if (shorthand === "string") return { type: "string" };
  if (shorthand === "number") return { type: "number" };
  if (shorthand === "boolean") return { type: "boolean" };

  // Array — shorthand is [itemShorthand], always exactly one element
  if (Array.isArray(shorthand)) {
    return {
      type: "array",
      items: convertToGeminiSchema(shorthand[0]),
    };
  }

  // Object — shorthand is a record of key -> shorthand
  const properties: Record<string, any> = {};
  const required: string[] = [];

  for (const [key, value] of Object.entries(shorthand)) {
    properties[key] = convertToGeminiSchema(value);
    required.push(key); // every field the customer asked for is required
  }

  return {
    type: "object",
    properties,
    required,
  };
}

export async function extractStructuredData(
  resumeText: string,
  schema: Record<string, SchemaShorthand>
): Promise<AiExtractionResult> {
  const geminiSchema = convertToGeminiSchema(schema);

  const response = await ai.models.generateContent({
    model: env.GEMINI_MODEL,
    contents: `Extract the following information from this resume:\n\n${resumeText}`,
    config: {
      responseMimeType: "application/json",
      responseSchema: geminiSchema,
    },
  });

  if (!response.text) {
    throw new Error("Gemini returned an empty response");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(response.text);
  } catch {
    throw new Error("Gemini response was not valid JSON");
  }

  let tokenUsage: AiTokenUsage | undefined;
  const usageMetadata = (response as any).usageMetadata;
  if (usageMetadata) {
    const inputTokens = Number(usageMetadata.promptTokenCount || usageMetadata.inputTokens || 0);
    const outputTokens = Number(usageMetadata.candidatesTokenCount || usageMetadata.outputTokens || 0);
    const totalTokens = Number(usageMetadata.totalTokenCount || usageMetadata.totalTokens || inputTokens + outputTokens);

    tokenUsage = {
      inputTokens,
      outputTokens,
      totalTokens,
      provider: 'google-genai',
      model: env.GEMINI_MODEL,
    };
  }

  return {
    data: parsed,
    tokenUsage,
  };
}
