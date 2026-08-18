import assert from "node:assert/strict";
import test from "node:test";
import { shouldHandle } from "../src/lark/policy.js";

const manifest = {
  schemaVersion: 1 as const,
  name: "image2",
  description: "test",
  entry: "index.mjs",
  triggers: ["mention", "direct-message"] as Array<"mention" | "direct-message">
};

test("handles only mentions in groups and all direct messages when enabled", () => {
  const groupMention = { chatType: "group", mentionedBot: true } as any;
  const groupWithoutMention = { chatType: "group", mentionedBot: false } as any;
  const direct = { chatType: "p2p", mentionedBot: false } as any;
  assert.equal(shouldHandle(groupMention, manifest), true);
  assert.equal(shouldHandle(groupWithoutMention, manifest), false);
  assert.equal(shouldHandle(direct, manifest), true);
});
