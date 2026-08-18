import assert from "node:assert/strict";
import test from "node:test";
import { Image2Provider } from "../src/media/image2.js";

test("maps an Image 2 Images-compatible response to a generated image", async () => {
  let request: RequestInit | undefined;
  const provider = new Image2Provider({
    apiKey: "secret",
    baseUrl: "https://image2.example/v1",
    fetch: async (_url, init) => {
      request = init;
      return new Response(JSON.stringify({ data: [{ b64_json: "aGVsbG8=" }] }), { status: 200 });
    }
  });
  const result = await provider.generate({ prompt: "a quiet lake" });
  assert.equal(result.status, "succeeded");
  if (result.status !== "succeeded") return;
  assert.equal(Buffer.from(result.images[0].bytes).toString(), "hello");
  assert.match(String(request?.body), /a quiet lake/);
  assert.match(String(request?.body), /gpt-image-2/);
});
