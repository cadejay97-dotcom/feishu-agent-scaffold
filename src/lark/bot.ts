import { createLarkChannel, type LarkChannel, type NormalizedMessage, type RawMessageEvent } from "@larksuiteoapi/node-sdk";
import { createHash } from "node:crypto";
import type { Agent } from "../types.js";
import type { AgentManifest } from "../agent-loader.js";

export interface BotOptions {
  appId: string;
  appSecret: string;
  agent: Agent;
  manifest: AgentManifest;
  logger?: Pick<Console, "debug" | "info" | "warn" | "error">;
}

export async function startBot(options: BotOptions): Promise<LarkChannel> {
  const logger = options.logger ?? console;
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
    // The Coding Agent authorization boundary is an Open ID allowlist. Keep
    // the source event so the original Open ID wins over SDK fallbacks.
    includeRawEvent: true
  });

  channel.on("message", async (message) => {
    const eligible = shouldHandle(message, options.manifest);
    const senderOpenId = resolveSenderOpenId(message);
    logger.info("Feishu message received", {
      chatType: message.chatType,
      mentionedBot: message.mentionedBot,
      eligible,
      senderIdSource: senderOpenId === message.senderId ? "normalized" : "raw-open-id",
      senderIdFingerprint: identifierFingerprint(senderOpenId)
    });
    if (!eligible) return;
    try {
      const result = await options.agent.handle({
        text: message.content.trim(),
        chatId: message.chatId,
        messageId: message.messageId,
        senderOpenId,
        mentionsBot: message.mentionedBot
      });
      if (result.text.trim()) await channel.send(message.chatId, { text: result.text.trim() }, { replyTo: message.messageId });
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

function shouldHandle(message: NormalizedMessage, manifest: AgentManifest): boolean {
  if (message.chatType === "group") return manifest.triggers.includes("mention") && message.mentionedBot;
  return manifest.triggers.includes("direct-message");
}

export function resolveSenderOpenId(message: NormalizedMessage): string {
  const raw = message.raw as RawMessageEvent | undefined;
  return raw?.sender?.sender_id?.open_id || message.senderId;
}

function identifierFingerprint(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 12);
}
