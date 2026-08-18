import { createLarkChannel, type LarkChannel, type NormalizedMessage, type RawMessageEvent } from "@larksuiteoapi/node-sdk";
import { createHash } from "node:crypto";
import type { Agent } from "../types.js";
import type { AgentManifest } from "../agent-loader.js";
import { ImageJobRunner } from "../media/jobs.js";
import type { ImageProvider } from "../media/types.js";
import { createLarkImageReplyGateway, replyGeneratedImages } from "./media.js";
import { shouldHandle } from "./policy.js";
export { shouldHandle } from "./policy.js";

export interface BotOptions {
  appId: string;
  appSecret: string;
  agent: Agent;
  manifest: AgentManifest;
  imageProvider?: ImageProvider;
  imageJobRunner?: ImageJobRunner;
  logger?: Pick<Console, "debug" | "info" | "warn" | "error">;
}

export async function startBot(options: BotOptions): Promise<LarkChannel> {
  const logger = options.logger ?? console;
  const imageJobRunner = options.imageJobRunner ?? (options.imageProvider ? new ImageJobRunner(options.imageProvider) : undefined);
  const imageGateway = imageJobRunner ? createLarkImageReplyGateway(options.appId, options.appSecret) : undefined;
  const channel = createLarkChannel({
    appId: options.appId,
    appSecret: options.appSecret,
    transport: "websocket",
    source: "feishu-agent-scaffold",
    policy: {
      requireMention: false,
      dmMode: options.manifest.triggers.includes("direct-message") ? "open" : "disabled"
    },
    safety: { chatQueue: { enabled: true } },
    outbound: { textChunkLimit: 4000 },
    // The Coding Agent authorization boundary needs the raw Open ID and
    // tenant-stable union ID, rather than SDK fallbacks alone.
    includeRawEvent: true
  });

  channel.on("message", async (message) => {
    const eligible = shouldHandle(message, options.manifest);
    const sender = resolveSenderIdentity(message);
    logger.info("Feishu message received", {
      chatType: message.chatType,
      mentionedBot: message.mentionedBot,
      eligible,
      senderIdSource: sender.openId === message.senderId ? "normalized" : "raw-open-id",
      senderOpenIdFingerprint: identifierFingerprint(sender.openId),
      senderUnionIdFingerprint: sender.unionId ? identifierFingerprint(sender.unionId) : null
    });
    if (!eligible) return;
    try {
      const result = await options.agent.handle({
        text: stripBotMentions(message),
        chatId: message.chatId,
        messageId: message.messageId,
        senderOpenId: sender.openId,
        senderUnionId: sender.unionId,
        mentionsBot: message.mentionedBot
      });
      if (result.text?.trim()) await channel.send(message.chatId, { text: result.text.trim() }, { replyTo: message.messageId });
      if (result.image) {
        if (!imageJobRunner || !imageGateway) throw new Error("This Bot was not configured with an image provider");
        if (!result.image.prompt.trim()) throw new Error("Image request prompt cannot be empty");
        const job = imageJobRunner.submit({
          idempotencyKey: message.messageId,
          request: result.image,
          source: { chatId: message.chatId, messageId: message.messageId, senderOpenId: sender.openId }
        }, {
          onSucceeded: async (completed) => {
            await replyGeneratedImages(imageGateway, completed.source.messageId, completed.images ?? []);
          },
          onFailed: async (failed) => {
            await channel.send(message.chatId, { text: `生图失败：${failed.error ?? "未知错误"}` }, { replyTo: message.messageId });
          }
        });
        if (!result.text?.trim() && job.status === "queued") {
          await channel.send(message.chatId, { text: "已收到生图请求，正在生成。" }, { replyTo: message.messageId });
        }
      }
      logger.info("Feishu message handled", { chatType: message.chatType });
    } catch (error) {
      logger.error("Agent message handling failed", error);
      await channel.send(message.chatId, { text: "处理这条消息时发生了错误，请稍后重试。" }, { replyTo: message.messageId });
    }
  });
  channel.on("error", (error) => logger.error("Feishu channel error", error));
  await channel.connect();
  logger.info(`Feishu bot connected for Agent: ${options.manifest.name}`);
  return channel;
}

export function resolveSenderOpenId(message: NormalizedMessage): string {
  return resolveSenderIdentity(message).openId;
}

export function resolveSenderIdentity(message: NormalizedMessage): { openId: string; unionId?: string } {
  const raw = message.raw as RawMessageEvent | undefined;
  return {
    openId: raw?.sender?.sender_id?.open_id || message.senderId,
    unionId: raw?.sender?.sender_id?.union_id || undefined
  };
}

export function stripBotMentions(message: NormalizedMessage): string {
  const names = message.mentions
    .filter((mention) => mention.isBot && mention.name)
    .map((mention) => mention.name!);
  return names.reduce((content, name) => content.replaceAll(`@${name}`, ""), message.content).trim();
}

function identifierFingerprint(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 12);
}
