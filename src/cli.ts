#!/usr/bin/env node
import "dotenv/config";
import { spawn } from "node:child_process";
import { Command } from "commander";
import { loadAgent } from "./agent-loader.js";
import { startBot } from "./lark/bot.js";
import {
  BOTMUX_UPSTREAM_VERSION,
  readBotmuxBridgeConfig,
  renderBotmuxSetupCommand,
  runBotmuxSetup,
  validateBotmuxRuntime
} from "./integrations/botmux.js";
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

const botmux = program.command("botmux")
  .description("Bridge an existing local coding CLI to Feishu through BotMux");

botmux.command("validate")
  .description("Validate a secret-free BotMux bridge config")
  .requiredOption("--config <path>", "BotMux bridge JSON path")
  .action(async ({ config }) => {
    const parsed = await readBotmuxBridgeConfig(config);
    console.log(JSON.stringify({
      valid: true,
      testedBotmuxVersion: BOTMUX_UPSTREAM_VERSION,
      name: parsed.name,
      cliId: parsed.cliId,
      workspaceDir: parsed.workspaceDir,
      appMode: parsed.app.mode
    }, null, 2));
  });

botmux.command("command")
  .description("Print the upstream botmux setup command without executing it")
  .requiredOption("--config <path>", "BotMux bridge JSON path")
  .action(async ({ config }) => {
    console.log(renderBotmuxSetupCommand(await readBotmuxBridgeConfig(config)));
  });

botmux.command("deploy")
  .description("Validate local prerequisites, then run upstream botmux setup add")
  .requiredOption("--config <path>", "BotMux bridge JSON path")
  .action(async ({ config }) => {
    const parsed = await readBotmuxBridgeConfig(config);
    await validateBotmuxRuntime(parsed);
    await runBotmuxSetup(parsed);
    console.log("BotMux setup completed. Run `botmux start` (or `botmux restart`) and verify @Bot in an authorized Feishu chat.");
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
