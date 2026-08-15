import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import { loadAgent } from "../src/agent-loader.js";

test("loads the documented Agent contract and supplies its default model", async () => {
  let selectedModel: string | undefined;
  const agentDir = path.resolve("examples/echo-agent");
  const { agent, manifest } = await loadAgent(agentDir, {
    agentRoot: "",
    logger: console,
    llm: { chat: async (request) => {
      selectedModel = request.model;
      return { text: "answer", model: request.model ?? "unknown", provider: "test" };
    } }
  });
  const result = await agent.handle({ text: "hi", chatId: "oc_test", messageId: "om_test", senderOpenId: "ou_test", mentionsBot: true });
  assert.equal(manifest.name, "Echo Agent");
  assert.equal(selectedModel, "deepseek-chat");
  assert.equal(result.text, "answer");
});
