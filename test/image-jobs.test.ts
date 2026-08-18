import assert from "node:assert/strict";
import test from "node:test";
import { ImageJobRunner, InMemoryImageJobStore } from "../src/media/jobs.js";
import { FakeImageProvider } from "../src/media/image2.js";

test("runs a fake image job and deduplicates the same Feishu message", async () => {
  let succeeded = 0;
  const runner = new ImageJobRunner(new FakeImageProvider(), new InMemoryImageJobStore(), 0);
  const input = {
    idempotencyKey: "om_same",
    request: { prompt: "a red square" },
    source: { chatId: "oc_chat", messageId: "om_same", senderOpenId: "ou_user" }
  };
  const callbacks = { onSucceeded: async () => { succeeded += 1; }, onFailed: async () => assert.fail("job should succeed") };
  const first = runner.submit(input, callbacks);
  const second = runner.submit(input, callbacks);
  assert.equal(first.id, second.id);
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(succeeded, 1);
  assert.equal(first.status, "succeeded");
  assert.equal(first.images?.[0]?.mimeType, "image/png");
});

test("marks a missing image provider poll implementation as failed", async () => {
  let error = "";
  const runner = new ImageJobRunner({
    name: "pending-provider",
    generate: async () => ({ status: "pending" as const, operationId: "op_1" })
  }, new InMemoryImageJobStore(), 0);
  runner.submit({ idempotencyKey: "om_pending", request: { prompt: "x" }, source: { chatId: "oc", messageId: "om_pending", senderOpenId: "ou" } }, {
    onSucceeded: async () => assert.fail("job should fail"),
    onFailed: async (job) => { error = job.error ?? ""; }
  });
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.match(error, /without poll/);
});
