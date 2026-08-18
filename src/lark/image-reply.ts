import type { GeneratedImage } from "../types.js";

export interface ImageReplyGateway {
  uploadMessageImage(image: GeneratedImage): Promise<string>;
  replyImage(messageId: string, imageKey: string): Promise<void>;
}

export async function replyGeneratedImages(gateway: ImageReplyGateway, messageId: string, images: GeneratedImage[]): Promise<void> {
  for (const image of images) {
    if (image.bytes.byteLength > 10 * 1024 * 1024) throw new Error("Generated image exceeds Feishu's 10 MB message-image limit");
    const imageKey = await gateway.uploadMessageImage(image);
    await gateway.replyImage(messageId, imageKey);
  }
}
