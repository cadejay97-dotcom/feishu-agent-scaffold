# Image 2 V1 Boundary

## Outcome

An already adapted Agent folder can return a natural-language Image 2 request. The scaffold accepts that request from a Feishu direct message or a group `@Bot` message, runs it asynchronously, and replies to the originating message with uploaded Feishu images.

## Five-step review

1. **Question every requirement.** The product proof is one Agent to one Image 2 generation to one Feishu image reply. It is not a general media platform.
2. **Delete.** V1 excludes video, image-to-image, provider routing, a database, distributed workers, quotas, an approval UI, and a control plane.
3. **Simplify.** Keep one provider contract, one in-memory job runner, one image response shape, and the existing group/private-message ingress rules.
4. **Accelerate.** Use `FakeImageProvider` to exercise the Job and Feishu media path before a real Image 2 credential exists.
5. **Automate.** Cover request mapping, message idempotency, trigger policy, and image upload/reply orchestration with automated tests.

## Contract

An Agent may return:

```js
{
  text: "已收到生图请求，正在交给 Image 2 生成。",
  image: {
    prompt: "一座雨夜霓虹城市",
    size: "1024x1024",
    quality: "medium"
  }
}
```

`prompt` is passed to Image 2 unchanged. Prompt interpretation belongs to Image 2 and the pre-adapted Agent, not the scaffold.

## Provider boundary

`src/media/image2.ts` currently implements the smallest OpenAI Images-compatible shape. It is inactive without `IMAGE2_API_KEY` and `IMAGE2_BASE_URL`. A protocol change belongs in that adapter only.

`IMAGE_PROVIDER=fake` returns a fixed 1x1 PNG. It proves local Job handling and Feishu media calls only. It never proves a real model call, image quality, provider pricing, or production reliability.

## Delivery behavior

- Direct messages are handled only when the manifest includes `direct-message`.
- Group messages are handled only when the manifest includes `mention` and the Bot is mentioned.
- A Feishu `message_id` is the in-process idempotency key.
- Generated image bytes must be non-empty and no larger than 10 MB before a Feishu image upload is attempted.
- The V1 Job Store is in memory. A process restart loses unfinished Jobs.

## Real acceptance gate

Do not call this a live Image 2 integration until all are observed in a staging Feishu app:

1. A private message creates one provider request and receives one image reply.
2. A group message without `@Bot` does nothing; one with `@Bot` creates one request.
3. Re-delivery of one `message_id` does not cause a second provider request.
4. A provider error results in one readable Feishu error reply without exposing a secret.
5. The app has the required message receive, reply, and image upload permissions.
