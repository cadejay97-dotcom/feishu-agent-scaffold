import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { buildCountBotArtifacts, generateCountBotArtifacts, loadCountBotIntegration } from "../src/integrations/countbot.js";

test("maps an existing Codex Agent to CountBot direct Feishu routing", async () => {
  const integration = await loadCountBotIntegration(path.resolve("examples/echo-agent"));
  const artifacts = buildCountBotArtifacts(integration);
  const account = ((artifacts.channelUpdateRequest.config as any).accounts["codex-production"]);
  assert.equal(artifacts.externalProfile.type, "cli");
  assert.equal(artifacts.externalProfile.name, "codex-production");
  assert.equal(account.routing_mode, "direct");
  assert.equal(account.external_coding_profile, "codex-production");
  assert.equal(account.app_id, "${FEISHU_APP_ID}");
  assert.deepEqual(artifacts.externalProfile.args, ["exec", "--skip-git-repo-check", "--cd", "{working_dir}", "-"]);
});

test("generates a secret-free CountBot deployment handoff", async () => {
  const out = await mkdtemp(path.join(os.tmpdir(), "countbot-artifacts-"));
  try {
    await generateCountBotArtifacts(path.resolve("examples/echo-agent"), out);
    const deploy = path.join(out, "deploy.mjs");
    const env = await readFile(path.join(out, ".env.example"), "utf8");
    const channel = JSON.parse(await readFile(path.join(out, "channel-update.request.json"), "utf8"));
    const checked = spawnSync(process.execPath, ["--check", deploy], { encoding: "utf8" });
    assert.equal(checked.status, 0, checked.stderr);
    assert.match(env, /COUNTBOT_API_URL=/);
    assert.doesNotMatch(env, /sk-|cli_/);
    assert.equal(channel.config.accounts["codex-production"].routing_mode, "direct");
  } finally {
    await rm(out, { recursive: true, force: true });
  }
});

test("rejects an absolute CLI path that merely shares the workspace prefix", async () => {
  const agent = await mkdtemp(path.join(os.tmpdir(), "countbot-boundary-agent-"));
  try {
    await writeFile(path.join(agent, "agent.manifest.json"), JSON.stringify({
      schemaVersion: 1,
      name: "Boundary Agent",
      description: "Tests the profile path boundary.",
      entry: "index.mjs",
      triggers: ["mention"]
    }), "utf8");
    await writeFile(path.join(agent, "countbot.agent.json"), JSON.stringify({
      schemaVersion: 1,
      workspaceDir: "/srv/work",
      profile: {
        name: "boundary-agent",
        command: "/srv/workshop/bin/agent",
        description: "Boundary test"
      },
      bot: {
        displayName: "Boundary Agent",
        allowFrom: ["ou_owner"]
      }
    }), "utf8");

    await assert.rejects(loadCountBotIntegration(agent), /must be inside workspaceDir/);
  } finally {
    await rm(agent, { recursive: true, force: true });
  }
});
