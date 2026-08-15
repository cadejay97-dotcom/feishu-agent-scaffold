import assert from "node:assert/strict";
import test from "node:test";
import type { NormalizedMessage, RawMessageEvent } from "@larksuiteoapi/node-sdk";
import { resolveSenderIdentity, resolveSenderOpenId } from "../src/lark/bot.js";

test("uses the raw Feishu open_id for the Coding Agent authorization boundary", () => {
  const message = normalizedMessage("sdk-fallback-id", {
    sender: { sender_id: { open_id: "ou_authorized" } }
  });
  assert.equal(resolveSenderOpenId(message), "ou_authorized");
});

test("falls back to the normalized sender ID when the raw open_id is unavailable", () => {
  assert.equal(resolveSenderOpenId(normalizedMessage("ou_normalized")), "ou_normalized");
});

test("retains the tenant-stable union_id from the raw Feishu event", () => {
  const identity = resolveSenderIdentity(normalizedMessage("ou_application", {
    sender: { sender_id: { open_id: "ou_application", union_id: "on_tenant_user" } }
  }));
  assert.deepEqual(identity, { openId: "ou_application", unionId: "on_tenant_user" });
});

function normalizedMessage(senderId: string, raw?: Partial<RawMessageEvent>): NormalizedMessage {
  return {
    messageId: "om_test",
    chatId: "oc_test",
    chatType: "group",
    senderId,
    content: "/history search test",
    rawContentType: "text",
    resources: [],
    mentions: [],
    mentionAll: false,
    mentionedBot: true,
    createTime: 0,
    raw
  };
}
