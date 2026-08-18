import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { normalizeAllowedOrigins, startControlServer } from "../src/control/server.js";
import { ProfileControl } from "../src/control/server.js";
import { writeRegistry } from "../src/control/profiles.js";

test("hosted UI access requires an exact HTTPS origin", async () => {
  assert.deepEqual([...normalizeAllowedOrigins(["https://profiles.example.com/path"])], ["https://profiles.example.com"]);
  assert.throws(() => normalizeAllowedOrigins(["http://profiles.example.com"]), /must use HTTPS/);

  const directory = await mkdtemp(path.join(tmpdir(), "feishu-control-cors-"));
  const cliConfigFile = path.join(directory, "lark-config.json");
  await writeFile(cliConfigFile, JSON.stringify({ apps: [] }));
  const server = await startControlServer({
    port: 0,
    projectRoot: process.cwd(),
    registryFile: path.join(directory, "profiles.json"),
    cliConfigFile,
    allowedOrigins: ["https://profiles.example.com"]
  });
  try {
    const allowed = await fetch(`${server.url}/api/state`, { headers: { Origin: "https://profiles.example.com" } });
    assert.equal(allowed.status, 200);
    assert.equal(allowed.headers.get("access-control-allow-origin"), "https://profiles.example.com");
    const state = await allowed.json() as { cliProfiles: unknown[] };
    assert.deepEqual(state.cliProfiles, []);

    const invalidBinding = await fetch(`${server.url}/api/agents/langbot-codex`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "LangBot Codex Agent",
        cliProfile: "missing-profile",
        runtime: "langbot",
        sourceDir: directory,
        artifactDir: directory,
        deployDir: directory,
        enabled: true
      })
    });
    assert.equal(invalidBinding.status, 400);

    const blocked = await fetch(`${server.url}/api/state`, { headers: { Origin: "https://attacker.example.com" } });
    assert.equal(blocked.status, 403);
  } finally {
    await server.close();
  }
});

test("concurrent profile actions preserve every audit record", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "feishu-control-audit-"));
  const cliConfigFile = path.join(directory, "lark-config.json");
  const registryFile = path.join(directory, "profiles.json");
  await writeFile(cliConfigFile, JSON.stringify({ apps: [{ name: "test-profile", appId: "cli_test", users: [] }] }));
  await writeFile(path.join(directory, "agent.manifest.json"), "{}\n");
  await writeRegistry(registryFile, {
    schemaVersion: 1,
    agents: [{
      id: "concurrent-agent",
      name: "Concurrent Agent",
      cliProfile: "test-profile",
      runtime: "codex",
      sourceDir: directory,
      artifactDir: directory,
      deployDir: directory,
      enabled: true
    }]
  });
  const control = new ProfileControl(directory, registryFile, cliConfigFile);
  await Promise.all(Array.from({ length: 4 }, () => control.action("concurrent-agent", { action: "preflight" })));
  const state = await control.state() as { audit: Array<{ status: string }> };
  assert.equal(state.audit.length, 4);
  assert.ok(state.audit.every((entry) => entry.status === "success"));
});
