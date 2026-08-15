import type { ChatRequest, ChatResult, Llm } from "../types.js";
import type { ModelConfig, ModelFile } from "./config.js";

export class ModelRegistry implements Llm {
  constructor(private readonly config: ModelFile, private readonly environment: NodeJS.ProcessEnv = process.env) {}

  async chat(request: ChatRequest): Promise<ChatResult> {
    const alias = request.model ?? this.environment.DEFAULT_MODEL ?? this.config.defaultModel;
    const model = this.config.models[alias];
    if (!model) throw new Error(`Unknown model alias: ${alias}`);
    const apiKey = this.environment[model.apiKeyEnv];
    if (!apiKey) throw new Error(`Missing API key environment variable: ${model.apiKeyEnv}`);
    return model.provider === "anthropic"
      ? callAnthropic(model, apiKey, request)
      : callOpenAiCompatible(model, apiKey, request);
  }
}

async function callOpenAiCompatible(config: ModelConfig, apiKey: string, request: ChatRequest): Promise<ChatResult> {
  const response = await fetch(`${config.baseUrl.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}`, ...config.headers },
    body: JSON.stringify({ model: config.model, messages: request.messages, temperature: request.temperature, max_tokens: request.maxTokens })
  });
  const body = await readJson(response);
  const text = body?.choices?.[0]?.message?.content;
  if (typeof text !== "string" || !text.trim()) throw new Error("Model returned an empty OpenAI-compatible response");
  return { text, model: config.model, provider: config.provider, usage: usage(body) };
}

async function callAnthropic(config: ModelConfig, apiKey: string, request: ChatRequest): Promise<ChatResult> {
  const system = request.messages.filter((message) => message.role === "system").map((message) => message.content).join("\n\n");
  const messages = request.messages.filter((message) => message.role !== "system");
  const response = await fetch(`${config.baseUrl.replace(/\/$/, "")}/v1/messages`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01", ...config.headers },
    body: JSON.stringify({ model: config.model, max_tokens: request.maxTokens ?? 2048, temperature: request.temperature, system: system || undefined, messages })
  });
  const body = await readJson(response);
  const text = body?.content?.filter((block: { type?: string }) => block.type === "text").map((block: { text?: string }) => block.text ?? "").join("\n");
  if (typeof text !== "string" || !text.trim()) throw new Error("Model returned an empty Anthropic response");
  return { text, model: config.model, provider: config.provider, usage: usage(body) };
}

async function readJson(response: Response): Promise<any> {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = body?.error?.message ?? body?.message ?? response.statusText;
    throw new Error(`Model API request failed (${response.status}): ${message}`);
  }
  return body;
}

function usage(body: any): ChatResult["usage"] | undefined {
  const inputTokens = body?.usage?.prompt_tokens ?? body?.usage?.input_tokens;
  const outputTokens = body?.usage?.completion_tokens ?? body?.usage?.output_tokens;
  return inputTokens === undefined && outputTokens === undefined ? undefined : { inputTokens, outputTokens };
}
