import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface } from "node:readline";
import type { CodexRpcClient, CodexThread, CodexTurn } from "./types.js";

interface RpcResponse {
  id?: number;
  result?: unknown;
  error?: unknown;
  method?: string;
  params?: unknown;
}

type NotificationListener = (method: string, params: unknown) => void;

export class CodexAppServerClient implements CodexRpcClient {
  private child: ChildProcessWithoutNullStreams | undefined;
  private readonly pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();
  private readonly notificationListeners = new Set<NotificationListener>();
  private nextId = 1;
  private initialized: Promise<void> | undefined;
  private stderr = "";

  constructor(private readonly executable = process.env.CODEX_BIN || "codex") {}

  async listThreads(params: Record<string, unknown> = {}): Promise<{ data: CodexThread[]; nextCursor: string | null }> {
    return this.request("thread/list", params) as Promise<{ data: CodexThread[]; nextCursor: string | null }>;
  }

  async readThread(threadId: string, includeTurns = false): Promise<CodexThread> {
    const result = await this.request("thread/read", { threadId, includeTurns }) as { thread: CodexThread };
    return result.thread;
  }

  async resumeThread(threadId: string): Promise<CodexThread> {
    const result = await this.request("thread/resume", { threadId }) as { thread: CodexThread };
    return result.thread;
  }

  async forkThread(threadId: string): Promise<CodexThread> {
    const result = await this.request("thread/fork", { threadId }) as { thread: CodexThread };
    return result.thread;
  }

  async startThread(params: Record<string, unknown>): Promise<CodexThread> {
    const result = await this.request("thread/start", params) as { thread: CodexThread };
    return result.thread;
  }

  async runTurn(threadId: string, text: string): Promise<{ turn: CodexTurn; text: string }> {
    let completion: ((turn: CodexTurn) => void) | undefined;
    const completed = new Promise<CodexTurn>((resolve) => { completion = resolve; });
    const unsubscribe = this.onNotification((method, params) => {
      if (method !== "turn/completed" || !isRecord(params) || params.threadId !== threadId || !isTurn(params.turn)) return;
      completion?.(params.turn);
    });
    try {
      const started = await this.request("turn/start", {
        threadId,
        input: [{ type: "text", text, text_elements: [] }]
      }) as { turn: CodexTurn };
      const turn = isTurnCompleted(started.turn) ? started.turn : await withTimeout(completed, 20 * 60_000, "Codex turn timed out");
      return { turn, text: latestAgentMessage(turn) };
    } finally {
      unsubscribe();
    }
  }

  async close(): Promise<void> {
    if (!this.child) return;
    const child = this.child;
    this.child = undefined;
    child.kill("SIGTERM");
  }

  private async request(method: string, params: unknown): Promise<unknown> {
    await this.ensureStarted();
    const id = this.nextId++;
    const child = this.child;
    if (!child) throw new Error("Codex App Server is not running");
    const response = new Promise<unknown>((resolve, reject) => this.pending.set(id, { resolve, reject }));
    child.stdin.write(`${JSON.stringify({ method, id, params })}\n`);
    return response;
  }

  private async ensureStarted(): Promise<void> {
    if (!this.initialized) this.initialized = this.start();
    return this.initialized;
  }

  private async start(): Promise<void> {
    const child = spawn(this.executable, ["app-server", "--stdio"], { stdio: ["pipe", "pipe", "pipe"] });
    this.child = child;
    child.once("error", (error) => this.failAll(error));
    child.once("exit", (code) => this.failAll(new Error(`Codex App Server exited with ${code ?? "signal"}: ${this.stderr.slice(-500)}`)));
    createInterface({ input: child.stdout }).on("line", (line) => this.onLine(line));
    child.stderr.on("data", (data: Buffer) => { this.stderr = `${this.stderr}${data.toString()}`.slice(-2_000); });

    await this.requestBeforeInitialization("initialize", {
      clientInfo: { name: "feishu-agent-scaffold", title: "Feishu Agent Scaffold", version: "0.1.0" },
      capabilities: { experimentalApi: false, requestAttestation: false }
    });
    child.stdin.write(`${JSON.stringify({ method: "initialized", params: {} })}\n`);
  }

  private requestBeforeInitialization(method: string, params: unknown): Promise<unknown> {
    const id = this.nextId++;
    const child = this.child;
    if (!child) return Promise.reject(new Error("Codex App Server is not running"));
    const response = new Promise<unknown>((resolve, reject) => this.pending.set(id, { resolve, reject }));
    child.stdin.write(`${JSON.stringify({ method, id, params })}\n`);
    return response;
  }

  private onLine(line: string): void {
    let message: RpcResponse;
    try {
      message = JSON.parse(line) as RpcResponse;
    } catch {
      return;
    }
    if (typeof message.id === "number") {
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      if (message.error !== undefined) pending.reject(new Error(`Codex App Server ${JSON.stringify(message.error)}`));
      else pending.resolve(message.result);
      return;
    }
    if (typeof message.method === "string") {
      for (const listener of this.notificationListeners) listener(message.method, message.params);
    }
  }

  private onNotification(listener: NotificationListener): () => void {
    this.notificationListeners.add(listener);
    return () => this.notificationListeners.delete(listener);
  }

  private failAll(error: Error): void {
    for (const { reject } of this.pending.values()) reject(error);
    this.pending.clear();
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isTurn(value: unknown): value is CodexTurn {
  return isRecord(value) && typeof value.id === "string" && Array.isArray(value.items);
}

function isTurnCompleted(turn: CodexTurn): boolean {
  return isRecord(turn.status) && turn.status.type !== "inProgress" && turn.status.type !== "active";
}

function latestAgentMessage(turn: CodexTurn): string {
  for (const item of [...turn.items].reverse()) {
    if (item.type === "agentMessage" && typeof item.text === "string") return item.text;
  }
  return "Codex completed without a final text response.";
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), timeoutMs);
    promise.then((value) => { clearTimeout(timer); resolve(value); }, (error) => { clearTimeout(timer); reject(error); });
  });
}
