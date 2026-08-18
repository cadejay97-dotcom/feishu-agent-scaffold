export type ChatRole = "system" | "user" | "assistant";

export interface ChatMessage {
  role: ChatRole;
  content: string;
}

export interface ChatRequest {
  messages: ChatMessage[];
  model?: string;
  temperature?: number;
  maxTokens?: number;
}

export interface ChatResult {
  text: string;
  model: string;
  provider: string;
  usage?: { inputTokens?: number; outputTokens?: number };
}

export interface Llm {
  chat(request: ChatRequest): Promise<ChatResult>;
}

export interface AgentInput {
  text: string;
  chatId: string;
  messageId: string;
  senderOpenId: string;
  senderUnionId?: string;
  mentionsBot: boolean;
}

export type ImageMimeType = "image/png" | "image/jpeg" | "image/webp" | "image/gif";

/** A provider-neutral request. The image model receives the natural-language prompt directly. */
export interface ImageGenerationRequest {
  prompt: string;
  size?: "1024x1024" | "1536x1024" | "1024x1536";
  quality?: "low" | "medium" | "high";
}

export interface GeneratedImage {
  bytes: Uint8Array;
  mimeType: ImageMimeType;
  filename?: string;
}

/**
 * A text result keeps existing Agents compatible. An image request delegates
 * generation and Feishu media delivery to the scaffold runtime.
 */
export interface AgentResult {
  text?: string;
  image?: ImageGenerationRequest;
}

export interface AgentContext {
  llm: Llm;
  logger: Pick<Console, "debug" | "info" | "warn" | "error">;
  agentRoot: string;
}

export interface Agent {
  handle(input: AgentInput): Promise<AgentResult>;
}

export interface AgentModule {
  createAgent(context: AgentContext): Promise<Agent> | Agent;
}
