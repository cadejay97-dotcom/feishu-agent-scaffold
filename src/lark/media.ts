import { Client } from "@larksuiteoapi/node-sdk";
import type { GeneratedImage } from "../types.js";
import { replyGeneratedImages, type ImageReplyGateway } from "./image-reply.js";

export { replyGeneratedImages } from "./image-reply.js";
export type { ImageReplyGateway } from "./image-reply.js";

export function createLarkImageReplyGateway(appId: string, appSecret: string): ImageReplyGateway {
  const client = new Client({ appId, appSecret, source: "feishu-agent-scaffold" });
  return {
    async uploadMessageImage(image): Promise<string> {
      const response = await client.im.image.create({
        data: { image_type: "message", image: Buffer.from(image.bytes) }
      });
      if (!response?.image_key) throw new Error("Feishu image upload returned no image_key");
      return response.image_key;
    },
    async replyImage(messageId, imageKey): Promise<void> {
      const response = await client.im.message.reply({
        path: { message_id: messageId },
        data: { msg_type: "image", content: JSON.stringify({ image_key: imageKey }) }
      });
      if (response.code && response.code !== 0) throw new Error(`Feishu image reply failed (${response.code}): ${response.msg ?? "unknown error"}`);
    }
  };
}
