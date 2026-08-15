import assert from "node:assert/strict";
import test from "node:test";
import { ModelRegistry } from "../src/model/registry.js";

test("uses an OpenAI-compatible endpoint and returns normalized text", async () => {
  const originalFetch = globalThis.fetch;
  let request: { url: string; init?: RequestInit } | undefined;
  globalThis.fetch = async (url, init) => {
    request = { url: String(url), init };
    return new Response(JSON.stringify({ choices: [{ message: { content: "ok" } }], usage: { prompt_tokens: 2, completion_tokens: 1 } }), { status: 200 });
  };
  try {
    const registry = new ModelRegistry({
      defaultModel: "test",
      models: { test: { provider: "openai-compatible", model: "test-model", baseUrl: "https://example.test/v1", apiKeyEnv: "TEST_KEY" } }
    }, { TEST_KEY: "secret" });
    const result = await registry.chat({ messages: [{ role: "user", content: "hello" }] });
    assert.equal(result.text, "ok");
    assert.equal(result.model, "test-model");
    assert.equal(request?.url, "https://example.test/v1/chat/completions");
    assert.match(String(request?.init?.body), /test-model/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("uses the Anthropic Messages endpoint and separates system messages", async () => {
  const originalFetch = globalThis.fetch;
  let request: { url: string; init?: RequestInit } | undefined;
  globalThis.fetch = async (url, init) => {
    request = { url: String(url), init };
    return new Response(JSON.stringify({ content: [{ type: "text", text: "anthropic ok" }], usage: { input_tokens: 3, output_tokens: 2 } }), { status: 200 });
  };
  try {
    const registry = new ModelRegistry({
      defaultModel: "claude",
      models: { claude: { provider: "anthropic", model: "claude-test", baseUrl: "https://anthropic.test", apiKeyEnv: "ANTHROPIC_KEY" } }
    }, { ANTHROPIC_KEY: "secret" });
    const result = await registry.chat({ messages: [{ role: "system", content: "rules" }, { role: "user", content: "hello" }] });
    assert.equal(result.text, "anthropic ok");
    assert.equal(request?.url, "https://anthropic.test/v1/messages");
    assert.match(String(request?.init?.body), /\"system\":\"rules\"/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
