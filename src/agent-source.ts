import { access, mkdir, stat } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";

export interface GitHubAgentSource {
  repo: string;
  ref: string;
  out: string;
  agentSubdir?: string;
}

export interface FetchedAgentSource {
  checkoutDir: string;
  agentDir: string;
  commit: string;
}

/**
 * Fetch an immutable review candidate. It deliberately does not install or
 * execute any code from the fetched repository.
 */
export async function fetchGitHubAgentSource(source: GitHubAgentSource): Promise<FetchedAgentSource> {
  const repo = normalizeGitHubRepo(source.repo);
  const ref = validateGitRef(source.ref);
  const checkoutDir = path.resolve(source.out);
  await assertDestinationDoesNotExist(checkoutDir);
  await mkdir(checkoutDir, { recursive: true, mode: 0o700 });
  try {
    await runGit(["init", "--quiet", checkoutDir]);
    await runGit(["-C", checkoutDir, "remote", "add", "origin", repo]);
    await runGit(["-C", checkoutDir, "-c", "protocol.file.allow=never", "-c", "core.hooksPath=/dev/null", "fetch", "--quiet", "--depth=1", "origin", ref]);
    await runGit(["-C", checkoutDir, "-c", "core.hooksPath=/dev/null", "checkout", "--quiet", "--detach", "FETCH_HEAD"]);
    const commit = (await runGit(["-C", checkoutDir, "rev-parse", "HEAD"])).trim();
    const agentDir = resolveAgentSubdir(checkoutDir, source.agentSubdir ?? ".");
    await access(agentDir);
    if (!(await stat(agentDir)).isDirectory()) throw new Error("--agent-subdir must resolve to a directory inside the checkout");
    return { checkoutDir, agentDir, commit };
  } catch (error) {
    throw new Error(`Unable to fetch GitHub Agent source: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export function normalizeGitHubRepo(value: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("--repo must be an HTTPS GitHub repository URL");
  }
  if (parsed.protocol !== "https:" || parsed.hostname !== "github.com" || parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error("--repo must be an HTTPS github.com URL without credentials, query, or fragment");
  }
  const segments = parsed.pathname.split("/").filter(Boolean);
  if (segments.length !== 2 || !segments.every((segment) => /^[A-Za-z0-9_.-]+$/.test(segment))) {
    throw new Error("--repo must identify exactly one GitHub owner/repository");
  }
  const [owner, repository] = segments;
  return `https://github.com/${owner}/${repository.replace(/\.git$/, "")}.git`;
}

export function validateGitRef(value: string): string {
  const ref = value.trim();
  if (!/^[A-Za-z0-9._/-]{1,255}$/.test(ref) || ref.includes("..") || ref.endsWith(".") || ref.startsWith("-")) {
    throw new Error("--ref must be a branch, tag, or commit-like Git ref without whitespace or shell syntax");
  }
  return ref;
}

export function resolveAgentSubdir(checkoutDir: string, subdir: string): string {
  const root = path.resolve(checkoutDir);
  const destination = path.resolve(root, subdir);
  if (destination !== root && !destination.startsWith(`${root}${path.sep}`)) throw new Error("--agent-subdir must stay inside the fetched repository");
  return destination;
}

async function assertDestinationDoesNotExist(destination: string): Promise<void> {
  try {
    await access(destination);
  } catch (error) {
    if (isNotFound(error)) return;
    throw error;
  }
  throw new Error(`Refusing to overwrite existing path: ${destination}`);
}

function runGit(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn("git", args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => { stdout += chunk.toString(); });
    child.stderr.on("data", (chunk: Buffer) => { stderr = `${stderr}${chunk.toString()}`.slice(-1_000); });
    child.on("error", reject);
    child.on("exit", (code) => code === 0 ? resolve(stdout) : reject(new Error(`git ${args[0]} failed: ${stderr.trim() || code}`)));
  });
}

function isNotFound(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}
