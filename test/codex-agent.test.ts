import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createCodingAgent } from "../src/codex/agent.js";
import { CodexHistoryMap } from "../src/codex/history-map.js";
import type { AgentInput } from "../src/types.js";
import type { CodexRpcClient, CodexThread, CodexTurn } from "../src/codex/types.js";

test("rejects unauthorized Feishu users before exposing local history", async () => {
  const client = new FakeClient("/allowed/project");
  const agent = createCodingAgent({
    client,
    historyMap: new CodexHistoryMap(client, path.join(os.tmpdir(), "unused-history-map.json")),
    allowedRoots: ["/allowed"],
    allowedOpenIds: ["ou_allowed"]
  });
  const response = await agent.handle(input("ou_other", "/history search private"));
  assert.match(response.text, /未授权/);
  assert.equal(client.calls, 0);
});

test("resumes an allowed thread and refuses a thread outside the workspace boundary", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "codex-agent-map-"));
  try {
    const client = new FakeClient("/allowed/project");
    const agent = createCodingAgent({
      client,
      historyMap: new CodexHistoryMap(client, path.join(directory, "map.json")),
      allowedRoots: ["/allowed"],
      allowedOpenIds: ["ou_allowed"]
    });
    const response = await agent.handle(input("ou_allowed", "/codex resume thread-1 continue implementation"));
    assert.match(response.text, /completed/);
    assert.match(response.text, /thread-1/);

    client.cwd = "/private/project";
    await assert.rejects(() => agent.handle(input("ou_allowed", "/codex resume thread-1 inspect secrets")), /不在 Coding Agent 白名单/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("forks instead of taking over a thread held by another Codex client", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "codex-agent-fork-map-"));
  try {
    const client = new FakeClient("/allowed/project");
    client.resumeError = new Error("thread thread-1 already has an active writer");
    const agent = createCodingAgent({
      client,
      historyMap: new CodexHistoryMap(client, path.join(directory, "map.json")),
      allowedRoots: ["/allowed"],
      allowedOpenIds: ["ou_allowed"]
    });
    const response = await agent.handle(input("ou_allowed", "/codex resume thread-1 continue safely"));
    assert.match(response.text, /创建分支/);
    assert.equal(client.forked, true);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

function input(senderOpenId: string, text: string): AgentInput {
  return { text, senderOpenId, chatId: "oc_test", messageId: "om_test", mentionsBot: true };
}

class FakeClient implements CodexRpcClient {
  calls = 0;
  cwd: string;
  forked = false;
  resumeError: Error | undefined;

  constructor(cwd: string) { this.cwd = cwd; }

  private thread(): CodexThread {
    return { id: "thread-1", cwd: this.cwd, name: "test", preview: "test", updatedAt: 1, turns: [{ id: "turn-1", items: [] }] };
  }

  async listThreads(params: Record<string, unknown> = {}): Promise<{ data: CodexThread[]; nextCursor: string | null }> {
    this.calls += 1;
    return { data: params.archived ? [] : [{ ...this.thread(), turns: [] }], nextCursor: null };
  }

  async readThread(): Promise<CodexThread> { this.calls += 1; return this.thread(); }
  async resumeThread(): Promise<CodexThread> {
    this.calls += 1;
    if (this.resumeError) throw this.resumeError;
    return this.thread();
  }
  async forkThread(): Promise<CodexThread> { this.calls += 1; this.forked = true; return this.thread(); }
  async startThread(): Promise<CodexThread> { this.calls += 1; return this.thread(); }
  async runTurn(): Promise<{ turn: CodexTurn; text: string }> {
    this.calls += 1;
    return { turn: { id: "turn-2", items: [{ type: "agentMessage", id: "a1", text: "completed" }] }, text: "completed" };
  }
}
