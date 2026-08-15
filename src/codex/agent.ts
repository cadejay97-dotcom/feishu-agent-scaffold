import path from "node:path";
import type { Agent, AgentInput } from "../types.js";
import { CodexHistoryMap, type HistoryMapEntry } from "./history-map.js";
import type { CodexRpcClient, CodexThread } from "./types.js";

export interface CodingAgentOptions {
  client: CodexRpcClient;
  historyMap: CodexHistoryMap;
  allowedRoots: string[];
  allowedOpenIds: string[];
}

export function createCodingAgent(options: CodingAgentOptions): Agent {
  const allowedRoots = options.allowedRoots.map((root) => path.resolve(root));
  const allowedOpenIds = new Set(options.allowedOpenIds);
  if (!allowedRoots.length) throw new Error("Coding Agent requires at least one allowed local workspace root");
  if (!allowedOpenIds.size) throw new Error("Coding Agent requires at least one allowed Feishu open_id");

  return {
    async handle(input: AgentInput): Promise<{ text: string }> {
      if (!allowedOpenIds.has(input.senderOpenId)) return { text: "此 Coding Agent 未授权给当前飞书用户。" };
      const message = input.text.trim();
      if (message === "/history sync") {
        const result = await options.historyMap.sync();
        return { text: `历史地图已同步：新增或更新 ${result.indexed}，未变化 ${result.unchanged}，共 ${result.total} 个会话。` };
      }
      if (message.startsWith("/history search ")) {
        const results = await options.historyMap.search(message.slice("/history search ".length));
        return { text: formatSearch(results) };
      }
      if (message.startsWith("/history show ")) {
        const threadId = message.slice("/history show ".length).trim();
        const entry = await options.historyMap.get(threadId);
        return { text: entry ? formatEntry(entry) : "地图中没有该会话。请先执行 /history sync。" };
      }
      if (message.startsWith("/codex resume ")) {
        const [threadId, ...prompt] = message.slice("/codex resume ".length).trim().split(/\s+/);
        if (!threadId || !prompt.length) return { text: "用法：/codex resume <thread-id> <开发任务>" };
        const { thread, forked } = await resumeOrFork(options.client, threadId);
        assertAllowedThread(thread, allowedRoots);
        const result = await options.client.runTurn(thread.id, prompt.join(" "));
        await options.historyMap.sync();
        return { text: `${result.text}\n\n${forked ? `原会话正在被其他 Codex 客户端使用，已从其历史创建分支：${thread.id}` : `会话：${thread.id}`}` };
      }
      if (message.startsWith("/codex new ")) {
        const [rootIndexText, ...prompt] = message.slice("/codex new ".length).trim().split(/\s+/);
        const root = allowedRoots[Number(rootIndexText) - 1];
        if (!root || !prompt.length) return { text: "用法：/codex new <工作目录编号> <开发任务>" };
        const thread = await options.client.startThread({ cwd: root, runtimeWorkspaceRoots: [root] });
        const result = await options.client.runTurn(thread.id, prompt.join(" "));
        await options.historyMap.sync();
        return { text: `${result.text}\n\n新会话：${thread.id}` };
      }
      return { text: `Coding Agent 命令：\n/history sync\n/history search <关键词>\n/history show <thread-id>\n/codex resume <thread-id> <开发任务>\n/codex new <工作目录编号> <开发任务>\n允许的工作目录：${allowedRoots.map((root, index) => `${index + 1}. ${root}`).join("；")}` };
    }
  };
}

async function resumeOrFork(client: CodexRpcClient, threadId: string): Promise<{ thread: CodexThread; forked: boolean }> {
  try {
    return { thread: await client.resumeThread(threadId), forked: false };
  } catch (error) {
    if (error instanceof Error && /active writer/i.test(error.message)) return { thread: await client.forkThread(threadId), forked: true };
    throw error;
  }
}

function assertAllowedThread(thread: CodexThread, roots: string[]): void {
  const cwd = thread.cwd;
  if (!cwd || !roots.some((root) => cwd === root || cwd.startsWith(`${root}${path.sep}`))) {
    throw new Error("目标 Codex 会话的工作目录不在 Coding Agent 白名单内");
  }
}

function formatSearch(entries: HistoryMapEntry[]): string {
  if (!entries.length) return "没有匹配的历史会话。请先执行 /history sync，或更换关键词。";
  return entries.map((entry) => `${entry.id}\n${entry.name ?? (entry.preview || "未命名会话")}\n记忆：${entry.memory.recommendation}；文件：${entry.files.slice(0, 5).join(", ") || "无"}`).join("\n\n");
}

function formatEntry(entry: HistoryMapEntry): string {
  return [
    `${entry.name ?? "未命名会话"}`,
    `会话：${entry.id}`,
    `目录：${entry.cwd ?? "未知"}`,
    `Git：${entry.git?.branch ?? "未知"} ${entry.git?.sha ?? ""}`.trim(),
    `回合：${entry.turnCount}；记忆：${entry.memory.recommendation}`,
    `原因：${entry.memory.reason}`,
    `文件：${entry.files.slice(0, 12).join(", ") || "无"}`,
    `主题：${entry.topics.join(", ") || "无"}`,
    `摘要：${entry.preview}`
  ].join("\n");
}
