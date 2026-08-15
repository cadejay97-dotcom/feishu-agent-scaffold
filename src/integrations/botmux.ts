import { spawn } from "node:child_process";
import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

export const BOTMUX_UPSTREAM_VERSION = "3.13.0";

export const BOTMUX_CLI_IDS = [
  "claude-code",
  "seed",
  "relay",
  "aiden",
  "coco",
  "codex",
  "codex-app",
  "cursor",
  "gemini",
  "genius",
  "opencode",
  "opencode2",
  "antigravity",
  "mtr",
  "hermes",
  "mira",
  "mir",
  "traex",
  "pi",
  "copilot",
  "oh-my-pi",
  "kimi",
  "grok",
  "kiro-cli",
  "riff",
  "reasonix",
  "dsh"
] as const;

const absolutePath = z.string().min(1).refine(
  (value) => path.posix.isAbsolute(value) || path.win32.isAbsolute(value),
  "must be an absolute path"
);

const environmentName = z.string().regex(/^[A-Z_][A-Z0-9_]*$/, "must be an uppercase environment variable name");

const createAppSchema = z.object({
  mode: z.literal("create"),
  name: z.string().min(1),
  brand: z.enum(["feishu", "lark"]).default("feishu")
}).strict();

const existingAppSchema = z.object({
  mode: z.literal("existing"),
  appIdEnv: environmentName,
  appSecretEnv: environmentName,
  brand: z.enum(["feishu", "lark"]).default("feishu")
}).strict();

export const botmuxBridgeSchema = z.object({
  schemaVersion: z.literal(1),
  name: z.string().min(1),
  cliId: z.enum(BOTMUX_CLI_IDS),
  workspaceDir: absolutePath,
  owners: z.array(z.string().trim().min(1)).min(1),
  allowedChatGroups: z.array(z.string().trim().min(1)).default([]),
  model: z.string().trim().min(1).optional(),
  cliPathOverride: absolutePath.optional(),
  backend: z.enum(["pty", "tmux", "herdr", "zellij", "zmx"]).default("tmux"),
  openPlatformAuto: z.boolean().default(true),
  app: z.discriminatedUnion("mode", [createAppSchema, existingAppSchema])
}).strict();

export type BotmuxBridgeConfig = z.infer<typeof botmuxBridgeSchema>;

export function parseBotmuxBridgeConfig(raw: string): BotmuxBridgeConfig {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(`BotMux bridge config is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  return botmuxBridgeSchema.parse(parsed);
}

export async function readBotmuxBridgeConfig(file: string): Promise<BotmuxBridgeConfig> {
  return parseBotmuxBridgeConfig(await readFile(file, "utf8"));
}

export function buildBotmuxSetupArgs(
  config: BotmuxBridgeConfig,
  environment: NodeJS.ProcessEnv = process.env
): string[] {
  const args = ["setup", "add"];

  if (config.app.mode === "create") {
    args.push("--create-app", "--app-name", config.app.name);
  } else {
    args.push(
      "--app-id",
      requiredEnvironment(environment, config.app.appIdEnv),
      "--app-secret",
      requiredEnvironment(environment, config.app.appSecretEnv)
    );
  }

  args.push(
    "--name", config.name,
    "--cli", config.cliId,
    "--backend", config.backend,
    "--default-working-dir", config.workspaceDir,
    "--allowed-users", config.owners.join(","),
    "--brand", config.app.brand
  );
  if (config.model) args.push("--model", config.model);
  if (config.cliPathOverride) args.push("--cli-path", config.cliPathOverride);
  if (config.allowedChatGroups.length > 0) {
    args.push("--allowed-chat-groups", config.allowedChatGroups.join(","));
  }
  args.push(config.openPlatformAuto ? "--open-platform-auto" : "--no-open-platform-auto");
  return args;
}

export function renderBotmuxSetupCommand(config: BotmuxBridgeConfig): string {
  const appArgs = config.app.mode === "create"
    ? ["--create-app", "--app-name", config.app.name]
    : ["--app-id", `$${config.app.appIdEnv}`, "--app-secret", `$${config.app.appSecretEnv}`];
  const args = [
    "setup", "add",
    ...appArgs,
    "--name", config.name,
    "--cli", config.cliId,
    "--backend", config.backend,
    "--default-working-dir", config.workspaceDir,
    "--allowed-users", config.owners.join(","),
    "--brand", config.app.brand
  ];
  if (config.model) args.push("--model", config.model);
  if (config.cliPathOverride) args.push("--cli-path", config.cliPathOverride);
  if (config.allowedChatGroups.length > 0) {
    args.push("--allowed-chat-groups", config.allowedChatGroups.join(","));
  }
  args.push(config.openPlatformAuto ? "--open-platform-auto" : "--no-open-platform-auto");
  return ["botmux", ...args].map(shellQuote).join(" ");
}

export async function validateBotmuxRuntime(config: BotmuxBridgeConfig): Promise<void> {
  await access(config.workspaceDir);
  if (config.cliPathOverride) await access(config.cliPathOverride);
  const versionOutput = await capture("botmux", ["--version"]);
  const version = versionOutput.match(/\d+\.\d+\.\d+/)?.[0];
  if (!version) throw new Error(`Could not determine BotMux version from: ${versionOutput.trim()}`);
  if (compareVersions(version, BOTMUX_UPSTREAM_VERSION) < 0) {
    throw new Error(`BotMux ${BOTMUX_UPSTREAM_VERSION}+ is required; found ${version}`);
  }
}

export async function runBotmuxSetup(config: BotmuxBridgeConfig): Promise<void> {
  await run("botmux", buildBotmuxSetupArgs(config));
}

function requiredEnvironment(environment: NodeJS.ProcessEnv, name: string): string {
  const value = environment[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function shellQuote(value: string): string {
  if (/^[A-Za-z0-9_./:@,+$-]+$/.test(value)) return value;
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

function compareVersions(left: string, right: string): number {
  const a = left.split(".").map(Number);
  const b = right.split(".").map(Number);
  for (let index = 0; index < Math.max(a.length, b.length); index++) {
    const difference = (a[index] ?? 0) - (b[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

function capture(command: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    child.stdout.on("data", (chunk) => { output += chunk; });
    child.stderr.on("data", (chunk) => { output += chunk; });
    child.on("error", reject);
    child.on("exit", (code) => code === 0
      ? resolve(output)
      : reject(new Error(`${command} ${args.join(" ")} exited with ${code}: ${output.trim()}`)));
  });
}

function run(command: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: "inherit" });
    child.on("error", reject);
    child.on("exit", (code) => code === 0
      ? resolve()
      : reject(new Error(`${command} ${args.join(" ")} exited with ${code}`)));
  });
}
