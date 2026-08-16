import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { access, readFile, stat } from "node:fs/promises";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { config as loadEnvironment } from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { generateLangBotArtifacts, loadLangBotIntegration } from "../integrations/langbot.js";
import { appHtml } from "./ui.js";
import { defaultRegistryFile, readCliProfiles, readRegistry, writeRegistry, type AgentProfile, type CliProfile, type ProfileRegistry } from "./profiles.js";

const updateAgentSchema = z.object({
  name: z.string().min(1).max(80),
  cliProfile: z.string().min(1).max(80),
  runtime: z.enum(["langbot", "codex"]),
  sourceDir: z.string().min(1),
  artifactDir: z.string().min(1),
  deployDir: z.string().min(1).optional(),
  enabled: z.boolean()
}).strict();

const actionSchema = z.object({
  action: z.enum(["preflight", "generate", "deploy"]),
  confirmation: z.string().optional()
}).strict();

interface SyncLogEntry {
  at: string;
  agentId: string;
  action: "preflight" | "generate" | "deploy";
  status: "success" | "failed";
  detail: string;
}

interface CliRuntimeState {
  tokenStatus?: string;
}

export interface ControlServerOptions {
  port?: number;
  registryFile?: string;
  cliConfigFile?: string;
  projectRoot?: string;
  allowedOrigins?: string[];
}

export interface StartedControlServer {
  url: string;
  close(): Promise<void>;
}

export async function startControlServer(options: ControlServerOptions = {}): Promise<StartedControlServer> {
  const projectRoot = options.projectRoot || path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
  const registryFile = options.registryFile ? path.resolve(options.registryFile) : defaultRegistryFile();
  const control = new ProfileControl(projectRoot, registryFile, options.cliConfigFile);
  const allowedOrigins = normalizeAllowedOrigins(options.allowedOrigins || []);
  const server = createServer((request, response) => void handleRequest(control, request, response, allowedOrigins));
  const port = options.port ?? 4318;
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
  const address = server.address();
  const actualPort = typeof address === "object" && address ? address.port : port;
  return {
    url: `http://127.0.0.1:${actualPort}`,
    close: () => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  };
}

export class ProfileControl {
  private readonly logFile: string;
  private auditWrites: Promise<void> = Promise.resolve();

  constructor(
    private readonly projectRoot: string,
    private readonly registryFile: string,
    private readonly cliConfigFile?: string
  ) {
    this.logFile = path.join(path.dirname(registryFile), "sync-log.json");
  }

  async state(): Promise<Record<string, unknown>> {
    const [registry, cliProfiles, runtime, audit] = await Promise.all([
      readRegistry(this.registryFile, this.projectRoot),
      readCliProfiles(this.cliConfigFile),
      readCliRuntimeState(),
      this.readAudit()
    ]);
    const cliByName = new Map(cliProfiles.map((profile) => [profile.name, profile]));
    return {
      generatedAt: new Date().toISOString(),
      registryFile: this.registryFile,
      cliProfiles: cliProfiles.map(({ name, appIdSuffix, brand, classification }) => ({ name, appIdSuffix, brand, classification })),
      agents: await Promise.all(registry.agents.map(async (agent) => describeAgent(agent, cliByName.get(agent.cliProfile), runtime.get(agent.cliProfile)))),
      users: describeUsers(cliProfiles, runtime),
      audit: audit.slice(0, 12)
    };
  }

  async updateAgent(id: string, body: unknown): Promise<Record<string, unknown>> {
    const update = updateAgentSchema.parse(body);
    const [registry, cliProfiles] = await Promise.all([
      readRegistry(this.registryFile, this.projectRoot),
      readCliProfiles(this.cliConfigFile)
    ]);
    const index = registry.agents.findIndex((agent) => agent.id === id);
    if (index < 0) throw new HttpError(404, "找不到 Agent Profile。");
    if (!cliProfiles.some((profile) => profile.name === update.cliProfile)) throw new HttpError(400, "选择的 CLI Profile 不存在于本机 lark-cli 配置中。");
    registry.agents[index] = { id, ...update };
    await writeRegistry(this.registryFile, registry);
    await this.appendAudit({ at: new Date().toISOString(), agentId: id, action: "preflight", status: "success", detail: "Agent deployment binding updated in the local registry." });
    return this.state();
  }

  async action(id: string, body: unknown): Promise<Record<string, unknown>> {
    const request = actionSchema.parse(body);
    const registry = await readRegistry(this.registryFile, this.projectRoot);
    const agent = registry.agents.find((entry) => entry.id === id);
    if (!agent) throw new HttpError(404, "找不到 Agent Profile。");
    if (!agent.enabled) throw new HttpError(409, "该 Agent Profile 已停用。");

    try {
      let detail: string;
      if (request.action === "preflight") detail = await preflight(agent);
      else if (request.action === "generate") detail = await generate(agent);
      else {
        if (request.confirmation !== `SYNC ${agent.id}`) throw new HttpError(400, `输入 SYNC ${agent.id} 后才会执行部署同步。`);
        detail = await deploy(agent);
      }
      await this.appendAudit({ at: new Date().toISOString(), agentId: id, action: request.action, status: "success", detail });
      return { ok: true, detail, state: await this.state() };
    } catch (error) {
      const detail = safeMessage(error);
      await this.appendAudit({ at: new Date().toISOString(), agentId: id, action: request.action, status: "failed", detail });
      throw error;
    }
  }

  private async readAudit(): Promise<SyncLogEntry[]> {
    try {
      const parsed = JSON.parse(await readFile(this.logFile, "utf8")) as unknown;
      if (!Array.isArray(parsed)) return [];
      return parsed.filter(isSyncLogEntry).sort((left, right) => right.at.localeCompare(left.at));
    } catch (error) {
      if (isNotFound(error)) return [];
      throw error;
    }
  }

  private async appendAudit(entry: SyncLogEntry): Promise<void> {
    const write = this.auditWrites.catch(() => undefined).then(() => this.writeAudit(entry));
    this.auditWrites = write;
    return write;
  }

  private async writeAudit(entry: SyncLogEntry): Promise<void> {
    const current = await this.readAudit();
    const next = [entry, ...current].slice(0, 100);
    const temporary = `${this.logFile}.${process.pid}.${randomUUID()}.tmp`;
    const { mkdir, rename, writeFile } = await import("node:fs/promises");
    await mkdir(path.dirname(this.logFile), { recursive: true, mode: 0o700 });
    await writeFile(temporary, `${JSON.stringify(next, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    await rename(temporary, this.logFile);
  }
}

async function handleRequest(control: ProfileControl, request: IncomingMessage, response: ServerResponse, allowedOrigins: Set<string>): Promise<void> {
  const url = new URL(request.url || "/", "http://127.0.0.1");
  try {
    const origin = request.headers.origin;
    if (origin && isAllowedOrigin(origin, request.headers.host, allowedOrigins)) {
      response.setHeader("Access-Control-Allow-Origin", origin);
      response.setHeader("Vary", "Origin");
    } else if (origin && url.pathname.startsWith("/api/")) {
      throw new HttpError(403, "This UI origin is not allowed by the local control plane.");
    }
    if (request.method === "OPTIONS" && url.pathname.startsWith("/api/")) {
      response.writeHead(204, {
        "Access-Control-Allow-Methods": "GET, POST, PUT, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Max-Age": "600"
      });
      response.end();
      return;
    }
    if (request.method === "GET" && url.pathname === "/") return sendHtml(response, appHtml);
    if (request.method === "GET" && url.pathname === "/api/state") return sendJson(response, 200, await control.state());
    const match = url.pathname.match(/^\/api\/agents\/([a-z0-9][a-z0-9-]{0,62})(?:\/(actions))?$/);
    if (match && request.method === "PUT" && !match[2]) return sendJson(response, 200, await control.updateAgent(match[1], await readJson(request)));
    if (match && request.method === "POST" && match[2] === "actions") return sendJson(response, 200, await control.action(match[1], await readJson(request)));
    throw new HttpError(404, "Not found");
  } catch (error) {
    const status = error instanceof HttpError ? error.status : 500;
    sendJson(response, status, { ok: false, error: safeMessage(error) });
  }
}

export function normalizeAllowedOrigins(origins: string[]): Set<string> {
  return new Set(origins.map((value) => {
    const url = new URL(value);
    if (url.protocol !== "https:" && url.hostname !== "127.0.0.1" && url.hostname !== "localhost") {
      throw new Error(`Control UI origin must use HTTPS: ${url.origin}`);
    }
    return url.origin;
  }));
}

function isAllowedOrigin(origin: string, host: string | undefined, allowedOrigins: Set<string>): boolean {
  const sameOrigin = host ? origin === `http://${host}` || origin === `https://${host}` : false;
  return sameOrigin || allowedOrigins.has(origin);
}

async function describeAgent(agent: AgentProfile, cli: CliProfile | undefined, runtime: CliRuntimeState | undefined): Promise<Record<string, unknown>> {
  const [sourceReady, artifactsReady, deployReady] = await Promise.all([
    exists(path.join(agent.sourceDir, "agent.manifest.json")),
    exists(path.join(agent.artifactDir, "deploy.mjs")),
    exists(path.join(agent.deployDir || agent.artifactDir, "deploy.mjs"))
  ]);
  return {
    ...agent,
    cli: cli ? { appIdSuffix: cli.appIdSuffix, brand: cli.brand, tokenStatus: runtime?.tokenStatus || "unknown" } : null,
    readiness: { sourceReady, artifactsReady, deployReady, cliProfileReady: Boolean(cli) }
  };
}

function describeUsers(profiles: CliProfile[], runtime: Map<string, CliRuntimeState>): Array<Record<string, unknown>> {
  return profiles.flatMap((profile) => profile.users.map((name) => ({
    displayName: name,
    cliProfile: profile.name,
    application: profile.appIdSuffix,
    tokenStatus: runtime.get(profile.name)?.tokenStatus || "unknown",
    identity: "user"
  })));
}

async function preflight(agent: AgentProfile): Promise<string> {
  await access(path.join(agent.sourceDir, "agent.manifest.json"));
  if (agent.runtime === "langbot") {
    const integration = await loadLangBotIntegration(agent.sourceDir);
    return `Preflight passed: ${integration.manifest.name}; pipeline ${integration.pipelineName}.`;
  }
  return "Preflight passed: Codex source manifest is available.";
}

async function generate(agent: AgentProfile): Promise<string> {
  if (agent.runtime !== "langbot") throw new HttpError(400, "当前控制台只能为 LangBot Agent 生成部署产物。");
  const integration = await loadLangBotIntegration(agent.sourceDir);
  await generateLangBotArtifacts(agent.sourceDir, agent.artifactDir);
  return `Generated reviewable LangBot artifacts for ${integration.manifest.name}. No network request was made.`;
}

async function deploy(agent: AgentProfile): Promise<string> {
  if (agent.runtime !== "langbot") throw new HttpError(400, "当前控制台只能同步 LangBot Agent。Codex Agent 由本地 app-server 运行。 ");
  const directory = agent.deployDir || agent.artifactDir;
  await access(path.join(directory, "deploy.mjs"));
  const envFile = path.join(directory, ".env");
  if (!await exists(envFile)) throw new HttpError(409, "未找到部署环境文件。请先在部署目录配置 .env。 ");
  loadEnvironment({ path: envFile, override: false, quiet: true });
  const result = await runProcess(process.execPath, ["deploy.mjs"], directory, 120_000);
  if (result.code !== 0) throw new HttpError(502, `Deployment failed.\n${result.output || "No safe output was returned."}`);
  return `Deployment synchronized.\n${result.output || "Completed without output."}`;
}

async function readCliRuntimeState(): Promise<Map<string, CliRuntimeState>> {
  try {
    const result = await runProcess("lark-cli", ["profile", "list"], process.cwd(), 8_000);
    if (result.code !== 0) return new Map();
    const parsed = JSON.parse(result.output) as unknown;
    if (!Array.isArray(parsed)) return new Map();
    return new Map(parsed.flatMap((item) => {
      if (!isRecord(item) || typeof item.name !== "string") return [];
      return [[item.name, { tokenStatus: typeof item.tokenStatus === "string" ? item.tokenStatus : undefined }] as const];
    }));
  } catch {
    return new Map();
  }
}

function runProcess(command: string, args: string[], cwd: string, timeoutMs: number): Promise<{ code: number | null; output: string }> {
  return new Promise((resolve) => {
    const child = spawn(command, args, { cwd, env: process.env, stdio: ["ignore", "pipe", "pipe"] });
    const chunks: Buffer[] = [];
    const collect = (chunk: Buffer) => { if (Buffer.concat(chunks).length < 24_000) chunks.push(chunk); };
    child.stdout.on("data", collect);
    child.stderr.on("data", collect);
    const timer = setTimeout(() => child.kill("SIGTERM"), timeoutMs);
    child.on("error", (error) => resolve({ code: 1, output: safeText(error.message) }));
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, output: safeText(Buffer.concat(chunks).toString("utf8")) });
    });
  });
}

async function readJson(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.from(chunk));
    if (Buffer.concat(chunks).length > 64_000) throw new HttpError(413, "Request body is too large.");
  }
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); }
  catch { throw new HttpError(400, "Invalid JSON request body."); }
}

function safeMessage(error: unknown): string {
  return safeText(error instanceof Error ? error.message : "Unexpected control-plane error.");
}

function safeText(value: string): string {
  return value
    .replace(/(app[_-]?secret|api[_-]?key|access[_-]?token|refresh[_-]?token|authorization|bearer)\s*[:=]\s*[^\s,;]+/gi, "$1=[REDACTED]")
    .replace(/\b(?:sk-[A-Za-z0-9_-]{8,}|(?:AKIA|ASIA)[A-Z0-9]{12,})\b/g, "[REDACTED_SECRET]")
    .slice(0, 24_000);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isSyncLogEntry(value: unknown): value is SyncLogEntry {
  return isRecord(value) && typeof value.at === "string" && typeof value.agentId === "string" && typeof value.action === "string" && typeof value.status === "string" && typeof value.detail === "string";
}

async function exists(file: string): Promise<boolean> {
  try { return (await stat(file)).isFile(); } catch { return false; }
}

function isNotFound(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

class HttpError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

function sendJson(response: ServerResponse, status: number, value: unknown): void {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  response.end(JSON.stringify(value));
}

function sendHtml(response: ServerResponse, value: string): void {
  response.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
  response.end(value);
}
