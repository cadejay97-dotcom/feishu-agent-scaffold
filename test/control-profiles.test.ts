import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { defaultAgentProfiles, maskAppId, readCliProfiles, readRegistry, writeRegistry } from "../src/control/profiles.js";

test("CLI profile summaries omit raw app and user identifiers", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "feishu-profile-test-"));
  const config = path.join(directory, "config.json");
  await writeFile(config, JSON.stringify({
    apps: [{
      name: "langbot-agent",
      appId: "cli_aabbccddeeff",
      appSecret: "must-not-leak",
      users: [{ userName: "Test User", userOpenId: "ou_sensitive" }]
    }]
  }));
  const [profile] = await readCliProfiles(config);
  assert.deepEqual(profile, {
    name: "langbot-agent",
    appIdSuffix: "cli_...eeff",
    brand: "feishu",
    language: "unknown",
    users: ["Test User"],
    classification: "agent"
  });
  assert.equal(maskAppId("abc"), "***");
});

test("registry starts with the LangBot profile and persists public deployment metadata", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "feishu-registry-test-"));
  const registryFile = path.join(directory, "profiles.json");
  const fallback = await readRegistry(registryFile, "/workspace/work/integrations/langbot");
  assert.equal(fallback.agents[0]?.id, "langbot-codex");
  assert.match(fallback.agents[0]?.sourceDir || "", /work\/production\/langbot-codex-agent$/);
  await writeRegistry(registryFile, { schemaVersion: 1, agents: defaultAgentProfiles("/workspace/work/integrations/langbot") });
  const saved = await readRegistry(registryFile, "/other");
  assert.deepEqual(saved.agents, defaultAgentProfiles("/workspace/work/integrations/langbot"));
});
