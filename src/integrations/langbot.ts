import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { readAgentManifest, type AgentManifest } from "../agent-loader.js";

const langBotAgentSchema = z.object({
  schemaVersion: z.literal(1),
  modelUuid: z.string().min(1),
  fallbackModelUuids: z.array(z.string().min(1)).default([]),
  systemPrompt: z.string().min(1),
  timeoutSeconds: z.number().int().positive().max(3600).default(300),
  maxRounds: z.number().int().positive().max(128).default(10),
  removeThink: z.boolean().default(false),
  bot: z.object({
    botName: z.string().min(1),
    domain: z.enum(["https://open.feishu.cn", "https://open.larksuite.com"]).default("https://open.feishu.cn"),
    streamReply: z.boolean().default(true)
  }).strict(),
  pipeline: z.object({
    name: z.string().min(1).optional(),
    description: z.string().min(1).optional()
  }).strict().default({})
}).strict();

export type LangBotAgentConfig = z.infer<typeof langBotAgentSchema>;

export interface LangBotIntegration {
  manifest: AgentManifest;
  config: LangBotAgentConfig;
  pipelineName: string;
  pipelineDescription: string;
}

export async function loadLangBotIntegration(agentDir: string): Promise<LangBotIntegration> {
  const root = path.resolve(agentDir);
  const manifest = await readAgentManifest(root);
  const raw = await readFile(path.join(root, "langbot.agent.json"), "utf8");
  const config = langBotAgentSchema.parse(JSON.parse(raw));
  return {
    manifest,
    config,
    pipelineName: config.pipeline.name ?? `${manifest.name} Pipeline`,
    pipelineDescription: config.pipeline.description ?? manifest.description
  };
}

export interface GeneratedLangBotArtifacts {
  botRequest: Record<string, unknown>;
  pipelineCreateRequest: Record<string, unknown>;
  pipelineConfig: Record<string, unknown>;
}

export function buildLangBotArtifacts(integration: LangBotIntegration): GeneratedLangBotArtifacts {
  const { config, manifest, pipelineName, pipelineDescription } = integration;
  const pipelineConfig = {
    trigger: {
      "group-respond-rules": {
        at: true,
        prefix: [],
        regexp: [],
        random: 0
      }
    },
    ai: {
      runner: {
        id: "local-agent",
        runner: "local-agent",
        "expire-time": 0
      },
      "local-agent": {
        timeout: config.timeoutSeconds,
        "max-round": config.maxRounds,
        model: {
          primary: config.modelUuid,
          fallbacks: config.fallbackModelUuids
        },
        prompt: [{ role: "system", content: config.systemPrompt }]
      }
    },
    output: {
      misc: {
        "remove-think": config.removeThink
      }
    }
  };

  return {
    pipelineCreateRequest: {
      name: pipelineName,
      description: pipelineDescription,
      emoji: "BOT"
    },
    pipelineConfig,
    botRequest: {
      name: manifest.name,
      description: manifest.description,
      adapter: "lark",
      adapter_config: {
        domain: config.bot.domain,
        app_id: "${FEISHU_APP_ID}",
        app_secret: "${FEISHU_APP_SECRET}",
        bot_name: config.bot.botName,
        "enable-webhook": false,
        "enable-stream-reply": config.bot.streamReply,
        app_type: "self"
      },
      enable: true,
      use_pipeline_uuid: "${PIPELINE_UUID}",
      pipeline_routing_rules: []
    }
  };
}

export async function generateLangBotArtifacts(agentDir: string, outDir: string): Promise<GeneratedLangBotArtifacts> {
  const integration = await loadLangBotIntegration(agentDir);
  const artifacts = buildLangBotArtifacts(integration);
  const destination = path.resolve(outDir);
  await mkdir(destination, { recursive: true });
  await writeJson(path.join(destination, "pipeline-create.request.json"), artifacts.pipelineCreateRequest);
  await writeJson(path.join(destination, "pipeline-config.patch.json"), artifacts.pipelineConfig);
  await writeJson(path.join(destination, "bot.request.json"), artifacts.botRequest);
  await writeFile(path.join(destination, ".env.example"), deploymentEnvExample(), "utf8");
  await writeFile(path.join(destination, "deploy.mjs"), deploymentScript(), "utf8");
  await writeFile(path.join(destination, "README.md"), deploymentReadme(integration), "utf8");
  return artifacts;
}

async function writeJson(file: string, value: unknown): Promise<void> {
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function deploymentEnvExample(): string {
  return [
    "# LangBot instance URL, without /api/v1.",
    "LANGBOT_API_URL=http://127.0.0.1:5300",
    "# A LangBot API key with RESOURCE_MANAGE permission. Never commit a real key.",
    "LANGBOT_API_KEY=",
    "# Credentials from the published Feishu/Lark app. Never commit real values.",
    "FEISHU_APP_ID=",
    "FEISHU_APP_SECRET=",
    ""
  ].join("\n");
}

function deploymentScript(): string {
  return `#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const directory = path.dirname(fileURLToPath(import.meta.url));
const apiUrl = required("LANGBOT_API_URL").replace(/\\/$/, "");
const apiKey = required("LANGBOT_API_KEY");
const appId = required("FEISHU_APP_ID");
const appSecret = required("FEISHU_APP_SECRET");
const pipelineCreate = await readJson("pipeline-create.request.json");
const pipelinePatch = await readJson("pipeline-config.patch.json");
const botTemplate = await readJson("bot.request.json");

const pipelines = await request("/api/v1/pipelines");
const existing = (pipelines.data?.pipelines ?? []).find((pipeline) => pipeline.name === pipelineCreate.name);
let pipelineId = existing?.uuid;
if (!pipelineId) {
  const created = await request("/api/v1/pipelines", { method: "POST", body: pipelineCreate });
  pipelineId = created.data?.uuid;
}
if (!pipelineId) throw new Error("LangBot did not return a pipeline UUID");

const current = await request(\`/api/v1/pipelines/\${encodeURIComponent(pipelineId)}\`);
const pipeline = current.data?.pipeline;
if (!pipeline) throw new Error("LangBot did not return the pipeline after creation");
await request(\`/api/v1/pipelines/\${encodeURIComponent(pipelineId)}\`, {
  method: "PUT",
  body: {
    name: pipelineCreate.name,
    description: pipelineCreate.description,
    emoji: pipelineCreate.emoji,
    config: merge(pipeline.config ?? {}, pipelinePatch)
  }
});

const bots = await request("/api/v1/platform/bots");
const botBody = replacePlaceholders(botTemplate, { PIPELINE_UUID: pipelineId, FEISHU_APP_ID: appId, FEISHU_APP_SECRET: appSecret });
const bot = (bots.data?.bots ?? []).find((item) => item.name === botBody.name);
if (bot?.uuid) {
  await request(\`/api/v1/platform/bots/\${encodeURIComponent(bot.uuid)}\`, { method: "PUT", body: botBody });
  console.log(JSON.stringify({ pipelineUuid: pipelineId, botUuid: bot.uuid, action: "updated" }, null, 2));
} else {
  const created = await request("/api/v1/platform/bots", { method: "POST", body: botBody });
  console.log(JSON.stringify({ pipelineUuid: pipelineId, botUuid: created.data?.uuid ?? null, action: "created" }, null, 2));
}

async function readJson(name) {
  return JSON.parse(await readFile(path.join(directory, name), "utf8"));
}

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(\`Missing required environment variable: \${name}\`);
  return value;
}

async function request(endpoint, options = {}) {
  const response = await fetch(\`\${apiUrl}\${endpoint}\`, {
    method: options.method ?? "GET",
    headers: { Authorization: \`Bearer \${apiKey}\`, "Content-Type": "application/json" },
    body: options.body === undefined ? undefined : JSON.stringify(options.body)
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok || (json.code !== undefined && json.code !== 0)) {
    throw new Error(json.msg ?? \`LangBot API request failed: \${response.status}\`);
  }
  return json;
}

function merge(base, patch) {
  if (Array.isArray(base) || Array.isArray(patch) || typeof base !== "object" || base === null || typeof patch !== "object" || patch === null) return patch;
  const result = { ...base };
  for (const [key, value] of Object.entries(patch)) result[key] = key in result ? merge(result[key], value) : value;
  return result;
}

function replacePlaceholders(value, replacements) {
  if (typeof value === "string") return value.replace(/\\$\\{([A-Z_]+)\\}/g, (_, name) => replacements[name] ?? _);
  if (Array.isArray(value)) return value.map((item) => replacePlaceholders(item, replacements));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, replacePlaceholders(item, replacements)]));
  return value;
}
`;
}

function deploymentReadme(integration: LangBotIntegration): string {
  return `# LangBot 部署产物\n\n此目录由 \`feishu-agent langbot generate\` 生成，面向 LangBot 当前的 \`lark\` 适配器与 \`local-agent\` runner。\n\n- Pipeline：${integration.pipelineName}\n- 飞书机器人显示名：${integration.config.bot.botName}\n- 模型 UUID：${integration.config.modelUuid}\n\n## 部署\n\n1. 启动一个已初始化的 LangBot 实例，并在其管理界面先创建模型；将该模型的 UUID 写入源 Agent 的 \`langbot.agent.json\`。\n2. 在本目录复制 \`.env.example\` 为 \`.env\`，填写 LangBot 管理 API Key 与飞书应用凭证。\n3. 载入环境变量后执行：\n\n\`set -a; source .env; set +a; node deploy.mjs\`\n\n脚本会按名称创建或更新 Pipeline，保留 Pipeline 中未由本产物管理的配置，并创建或更新 LangBot 的 Lark Bot。它不创建飞书应用、不申请权限、不发布应用。\n\n## 生产验证\n\n在飞书开放平台完成 Bot 能力、\`im.message.receive_v1\` 事件订阅、长连接和应用发布/审批后，将 Bot 加入目标群。在群内发送 \`@${integration.config.bot.botName} 请只回复 OK\`。\n\nLangBot 的默认 Pipeline 配置以 \`trigger.group-respond-rules.at: true\` 响应 @Bot；Lark 适配器将 \`bot_name\` 与飞书机器人名称匹配。\n`;
}
