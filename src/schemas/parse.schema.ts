import { z } from "zod";

// The shorthand schema value types a customer can send.
// Recursive type: string leaf, array of shorthand, or nested object of shorthand.
type SchemaShorthand =
  | "string"
  | "number"
  | "boolean"
  | SchemaShorthand[]
  | { [key: string]: SchemaShorthand };

const schemaShorthandValidator: z.ZodType<SchemaShorthand> = z.lazy(() =>
  z.union([
    z.literal("string"),
    z.literal("number"),
    z.literal("boolean"),
    z.array(schemaShorthandValidator),
    z.record(z.string(), schemaShorthandValidator),
  ])
);

export const parseRequestSchema = z.object({
  resumeId: z.string().min(1),
  schema: z.record(z.string(), schemaShorthandValidator),
});

export type ParseRequest = z.infer<typeof parseRequestSchema>;
export type { SchemaShorthand };
