#!/usr/bin/env node
import "dotenv/config";
import { spawn } from "node:child_process";
import { Command } from "commander";
import { loadAgent } from "./agent-loader.js";
import { startBot } from "./lark/bot.js";
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

program.parseAsync().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
