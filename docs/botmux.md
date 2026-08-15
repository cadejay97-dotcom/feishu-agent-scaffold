# BotMux Coding-Agent Bridge

This integration provisions a BotMux-managed Feishu bot for an **already installed and authenticated** local coding CLI. It deliberately bypasses this repository's `createAgent(context)` runtime: BotMux owns Feishu events, one CLI process per session, session resume, and streamed cards. The native `feishu-agent run` path remains available and unchanged.

The bridge was checked against BotMux **v3.13.0**. It generates its documented scripted interface:

```text
botmux setup add --create-app|--app-id ... --app-secret ... \
  --name ... --cli ... --backend ... --default-working-dir ... \
  --allowed-users ... --brand ... [--model ...] [--cli-path ...]
```

Upstream evidence:

- [BotMux v3.13.0 release](https://github.com/deepcoldy/botmux/releases/tag/v3.13.0)
- [Scripted `setup add` command contract](https://github.com/deepcoldy/botmux/blob/v3.13.0/src/setup/setup-args.ts)
- [`bots.json` field contract](https://github.com/deepcoldy/botmux/blob/v3.13.0/docs-site/docs/zh/bots-json.md)
- [Supported CLI adapter IDs](https://github.com/deepcoldy/botmux/blob/v3.13.0/src/adapters/cli/types.ts)

## Preconditions

1. Use Node.js 22+ for BotMux, and install BotMux v3.13.0 or later: `npm install -g botmux`.
2. On the **same operating-system account** that will run `botmux`, install and authenticate the selected CLI (`codex`, `claude`, `gemini`, etc.). This bridge never supplies, copies, or modifies CLI credentials.
3. Install the selected BotMux backend. `tmux` is the BotMux default and this bridge's default; choose `pty` only when its non-persistent behavior is acceptable.
4. Set `workspaceDir` to an existing absolute repository path. That is where BotMux launches the CLI. Put all Agent instructions, repository policy, hooks, MCP configuration, and credentials under the responsibility of the existing CLI/project before deployment.
5. Choose at least one owner using an identity accepted by BotMux (prefer a full email address or `on_...` union ID). Do not reuse an `ou_...` open ID from a different Feishu app.

## Bridge Config

Copy [examples/botmux/codex-agent.botmux.json](../examples/botmux/codex-agent.botmux.json) outside the repository and replace all placeholders. The file is deliberately secret-free.

```json
{
  "schemaVersion": 1,
  "name": "codex-production",
  "cliId": "codex",
  "workspaceDir": "/absolute/path/to/your/repository",
  "owners": ["owner@example.com"],
  "allowedChatGroups": ["oc_authorized_group"],
  "model": "gpt-5-codex",
  "backend": "tmux",
  "openPlatformAuto": true,
  "app": {
    "mode": "create",
    "name": "Codex Production Agent",
    "brand": "feishu"
  }
}
```

`cliId` is intentionally restricted to BotMux v3.13.0's actual registry: `claude-code`, `codex`, `gemini`, `cursor`, `opencode`, `kimi`, `coco`, `copilot`, `dsh`, and the other upstream registry values. This bridge does not invent adapters or turn a non-compatible CLI into one. Use `cliPathOverride` only as an absolute executable path for an existing BotMux-compatible wrapper/CLI.

For an existing Feishu application, no App ID or App Secret belongs in the JSON. Use environment-variable references instead:

```json
"app": {
  "mode": "existing",
  "appIdEnv": "FEISHU_EXISTING_APP_ID",
  "appSecretEnv": "FEISHU_EXISTING_APP_SECRET",
  "brand": "feishu"
}
```

The process environment must define those two variables only when deploying. They are not rendered into the printed command or stored by this scaffold.

## Deploy

```bash
npx tsx src/cli.ts botmux validate --config /absolute/path/codex-agent.botmux.json
npx tsx src/cli.ts botmux command --config /absolute/path/codex-agent.botmux.json
npx tsx src/cli.ts botmux deploy --config /absolute/path/codex-agent.botmux.json
botmux start
```

`command` is read-only and prints the exact upstream command. `deploy` first confirms that `workspaceDir`, an optional `cliPathOverride`, and BotMux v3.13.0+ are locally available, then invokes `botmux setup add` without a shell. With `app.mode: "create"`, BotMux opens its own Feishu authorization/application-creation flow. With `openPlatformAuto: true`, it asks BotMux to configure its documented platform setup. The operator must still complete any interactive authorization and tenant administrator approval required by Feishu.

After `botmux start`, test with an owner in an authorized chat: `@Bot <production task>`. BotMux's `allowedChatGroups` only limits chats; `owners` remain responsible for privileged operations.

## Intentionally Excluded

This branch only produces the narrow BotMux deployment handoff for a pre-existing local Coding Agent. It does **not** configure or expose BotMux Dashboard, Web Terminal, memory/RAG, multi-bot collaboration, scheduled jobs, proactive listeners, custom cards, plugins, workflow automation, sandbox policy, agent personas, prompts, tool selection, or model-provider routing. Those are BotMux/product decisions and must be separately approved and configured through BotMux upstream.

It also does not use a generic Agent folder as a substitute for a coding workspace. BotMux launches the selected CLI in `workspaceDir`; any `AGENTS.md`, `CLAUDE.md`, skills, repository policy, hooks, MCP configuration, and runtime dependencies must already be correct for that CLI before this bridge can create a production bot.
