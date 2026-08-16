import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { z } from "zod";

const cliConfigSchema = z.object({
  apps: z.array(z.object({
    name: z.string().optional(),
    appId: z.string(),
    brand: z.string().optional(),
    lang: z.string().optional(),
    users: z.array(z.object({ userName: z.string().optional() })).default([])
  })).default([])
}).passthrough();

const registrySchema = z.object({
  schemaVersion: z.literal(1),
  agents: z.array(z.object({
    id: z.string().regex(/^[a-z0-9][a-z0-9-]{0,62}$/),
    name: z.string().min(1).max(80),
    cliProfile: z.string().min(1).max(80),
    runtime: z.enum(["langbot", "codex"]),
    sourceDir: z.string().min(1),
    artifactDir: z.string().min(1),
    deployDir: z.string().min(1).optional(),
    enabled: z.boolean().default(true)
  }).strict()).default([])
}).strict();

export type AgentProfile = z.infer<typeof registrySchema>["agents"][number];
export interface CliProfile {
  name: string;
  appIdSuffix: string;
  brand: string;
  language: string;
  users: string[];
  classification: "agent" | "application";
}

export interface ProfileRegistry {
  schemaVersion: 1;
  agents: AgentProfile[];
}

export function defaultRegistryFile(environment: NodeJS.ProcessEnv = process.env): string {
  return environment.FEISHU_PROFILE_REGISTRY || path.join(homedir(), ".feishu-agent-scaffold", "profiles.json");
}

export function defaultAgentProfiles(projectRoot: string): AgentProfile[] {
  return [{
    id: "langbot-codex",
    name: "LangBot Codex Agent",
    cliProfile: "langbot-agent",
    runtime: "langbot",
    sourceDir: path.resolve(projectRoot, "../../production/langbot-codex-agent"),
    artifactDir: path.resolve(projectRoot, "../../production/langbot-deploy"),
    deployDir: path.resolve(projectRoot, "../../production/langbot-deploy"),
    enabled: true
  }];
}

export async function readRegistry(file: string, projectRoot: string): Promise<ProfileRegistry> {
  try {
    return registrySchema.parse(JSON.parse(await readFile(file, "utf8")));
  } catch (error) {
    if (isNotFound(error)) return { schemaVersion: 1, agents: defaultAgentProfiles(projectRoot) };
    throw error;
  }
}

export async function writeRegistry(file: string, value: ProfileRegistry): Promise<void> {
  const checked = registrySchema.parse(value);
  await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  const temporary = `${file}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(checked, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  await rename(temporary, file);
}

export async function readCliProfiles(configFile = path.join(homedir(), ".lark-cli", "config.json")): Promise<CliProfile[]> {
  try {
    const parsed = cliConfigSchema.parse(JSON.parse(await readFile(configFile, "utf8")));
    return parsed.apps.map((app) => {
      const name = app.name || app.appId;
      const classification = /(?:agent|bot|langbot)/i.test(name) ? "agent" : "application";
      return {
        name,
        appIdSuffix: maskAppId(app.appId),
        brand: app.brand || "feishu",
        language: app.lang || "unknown",
        users: app.users.map((user) => user.userName || "已授权用户"),
        classification
      };
    });
  } catch (error) {
    if (isNotFound(error)) return [];
    throw error;
  }
}

export function maskAppId(value: string): string {
  return value.length <= 6 ? "***" : `${value.slice(0, 4)}...${value.slice(-4)}`;
}

function isNotFound(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}
