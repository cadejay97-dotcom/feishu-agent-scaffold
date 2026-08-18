import assert from "node:assert/strict";
import test from "node:test";
import { replyGeneratedImages } from "../src/lark/image-reply.js";

test("uploads each generated image and replies with its Feishu image key", async () => {
  const calls: string[] = [];
  await replyGeneratedImages({
    uploadMessageImage: async (image) => { calls.push(`upload:${image.filename}`); return "img_key"; },
    replyImage: async (messageId, imageKey) => { calls.push(`reply:${messageId}:${imageKey}`); }
  }, "om_reply", [{ bytes: Buffer.from([1]), mimeType: "image/png", filename: "result.png" }]);
  assert.deepEqual(calls, ["upload:result.png", "reply:om_reply:img_key"]);
});
