import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import type { CodexRpcClient, CodexThread, CodexThreadItem, CodexTurn } from "./types.js";

export type MemoryRecommendation = "required" | "checkpoint" | "none";

export interface HistoryMapEntry {
  id: string;
  name: string | null;
  preview: string;
  cwd: string | null;
  source: string | null;
  modelProvider: string | null;
  createdAt: number | null;
  updatedAt: number | null;
  archived: boolean;
  parentThreadId: string | null;
  forkedFromId: string | null;
  git: CodexThread["gitInfo"];
  turnCount: number;
  files: string[];
  tools: string[];
  topics: string[];
  memory: { recommendation: MemoryRecommendation; reason: string };
  turns: Array<{ id: string; startedAt: number | null; completedAt: number | null; excerpt: string; files: string[]; tools: string[] }>;
  searchText: string;
}

export interface HistoryMapDisplayEntry {
  id: string;
  name: string | null;
  preview: string;
  cwd: string | null;
  source: string | null;
  modelProvider: string | null;
  createdAt: number | null;
  updatedAt: number | null;
  archived: boolean;
  parentThreadId: string | null;
  forkedFromId: string | null;
  git: CodexThread["gitInfo"];
  turnCount: number;
  files: string[];
  tools: string[];
  topics: string[];
  memory: HistoryMapEntry["memory"];
  turns: Array<{ id: string; startedAt: number | null; completedAt: number | null; files: string[]; tools: string[] }>;
}

interface HistoryMapFile {
  schemaVersion: 1;
  updatedAt: string;
  entries: HistoryMapEntry[];
}

export interface SyncResult {
  indexed: number;
  unchanged: number;
  total: number;
}

export function defaultHistoryMapPath(environment: NodeJS.ProcessEnv = process.env): string {
  return path.join(environment.CODEX_HOME || path.join(homedir(), ".codex"), "history-map.json");
}

export class CodexHistoryMap {
  constructor(private readonly client: CodexRpcClient, readonly file = defaultHistoryMapPath()) {}

  async sync(limit?: number): Promise<SyncResult> {
    const current = await this.load();
    const entries = new Map(current.entries.map((entry) => [entry.id, entry]));
    const listed = await this.listAll(limit);
    let indexed = 0;
    let unchanged = 0;
    for (const { thread, archived } of listed) {
      const existing = entries.get(thread.id);
      if (existing && existing.updatedAt === (thread.updatedAt ?? null) && existing.archived === archived) {
        unchanged += 1;
        continue;
      }
      const full = await this.client.readThread(thread.id, true);
      entries.set(thread.id, buildHistoryMapEntry(full, archived));
      indexed += 1;
    }
    const next: HistoryMapFile = {
      schemaVersion: 1,
      updatedAt: new Date().toISOString(),
      entries: [...entries.values()].sort((left, right) => (right.updatedAt ?? 0) - (left.updatedAt ?? 0))
    };
    await this.save(next);
    return { indexed, unchanged, total: next.entries.length };
  }

  async search(query: string, limit = 10): Promise<HistoryMapEntry[]> {
    const terms = tokenize(query);
    if (!terms.length) return [];
    return (await this.load()).entries
      .map((entry) => ({ entry, score: score(entry, terms) }))
      .filter(({ score }) => score > 0)
      .sort((left, right) => right.score - left.score || (right.entry.updatedAt ?? 0) - (left.entry.updatedAt ?? 0))
      .slice(0, limit)
      .map(({ entry }) => entry);
  }

  async get(threadId: string): Promise<HistoryMapEntry | undefined> {
    return (await this.load()).entries.find((entry) => entry.id === threadId);
  }

  private async listAll(limit?: number): Promise<Array<{ thread: CodexThread; archived: boolean }>> {
    const result: Array<{ thread: CodexThread; archived: boolean }> = [];
    for (const archived of [false, true]) {
      let cursor: string | null = null;
      do {
        const remaining = limit === undefined ? 100 : Math.min(100, limit - result.length);
        if (remaining <= 0) return result;
        const page = await this.client.listThreads({ cursor, limit: remaining, archived });
        result.push(...page.data.map((thread) => ({ thread, archived })));
        cursor = page.nextCursor;
      } while (cursor);
    }
    return result;
  }

  private async load(): Promise<HistoryMapFile> {
    try {
      const parsed = JSON.parse(await readFile(this.file, "utf8")) as HistoryMapFile;
      if (parsed.schemaVersion !== 1 || !Array.isArray(parsed.entries)) throw new Error("unsupported history map format");
      return parsed;
    } catch (error) {
      if (isNotFound(error)) return { schemaVersion: 1, updatedAt: new Date(0).toISOString(), entries: [] };
      throw error;
    }
  }

  private async save(value: HistoryMapFile): Promise<void> {
    await mkdir(path.dirname(this.file), { recursive: true, mode: 0o700 });
    await writeFile(this.file, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  }
}

export function buildHistoryMapEntry(thread: CodexThread, archived = false): HistoryMapEntry {
  const files = new Set<string>();
  const tools = new Set<string>();
  const transcript: string[] = [];
  const turns = (thread.turns ?? []).map((turn) => summarizeTurn(turn, files, tools, transcript));
  const searchText = redact(transcript.join("\n")).slice(0, 48_000);
  const memory = memoryRecommendation(thread, turns, files, tools);
  return {
    id: thread.id,
    name: thread.name ?? null,
    preview: redact(thread.preview ?? "").slice(0, 1_000),
    cwd: thread.cwd ?? null,
    source: thread.source ?? null,
    modelProvider: thread.modelProvider ?? null,
    createdAt: thread.createdAt ?? null,
    updatedAt: thread.updatedAt ?? null,
    archived,
    parentThreadId: thread.parentThreadId ?? null,
    forkedFromId: thread.forkedFromId ?? null,
    git: thread.gitInfo ?? null,
    turnCount: turns.length,
    files: [...files].sort(),
    tools: [...tools].sort(),
    topics: extractTopics(`${thread.name ?? ""} ${thread.preview ?? ""} ${searchText}`),
    memory,
    turns,
    searchText
  };
}

/** Render only recovery metadata. Full text remains in Codex's local history. */
export function displayHistoryMapEntry(entry: HistoryMapEntry): HistoryMapDisplayEntry {
  return {
    id: entry.id,
    name: entry.name,
    preview: entry.preview,
    cwd: entry.cwd,
    source: entry.source,
    modelProvider: entry.modelProvider,
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt,
    archived: entry.archived,
    parentThreadId: entry.parentThreadId,
    forkedFromId: entry.forkedFromId,
    git: entry.git,
    turnCount: entry.turnCount,
    files: entry.files,
    tools: entry.tools,
    topics: entry.topics,
    memory: entry.memory,
    turns: entry.turns.map((turn) => ({ id: turn.id, startedAt: turn.startedAt, completedAt: turn.completedAt, files: turn.files, tools: turn.tools }))
  };
}

function summarizeTurn(turn: CodexTurn, files: Set<string>, tools: Set<string>, transcript: string[]): HistoryMapEntry["turns"][number] {
  const turnFiles = new Set<string>();
  const turnTools = new Set<string>();
  const texts: string[] = [];
  for (const item of turn.items ?? []) collectItem(item, texts, turnFiles, turnTools);
  for (const file of turnFiles) files.add(file);
  for (const tool of turnTools) tools.add(tool);
  const text = redact(texts.join("\n"));
  transcript.push(text);
  return {
    id: turn.id,
    startedAt: turn.startedAt ?? null,
    completedAt: turn.completedAt ?? null,
    excerpt: clip(text, 1_200),
    files: [...turnFiles].sort(),
    tools: [...turnTools].sort()
  };
}

function collectItem(item: CodexThreadItem, texts: string[], files: Set<string>, tools: Set<string>): void {
  if (item.type === "userMessage" && Array.isArray(item.content)) {
    for (const content of item.content) if (isRecord(content) && content.type === "text" && typeof content.text === "string") texts.push(content.text);
  }
  if ((item.type === "agentMessage" || item.type === "plan") && typeof item.text === "string") texts.push(item.text);
  if (item.type === "commandExecution" && typeof item.command === "string") {
    const command = item.command.trim().split(/\s+/)[0];
    if (command) tools.add(command);
  }
  if (item.type === "mcpToolCall" && typeof item.server === "string" && typeof item.tool === "string") tools.add(`${item.server}.${item.tool}`);
  if (item.type === "fileChange" && Array.isArray(item.changes)) {
    for (const change of item.changes) if (isRecord(change) && typeof change.path === "string") files.add(change.path);
  }
}

function memoryRecommendation(thread: CodexThread, turns: HistoryMapEntry["turns"], files: Set<string>, tools: Set<string>): HistoryMapEntry["memory"] {
  if (thread.ephemeral || !turns.length) {
    return { recommendation: "none", reason: "没有可恢复的本地回合；地图仅保留元数据。" };
  }
  if (files.size > 0 || tools.size > 0 || turns.length >= 8 || thread.forkedFromId) {
    return { recommendation: "required", reason: "包含开发轨迹、文件变更、工具调用或长上下文；继续工作前应恢复原线程。" };
  }
  return { recommendation: "checkpoint", reason: "历史已持久化；需要背景时可从原线程恢复，地图持续记录其变化。" };
}

function score(entry: HistoryMapEntry, terms: string[]): number {
  const title = `${entry.name ?? ""} ${entry.preview}`.toLocaleLowerCase();
  const text = entry.searchText.toLocaleLowerCase();
  const paths = entry.files.join(" ").toLocaleLowerCase();
  return terms.reduce((total, term) => total + (title.includes(term) ? 10 : 0) + (paths.includes(term) ? 6 : 0) + (text.includes(term) ? 2 : 0), 0);
}

function tokenize(value: string): string[] {
  return [...new Set(value.toLocaleLowerCase().trim().split(/[\s,，。！？!?.:/\\]+/).filter((term) => term.length >= 2))];
}

function extractTopics(value: string): string[] {
  const ignored = new Set(["this", "that", "with", "from", "agent", "codex", "the", "and", "for", "一个", "这个", "可以", "需要", "进行", "通过"]);
  const count = new Map<string, number>();
  for (const term of tokenize(value)) if (!ignored.has(term) && !/^[0-9]+$/.test(term)) count.set(term, (count.get(term) ?? 0) + 1);
  return [...count.entries()].sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0])).slice(0, 12).map(([term]) => term);
}

function redact(value: string): string {
  return value
    .replace(/\b(sk-[A-Za-z0-9_-]{8,}|(?:AKIA|ASIA)[A-Z0-9]{12,})\b/g, "[REDACTED_SECRET]")
    .replace(/((?:api[_-]?key|app[_-]?secret|authorization|bearer)\s*[:=]\s*)([^\s,;]+)/gi, "$1[REDACTED]");
}

function clip(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isNotFound(error: unknown): boolean {
  return isRecord(error) && error.code === "ENOENT";
}
