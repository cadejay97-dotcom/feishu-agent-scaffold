import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { readAgentManifest, type AgentManifest } from "../agent-loader.js";

const absolutePath = z.string().min(1).refine(
  (value) => path.posix.isAbsolute(value) || path.win32.isAbsolute(value),
  "must be an absolute path"
);
const environmentName = z.string().regex(/^[A-Z][A-Z0-9_]*$/, "must be an uppercase environment variable name");
const profileName = z.string().regex(/^[a-z][a-z0-9_-]*$/, "must be a lowercase identifier");
const templateValue = z.string().refine(
  (value) => !/{(?!task|prompt|mode|workspace|working_dir|context_files|context_files_csv|session_id|extra_instructions)[^}]+}/.test(value),
  "contains an unsupported CountBot CLI template variable"
);

const countBotAgentSchema = z.object({
  schemaVersion: z.literal(1),
  workspaceDir: absolutePath,
  profile: z.object({
    name: profileName,
    aliases: z.array(profileName).default([]),
    command: absolutePath.or(z.string().regex(/^[a-z][a-z0-9-]*$/)),
    args: z.array(templateValue).default([]),
    stdinTemplate: templateValue.optional(),
    inheritEnv: z.array(environmentName).default([]),
    sessionMode: z.enum(["stateless", "history", "native"]).default("history"),
    historyMessageCount: z.number().int().min(1).max(50).default(10),
    timeoutSeconds: z.number().int().min(10).max(3600).default(900),
    description: z.string().min(1)
  }).strict(),
  bot: z.object({
    accountId: z.string().regex(/^[A-Za-z0-9_-]+$/).default("default"),
    displayName: z.string().min(1),
    allowFrom: z.array(z.string().min(1)).min(1),
    appIdEnv: environmentName.default("FEISHU_APP_ID"),
    appSecretEnv: environmentName.default("FEISHU_APP_SECRET")
  }).strict()
}).strict();

export type CountBotAgentConfig = z.infer<typeof countBotAgentSchema>;

export interface CountBotIntegration {
  manifest: AgentManifest;
  config: CountBotAgentConfig;
}

export async function loadCountBotIntegration(agentDir: string): Promise<CountBotIntegration> {
  const root = path.resolve(agentDir);
  const manifest = await readAgentManifest(root);
  const config = countBotAgentSchema.parse(JSON.parse(await readFile(path.join(root, "countbot.agent.json"), "utf8")));
  const workspace = path.resolve(config.workspaceDir);
  const workingDir = config.profile.command.includes(path.sep) ? path.dirname(config.profile.command) : workspace;
  if (path.isAbsolute(config.profile.command) && isOutsideWorkspace(workspace, workingDir)) {
    throw new Error("profile.command absolute path must be inside workspaceDir or use a PATH command name");
  }
  return { manifest, config: { ...config, workspaceDir: workspace } };
}

function isOutsideWorkspace(workspace: string, candidate: string): boolean {
  const relative = path.relative(workspace, candidate);
  return relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative);
}

export interface GeneratedCountBotArtifacts {
  externalProfile: Record<string, unknown>;
  channelUpdateRequest: Record<string, unknown>;
}

export function buildCountBotArtifacts(integration: CountBotIntegration): GeneratedCountBotArtifacts {
  const { profile, bot } = integration.config;
  const externalProfile: Record<string, unknown> = {
    name: profile.name,
    aliases: profile.aliases,
    type: "cli",
    icon_svg: "",
    enabled: true,
    description: profile.description,
    command: profile.command,
    args: profile.args,
    working_dir: integration.config.workspaceDir,
    inherit_env: profile.inheritEnv,
    session_mode: profile.sessionMode,
    history_message_count: profile.historyMessageCount,
    timeout: profile.timeoutSeconds
  };
  if (profile.stdinTemplate) externalProfile.stdin_template = profile.stdinTemplate;

  return {
    externalProfile,
    channelUpdateRequest: {
      channel: "feishu",
      config: {
        accounts: {
          [bot.accountId]: {
            enabled: true,
            display_name: bot.displayName,
            account_id: bot.accountId,
            app_id: `\${${bot.appIdEnv}}`,
            app_secret: `\${${bot.appSecretEnv}}`,
            allow_from: bot.allowFrom,
            routing_mode: "direct",
            external_coding_profile: profile.name
          }
        }
      }
    }
  };
}

export async function generateCountBotArtifacts(agentDir: string, outDir: string): Promise<GeneratedCountBotArtifacts> {
  const integration = await loadCountBotIntegration(agentDir);
  const artifacts = buildCountBotArtifacts(integration);
  const destination = path.resolve(outDir);
  await mkdir(destination, { recursive: true });
  await writeJson(path.join(destination, "external-profile.json"), artifacts.externalProfile);
  await writeJson(path.join(destination, "channel-update.request.json"), artifacts.channelUpdateRequest);
  await writeFile(path.join(destination, ".env.example"), envExample(integration.config), "utf8");
  await writeFile(path.join(destination, "deploy.mjs"), deploymentScript(integration.config), "utf8");
  await writeFile(path.join(destination, "README.md"), deploymentReadme(integration), "utf8");
  return artifacts;
}

export async function validateCountBotRuntime(config: CountBotAgentConfig): Promise<void> {
  await access(config.workspaceDir);
  if (path.isAbsolute(config.profile.command)) await access(config.profile.command);
}

async function writeJson(file: string, value: unknown): Promise<void> {
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function envExample(config: CountBotAgentConfig): string {
  return [
    "# CountBot HTTP URL. A localhost URL needs no token; remote deployment needs a valid session token.",
    "COUNTBOT_API_URL=http://127.0.0.1:8000",
    "COUNTBOT_API_TOKEN=",
    `COUNTBOT_WORKSPACE=${config.workspaceDir}`,
    `${config.bot.appIdEnv}=`,
    `${config.bot.appSecretEnv}=`,
    ""
  ].join("\n");
}

function deploymentScript(config: CountBotAgentConfig): string {
  return `#!/usr/bin/env node
import { access, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const directory = path.dirname(fileURLToPath(import.meta.url));
const apiUrl = required("COUNTBOT_API_URL").replace(/\\/$/, "");
const workspace = path.resolve(required("COUNTBOT_WORKSPACE"));
const expectedWorkspace = ${JSON.stringify(config.workspaceDir)};
if (workspace !== expectedWorkspace) throw new Error("COUNTBOT_WORKSPACE must match the Agent's declared workspaceDir");
await access(workspace);
const appId = required(${JSON.stringify(config.bot.appIdEnv)});
const appSecret = required(${JSON.stringify(config.bot.appSecretEnv)});
const profile = await readJson("external-profile.json");
const channelRequest = replacePlaceholders(await readJson("channel-update.request.json"), {
  ${JSON.stringify(config.bot.appIdEnv)}: appId,
  ${JSON.stringify(config.bot.appSecretEnv)}: appSecret
});

const profileFile = path.join(workspace, "external_coding_tools.json");
let current = { version: 1, profiles: [] };
try { current = JSON.parse(await readFile(profileFile, "utf8")); } catch (error) { if (error?.code !== "ENOENT") throw error; }
if (!Array.isArray(current.profiles)) throw new Error("CountBot external_coding_tools.json has no profiles array");
const index = current.profiles.findIndex((item) => item?.name === profile.name);
if (index >= 0) current.profiles[index] = profile; else current.profiles.push(profile);
const temporary = path.join(workspace, ".external_coding_tools.json.tmp");
await writeFile(temporary, JSON.stringify(current, null, 2) + "\\n", "utf8");
await rename(temporary, profileFile);

const headers = { "content-type": "application/json" };
if (process.env.COUNTBOT_API_TOKEN) headers.authorization = "Bearer " + process.env.COUNTBOT_API_TOKEN;
const response = await fetch(apiUrl + "/api/channels/update", { method: "POST", headers, body: JSON.stringify(channelRequest) });
const body = await response.json().catch(() => ({}));
if (!response.ok || body.success !== true) throw new Error(body.detail ?? body.message ?? "CountBot channel update failed: " + response.status);
console.log(JSON.stringify({ updatedProfile: profile.name, accountId: ${JSON.stringify(config.bot.accountId)}, routingMode: "direct" }, null, 2));

async function readJson(name) { return JSON.parse(await readFile(path.join(directory, name), "utf8")); }
function required(name) { const value = process.env[name]; if (!value) throw new Error("Missing required environment variable: " + name); return value; }
function replacePlaceholders(value, values) {
  if (typeof value === "string") return value.replace(/\\$\\{([A-Z][A-Z0-9_]*)\\}/g, (_, name) => values[name] ?? _);
  if (Array.isArray(value)) return value.map((item) => replacePlaceholders(item, values));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, replacePlaceholders(item, values)]));
  return value;
}
`;
}

function deploymentReadme(integration: CountBotIntegration): string {
  return `# CountBot 部署产物\n\n此目录仅接入已有的 CLI Agent：\`${integration.config.profile.name}\`。它会合并一个 CountBot 外部编程 Agent profile，并将飞书账号 \`${integration.config.bot.accountId}\` 设置为 \`routing_mode: direct\`。\n\n1. 先在 CountBot 服务器安装并认证 Agent CLI，确认工作空间为 \`${integration.config.workspaceDir}\`。\n2. 复制 \`.env.example\` 为 \`.env\` 并填写 App ID、Secret；远程 CountBot 还需填写有效 \`COUNTBOT_API_TOKEN\`。\n3. 加载环境变量并执行 \`node deploy.mjs\`。\n4. 在飞书开放平台启用 Bot、长连接、\`im.message.receive_v1\`，发布并审批后，在白名单用户所在群中发送 \`@${integration.config.bot.displayName} <任务>\`。\n\n脚本不会创建飞书应用、安装/认证 CLI、设置 CountBot 人设/模型/工具/团队/RAG，或开放未在 \`allow_from\` 中的用户。\n`;
}
