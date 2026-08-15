import { readFile } from "node:fs/promises";
import path from "node:path";
import { parse } from "yaml";
import { z } from "zod";

const modelSchema = z.object({
  provider: z.enum(["openai-compatible", "anthropic"]),
  model: z.string().min(1),
  baseUrl: z.url(),
  apiKeyEnv: z.string().regex(/^[A-Z][A-Z0-9_]*$/),
  headers: z.record(z.string(), z.string()).optional()
});

const fileSchema = z.object({
  defaultModel: z.string().min(1),
  models: z.record(z.string(), modelSchema).refine((models) => Object.keys(models).length > 0, "models cannot be empty")
});

export type ModelConfig = z.infer<typeof modelSchema>;
export type ModelFile = z.infer<typeof fileSchema>;

export async function readModelFile(file = path.resolve("models.yaml")): Promise<ModelFile> {
  return fileSchema.parse(parse(await readFile(file, "utf8")));
}
