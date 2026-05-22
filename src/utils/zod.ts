import type { ZodSchema } from "zod";

export function parseOrThrow<T>(schema: ZodSchema<T>, value: unknown, label: string): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new Error(`${label} validation failed: ${parsed.error.message}`);
  }
  return parsed.data;
}
