import { GoogleGenAI } from "@google/genai";
import { env } from "../lib/env";
import type { SchemaShorthand } from "../schemas/parse.schema";

export const ai = new GoogleGenAI({ apiKey: env.GEMINI_API_KEY });

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
): Promise<unknown> {
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

  try {
    return JSON.parse(response.text);
  } catch {
    throw new Error("Gemini response was not valid JSON");
  }
}
