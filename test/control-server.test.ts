import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { normalizeAllowedOrigins, startControlServer } from "../src/control/server.js";

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

    const blocked = await fetch(`${server.url}/api/state`, { headers: { Origin: "https://attacker.example.com" } });
    assert.equal(blocked.status, 403);
  } finally {
    await server.close();
  }
});
