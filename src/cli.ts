#!/usr/bin/env node
import "dotenv/config";
import { spawn } from "node:child_process";
import { Command } from "commander";
import { loadAgent } from "./agent-loader.js";
import { fetchGitHubAgentSource } from "./agent-source.js";
import { createCodingAgent } from "./codex/agent.js";
import { CodexAppServerClient } from "./codex/app-server.js";
import { CodexHistoryMap, defaultHistoryMapPath, displayHistoryMapEntry } from "./codex/history-map.js";
import { startBot } from "./lark/bot.js";
import { startControlServer } from "./control/server.js";
import { generateLangBotArtifacts, loadLangBotIntegration } from "./integrations/langbot.js";
import { readModelFile } from "./model/config.js";
import { ModelRegistry } from "./model/registry.js";

const program = new Command();
program.name("feishu-agent").description("Deploy a pre-adapted local Agent as a Feishu bot").version("0.1.0");

program.command("run")
  .description("Run the Feishu WebSocket bot")
  .option("--agent-dir <path>", "Agent directory", process.env.AGENT_DIR)
  .option("--models <path>", "models.yaml path", "models.yaml")
  .action(async ({ agentDir, models }) => {
    const appId = requiredEnv("FEISHU_APP_ID");
    const appSecret = requiredEnv("FEISHU_APP_SECRET");
    if (!agentDir) throw new Error("Set AGENT_DIR or pass --agent-dir");
    const llm = new ModelRegistry(await readModelFile(models));
    const { agent, manifest } = await loadAgent(agentDir, { llm, logger: console, agentRoot: "" });
    await startBot({ appId, appSecret, agent, manifest, logger: console });
  });

program.command("bootstrap")
  .description("Create a new Feishu Open Platform app through lark-cli and register a slash command")
  .requiredOption("--profile <name>", "new isolated lark-cli profile name")
  .option("--slash-command <name>", "slash command name without /", "agent")
  .option("--slash-description <text>", "description displayed in Feishu", "向此 Agent 提问")
  .action(async ({ profile, slashCommand, slashDescription }) => {
    await runLarkCli(["config", "init", "--new", "--name", profile, "--brand", "feishu", "--lang", "zh_cn"]);
    await runLarkCli(["--profile", profile, "application", "+slash-command-create", "--command", slashCommand, "--description", slashDescription, "--as", "bot", "--force"]);
    console.log("Bootstrap completed. Copy the new App ID and App Secret to .env, then configure Bot capability and event permissions in the Feishu developer console before running the service.");
  });

program.command("validate-agent")
  .description("Load an Agent module and check its scaffold contract")
  .requiredOption("--agent-dir <path>", "Agent directory")
  .option("--models <path>", "models.yaml path", "models.yaml")
  .action(async ({ agentDir, models }) => {
    const llm = new ModelRegistry(await readModelFile(models));
    const { manifest } = await loadAgent(agentDir, { llm, logger: console, agentRoot: "" });
    console.log(JSON.stringify({ valid: true, name: manifest.name, triggers: manifest.triggers, defaultModel: manifest.defaultModel ?? null }, null, 2));
  });

program.command("fetch-agent")
  .description("Fetch a pinned GitHub Agent repository without installing or executing it")
  .requiredOption("--repo <https-url>", "HTTPS github.com owner/repository URL")
  .requiredOption("--ref <git-ref>", "required branch, tag, or commit-like ref")
  .requiredOption("--out <path>", "new destination directory; existing paths are refused")
  .option("--agent-subdir <path>", "Agent directory inside the repository", ".")
  .action(async ({ repo, ref, out, agentSubdir }) => {
    console.log(JSON.stringify(await fetchGitHubAgentSource({ repo, ref, out, agentSubdir }), null, 2));
  });

const langbot = program.command("langbot").description("Generate LangBot Lark + local-agent deployment artifacts");

langbot.command("validate")
  .description("Validate a LangBot-native declarative Agent configuration")
  .requiredOption("--agent-dir <path>", "Agent directory containing langbot.agent.json")
  .action(async ({ agentDir }) => {
    const integration = await loadLangBotIntegration(agentDir);
    console.log(JSON.stringify({
      valid: true,
      agent: integration.manifest.name,
      pipeline: integration.pipelineName,
      modelUuid: integration.config.modelUuid,
      botName: integration.config.bot.botName
    }, null, 2));
  });

langbot.command("generate")
  .description("Generate a reviewable LangBot deployment directory without contacting LangBot or Feishu")
  .requiredOption("--agent-dir <path>", "Agent directory containing langbot.agent.json")
  .requiredOption("--out <path>", "output directory for LangBot artifacts")
  .action(async ({ agentDir, out }) => {
    const integration = await loadLangBotIntegration(agentDir);
    await generateLangBotArtifacts(agentDir, out);
    console.log(JSON.stringify({
      generated: true,
      out,
      agent: integration.manifest.name,
      pipeline: integration.pipelineName,
      next: "Review the generated files, then run node deploy.mjs with LANGBOT_API_URL, LANGBOT_API_KEY, FEISHU_APP_ID, and FEISHU_APP_SECRET."
    }, null, 2));
  });

const codex = program.command("codex").description("Connect an explicitly authorized local Codex Coding Agent to Feishu");

program.command("control")
  .description("Start the local Feishu profile control console")
  .option("--port <port>", "local HTTP port", parsePort, 4318)
  .option("--registry <path>", "local profile registry path")
  .action(async ({ port, registry }) => {
    const server = await startControlServer({ port, registryFile: registry });
    console.log(`Feishu Profile Control is running at ${server.url}`);
  });

codex.command("run")
  .description("Run the Feishu Coding Agent backed by local codex app-server")
  .option("--allowed-root <path>", "local workspace root the bot may use (repeatable)", collectOption, [])
  .option("--allow-open-id <id>", "Feishu open_id authorized to access local history (repeatable)", collectOption, [])
  .option("--allow-union-id <id>", "Feishu tenant-stable union_id authorized to access local history (repeatable)", collectOption, [])
  .option("--history-map <path>", "local history map path", process.env.CODEX_HISTORY_MAP || defaultHistoryMapPath())
  .action(async ({ allowedRoot, allowOpenId, allowUnionId, historyMap }) => {
    const appId = requiredEnv("FEISHU_APP_ID");
    const appSecret = requiredEnv("FEISHU_APP_SECRET");
    const roots = [...allowedRoot, ...splitEnvironmentList(process.env.CODEX_AGENT_ALLOWED_ROOTS)];
    const openIds = [...allowOpenId, ...splitEnvironmentList(process.env.CODEX_AGENT_ALLOWED_OPEN_IDS)];
    const unionIds = [...allowUnionId, ...splitEnvironmentList(process.env.CODEX_AGENT_ALLOWED_UNION_IDS)];
    const client = new CodexAppServerClient();
    const agent = createCodingAgent({ client, historyMap: new CodexHistoryMap(client, historyMap), allowedRoots: roots, allowedOpenIds: openIds, allowedUnionIds: unionIds, logger: console });
    await startBot({
      appId,
      appSecret,
      agent,
      manifest: {
        schemaVersion: 1,
        name: "Local Codex",
        description: "An explicitly authorized local Coding Agent.",
        entry: "built-in:codex",
        triggers: ["mention", "direct-message"]
      },
      logger: console
    });
  });

const codexMap = codex.command("map").description("Build and query the local Codex conversation map");

codexMap.command("sync")
  .description("Incrementally index local Codex conversations")
  .option("--history-map <path>", "local history map path", process.env.CODEX_HISTORY_MAP || defaultHistoryMapPath())
  .option("--limit <count>", "maximum number of conversations to examine", parsePositiveInteger)
  .action(async ({ historyMap, limit }) => {
    const client = new CodexAppServerClient();
    try {
      console.log(JSON.stringify(await new CodexHistoryMap(client, historyMap).sync(limit), null, 2));
    } finally {
      await client.close();
    }
  });

codexMap.command("search")
  .description("Search the locally indexed conversation map")
  .argument("<query>", "keywords")
  .option("--history-map <path>", "local history map path", process.env.CODEX_HISTORY_MAP || defaultHistoryMapPath())
  .option("--limit <count>", "maximum results", parsePositiveInteger, 10)
  .action(async (query, { historyMap, limit }) => {
    const client = new CodexAppServerClient();
    try {
      const entries = await new CodexHistoryMap(client, historyMap).search(query, limit);
      console.log(JSON.stringify(entries.map(displayHistoryMapEntry), null, 2));
    } finally {
      await client.close();
    }
  });

codexMap.command("show")
  .description("Show one mapped conversation and its recovery metadata")
  .argument("<thread-id>", "Codex thread ID")
  .option("--history-map <path>", "local history map path", process.env.CODEX_HISTORY_MAP || defaultHistoryMapPath())
  .action(async (threadId, { historyMap }) => {
    const client = new CodexAppServerClient();
    try {
      const entry = await new CodexHistoryMap(client, historyMap).get(threadId);
      if (!entry) throw new Error("Conversation is not in the local map. Run codex map sync first.");
      console.log(JSON.stringify(displayHistoryMapEntry(entry), null, 2));
    } finally {
      await client.close();
    }
  });

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function runLarkCli(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn("lark-cli", args, { stdio: "inherit" });
    child.on("error", reject);
    child.on("exit", (code) => code === 0 ? resolve() : reject(new Error(`lark-cli ${args.join(" ")} exited with ${code}`)));
  });
}

function collectOption(value: string, previous: string[]): string[] {
  return [...previous, value];
}

function splitEnvironmentList(value: string | undefined): string[] {
  return value ? value.split(/[,:\n]/).map((item) => item.trim()).filter(Boolean) : [];
}

function parsePositiveInteger(value: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new Error("Expected a positive integer");
  return parsed;
}

function parsePort(value: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > 65535) throw new Error("Expected a valid TCP port");
  return parsed;
}

program.parseAsync().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
