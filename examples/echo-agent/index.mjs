import { readFile } from "node:fs/promises";
import path from "node:path";

export async function createAgent(context) {
  const system = await readFile(path.join(context.agentRoot, "prompts/system.md"), "utf8");
  return {
    async handle(input) {
      const response = await context.llm.chat({
        messages: [
          { role: "system", content: system },
          { role: "user", content: input.text }
        ],
        temperature: 0.2
      });
      return { text: response.text };
    }
  };
}
