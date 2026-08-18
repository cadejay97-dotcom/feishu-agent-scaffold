export interface CodexGitInfo {
  sha: string | null;
  branch: string | null;
  originUrl: string | null;
}

export interface CodexThreadItem {
  type: string;
  id: string;
  [key: string]: unknown;
}

export interface CodexTurn {
  id: string;
  items: CodexThreadItem[];
  status?: unknown;
  startedAt?: number | null;
  completedAt?: number | null;
}

export interface CodexThread {
  id: string;
  sessionId?: string;
  forkedFromId?: string | null;
  parentThreadId?: string | null;
  preview?: string;
  ephemeral?: boolean;
  historyMode?: string;
  modelProvider?: string;
  createdAt?: number;
  updatedAt?: number;
  cwd?: string;
  source?: string;
  gitInfo?: CodexGitInfo | null;
  name?: string | null;
  turns?: CodexTurn[];
}

export interface CodexRpcClient {
  listThreads(params?: Record<string, unknown>): Promise<{ data: CodexThread[]; nextCursor: string | null }>;
  readThread(threadId: string, includeTurns?: boolean): Promise<CodexThread>;
  resumeThread(threadId: string): Promise<CodexThread>;
  forkThread(threadId: string): Promise<CodexThread>;
  startThread(params: Record<string, unknown>): Promise<CodexThread>;
  runTurn(threadId: string, text: string): Promise<{ turn: CodexTurn; text: string }>;
  close?(): Promise<void>;
}
