import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import type { Agent, AgentContext, AgentModule } from "./types.js";

const manifestSchema = z.object({
  schemaVersion: z.literal(1),
  name: z.string().min(1),
  description: z.string().min(1),
  entry: z.string().min(1),
  triggers: z.array(z.enum(["mention", "direct-message"])).min(1),
  defaultModel: z.string().min(1).optional()
}).strict();

export type AgentManifest = z.infer<typeof manifestSchema>;

export async function loadAgent(agentDir: string, context: AgentContext): Promise<{ agent: Agent; manifest: AgentManifest }> {
  const root = path.resolve(agentDir);
  const manifest = await readAgentManifest(root);
  const entryPath = path.resolve(root, manifest.entry);

  if (!entryPath.startsWith(`${root}${path.sep}`)) {
    throw new Error("agent.manifest.json entry must stay inside the Agent folder");
  }
  await access(entryPath);

  const module = await import(pathToFileURL(entryPath).href) as AgentModule;
  if (typeof module.createAgent !== "function") {
    throw new Error(`Agent entry ${manifest.entry} must export createAgent(context)`);
  }

  const agent = await module.createAgent({
    ...context,
    agentRoot: root,
    llm: { chat: (request) => context.llm.chat({ ...request, model: request.model ?? manifest.defaultModel }) }
  });
  if (!agent || typeof agent.handle !== "function") {
    throw new Error("createAgent(context) must return an object with async handle(input)");
  }
  return { agent, manifest };
}

export async function readAgentManifest(agentDir: string): Promise<AgentManifest> {
  const raw = await readFile(path.join(agentDir, "agent.manifest.json"), "utf8");
  return manifestSchema.parse(JSON.parse(raw));
}
