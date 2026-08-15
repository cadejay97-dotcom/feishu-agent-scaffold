import assert from "node:assert/strict";
import test from "node:test";
import {
  buildBotmuxSetupArgs,
  parseBotmuxBridgeConfig,
  renderBotmuxSetupCommand
} from "../src/integrations/botmux.js";

const createConfig = JSON.stringify({
  schemaVersion: 1,
  name: "codex-production",
  cliId: "codex",
  workspaceDir: "/srv/work/project",
  owners: ["owner@example.com"],
  allowedChatGroups: ["oc_team"],
  model: "gpt-5-codex",
  backend: "tmux",
  openPlatformAuto: true,
  app: { mode: "create", name: "Codex Agent", brand: "feishu" }
});

test("generates BotMux 3.13 scripted setup args for a new Feishu app", () => {
  const config = parseBotmuxBridgeConfig(createConfig);
  assert.deepEqual(buildBotmuxSetupArgs(config, {}), [
    "setup", "add",
    "--create-app", "--app-name", "Codex Agent",
    "--name", "codex-production",
    "--cli", "codex",
    "--backend", "tmux",
    "--default-working-dir", "/srv/work/project",
    "--allowed-users", "owner@example.com",
    "--brand", "feishu",
    "--model", "gpt-5-codex",
    "--allowed-chat-groups", "oc_team",
    "--open-platform-auto"
  ]);
});

test("existing-app configs resolve credentials only at execution time", () => {
  const config = parseBotmuxBridgeConfig(JSON.stringify({
    schemaVersion: 1,
    name: "claude-production",
    cliId: "claude-code",
    workspaceDir: "/srv/work/project",
    owners: ["on_owner"],
    app: {
      mode: "existing",
      appIdEnv: "FEISHU_EXISTING_APP_ID",
      appSecretEnv: "FEISHU_EXISTING_APP_SECRET",
      brand: "feishu"
    }
  }));

  const rendered = renderBotmuxSetupCommand(config);
  assert.match(rendered, /\$FEISHU_EXISTING_APP_ID/);
  assert.match(rendered, /\$FEISHU_EXISTING_APP_SECRET/);
  assert.throws(() => buildBotmuxSetupArgs(config, {}), /FEISHU_EXISTING_APP_ID/);
  const args = buildBotmuxSetupArgs(config, {
    FEISHU_EXISTING_APP_ID: "cli_test",
    FEISHU_EXISTING_APP_SECRET: "secret_test"
  });
  assert.ok(args.includes("cli_test"));
  assert.ok(args.includes("secret_test"));
  assert.doesNotMatch(rendered, /secret_test/);
});

test("rejects unsupported adapters and relative workspace paths", () => {
  assert.throws(() => parseBotmuxBridgeConfig(JSON.stringify({
    schemaVersion: 1,
    name: "invalid",
    cliId: "made-up-agent",
    workspaceDir: "./project",
    owners: ["owner@example.com"],
    app: { mode: "create", name: "Invalid", brand: "feishu" }
  })), /Invalid option|must be an absolute path/);
});
