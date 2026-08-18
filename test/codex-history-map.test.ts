import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { CodexHistoryMap } from "../src/codex/history-map.js";
import type { CodexRpcClient, CodexThread, CodexTurn } from "../src/codex/types.js";

const acceptanceThread: CodexThread = {
  id: "fixture-thread-acceptance",
  sessionId: "session-test",
  name: "Codex｜对话命名边界",
  preview: "通过飞书 Agent 恢复本地 Codex 对话",
  cwd: "/workspace/project",
  source: "appServer",
  modelProvider: "openai",
  createdAt: 100,
  updatedAt: 200,
  gitInfo: { branch: "integration/langbot", sha: "abc123", originUrl: "https://example.test/repo.git" },
  turns: [{
    id: "turn-1",
    startedAt: 100,
    completedAt: 101,
    items: [
      { type: "userMessage", id: "u1", content: [{ type: "text", text: "API_KEY=secret-value 建立历史地图" }] },
      { type: "commandExecution", id: "c1", command: "npm test", cwd: "/workspace/project" },
      { type: "fileChange", id: "f1", changes: [{ path: "src/map.ts", kind: "update", diff: "secret diff" }] },
      { type: "agentMessage", id: "a1", text: "历史地图已完成" }
    ]
  }]
};

test("incrementally maps the designated acceptance thread without retaining common secrets", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "codex-history-map-"));
  const file = path.join(directory, "history-map.json");
  const client = new FakeCodexClient(acceptanceThread);
  const map = new CodexHistoryMap(client, file);
  try {
    assert.deepEqual(await map.sync(), { indexed: 1, unchanged: 0, total: 1 });
    assert.deepEqual(await map.sync(), { indexed: 0, unchanged: 1, total: 1 });
    assert.equal(client.readCount, 1);

    const matches = await map.search("历史地图");
    assert.equal(matches[0]?.id, acceptanceThread.id);
    assert.equal(matches[0]?.memory.recommendation, "required");
    assert.deepEqual(matches[0]?.files, ["src/map.ts"]);
    assert.deepEqual(matches[0]?.tools, ["npm"]);
    assert.doesNotMatch(await readFile(file, "utf8"), /secret-value/);
    if (process.platform !== "win32") assert.equal((await stat(file)).mode & 0o777, 0o600);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

class FakeCodexClient implements CodexRpcClient {
  readCount = 0;

  constructor(private readonly thread: CodexThread) {}

  async listThreads(params: Record<string, unknown> = {}): Promise<{ data: CodexThread[]; nextCursor: string | null }> {
    return { data: params.archived ? [] : [{ ...this.thread, turns: [] }], nextCursor: null };
  }

  async readThread(): Promise<CodexThread> {
    this.readCount += 1;
    return this.thread;
  }

  async resumeThread(): Promise<CodexThread> { return this.thread; }
  async forkThread(): Promise<CodexThread> { return this.thread; }
  async startThread(): Promise<CodexThread> { return this.thread; }
  async runTurn(): Promise<{ turn: CodexTurn; text: string }> { return { turn: this.thread.turns![0], text: "ok" }; }
}
