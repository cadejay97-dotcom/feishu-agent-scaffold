import assert from "node:assert/strict";
import test from "node:test";
import { normalizeGitHubRepo, resolveAgentSubdir, validateGitRef } from "../src/agent-source.js";

test("accepts only credential-free HTTPS GitHub repository URLs", () => {
  assert.equal(normalizeGitHubRepo("https://github.com/example/agent"), "https://github.com/example/agent.git");
  assert.equal(normalizeGitHubRepo("https://github.com/example/agent.git"), "https://github.com/example/agent.git");
  assert.throws(() => normalizeGitHubRepo("git@github.com:example/agent.git"), /HTTPS/);
  assert.throws(() => normalizeGitHubRepo("https://token@github.com/example/agent"), /without credentials/);
  assert.throws(() => normalizeGitHubRepo("https://github.com/example/agent/tree/main"), /exactly one/);
});

test("rejects unsafe refs and Agent paths outside the checkout", () => {
  assert.equal(validateGitRef("refs/tags/v1.2.3"), "refs/tags/v1.2.3");
  assert.throws(() => validateGitRef("main; rm -rf /"), /without whitespace/);
  assert.throws(() => validateGitRef("../main"), /without whitespace/);
  assert.equal(resolveAgentSubdir("/tmp/agent", "packages/runtime"), "/tmp/agent/packages/runtime");
  assert.throws(() => resolveAgentSubdir("/tmp/agent", "../outside"), /stay inside/);
});
