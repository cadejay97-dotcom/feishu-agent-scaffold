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
  mentionsBot: boolean;
}

export interface AgentContext {
  llm: Llm;
  logger: Pick<Console, "debug" | "info" | "warn" | "error">;
  agentRoot: string;
}

export interface Agent {
  handle(input: AgentInput): Promise<{ text: string }>;
}

export interface AgentModule {
  createAgent(context: AgentContext): Promise<Agent> | Agent;
}
