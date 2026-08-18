import type { AgentManifest } from "../agent-loader.js";

export interface RoutableMessage {
  chatType: string;
  mentionedBot: boolean;
}

export function shouldHandle(message: RoutableMessage, manifest: AgentManifest): boolean {
  if (message.chatType === "group") return manifest.triggers.includes("mention") && message.mentionedBot;
  return manifest.triggers.includes("direct-message");
}
