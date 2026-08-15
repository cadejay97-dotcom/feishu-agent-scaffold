import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { buildLangBotArtifacts, generateLangBotArtifacts, loadLangBotIntegration } from "../src/integrations/langbot.js";

const agentDir = path.resolve("examples/echo-agent");

test("maps a declared Agent to LangBot's Lark and local-agent configuration", async () => {
  const integration = await loadLangBotIntegration(agentDir);
  const artifacts = buildLangBotArtifacts(integration);
  const localAgent = (artifacts.pipelineConfig.ai as Record<string, unknown>)["local-agent"] as Record<string, unknown>;
  const bot = artifacts.botRequest.adapter_config as Record<string, unknown>;

  assert.equal(integration.pipelineName, "Echo Agent Pipeline");
  assert.equal(localAgent.timeout, 300);
  assert.deepEqual(localAgent.model, { primary: "replace-with-a-langbot-model-uuid", fallbacks: [] });
  assert.deepEqual(localAgent.prompt, [{ role: "system", content: "你是一个简洁、准确的飞书工作助手。直接回答用户问题；不需要解释你的内部实现。" }]);
  assert.equal(bot.domain, "https://open.feishu.cn");
  assert.equal(bot["enable-webhook"], false);
  assert.equal(bot["enable-stream-reply"], true);
});

test("generates reviewable, syntax-valid deployment artifacts without secrets", async () => {
  const out = await mkdtemp(path.join(os.tmpdir(), "langbot-artifacts-"));
  try {
    await generateLangBotArtifacts(agentDir, out);
    const deploy = path.join(out, "deploy.mjs");
    const deploymentReadme = await readFile(path.join(out, "README.md"), "utf8");
    const env = await readFile(path.join(out, ".env.example"), "utf8");
    const pipelineConfig = JSON.parse(await readFile(path.join(out, "pipeline-config.patch.json"), "utf8"));
    const checked = spawnSync(process.execPath, ["--check", deploy], { encoding: "utf8" });

    assert.equal(checked.status, 0, checked.stderr);
    assert.match(deploymentReadme, /@Echo Agent/);
    assert.match(env, /LANGBOT_API_KEY=/);
    assert.doesNotMatch(env, /sk-|cli_/);
    assert.equal(pipelineConfig.trigger["group-respond-rules"].at, true);
  } finally {
    await rm(out, { recursive: true, force: true });
  }
});
