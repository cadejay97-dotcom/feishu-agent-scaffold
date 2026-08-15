# CountBot Agent Bridge

This branch connects an already installed local coding Agent to Feishu through CountBot's native external-agent routing. It does not configure CountBot personas, models, tools, RAG, memory, teams, schedules, dashboard, or any other CountBot product capability.

## Upstream Contract

The bridge targets CountBot `main` as inspected on 2026-08-15:

- [`FeishuAccountConfig`](https://github.com/countbot-ai/CountBot/blob/main/backend/modules/config/schema.py) accepts `app_id`, `app_secret`, multiple `accounts`, `allow_from`, `routing_mode`, and `external_coding_profile`.
- [`POST /api/channels/update`](https://github.com/countbot-ai/CountBot/blob/main/backend/api/channels.py) validates, persists, and reloads the configured channel.
- [`ExternalAgentRegistry`](https://github.com/countbot-ai/CountBot/blob/main/backend/modules/external_agents/registry.py) reads `<workspace>/external_coding_tools.json`; its built-in Codex and Claude profiles define the `cli` shape generated here.
- [`MessageHandler`](https://github.com/countbot-ai/CountBot/blob/main/backend/modules/channels/handler.py) routes an account with `routing_mode: "direct"` to `external_coding_profile`.

## Agent Declaration

Put `countbot.agent.json` beside `agent.manifest.json`; see [the example](../examples/echo-agent/countbot.agent.json).

- `workspaceDir` is CountBot's configured workspace and must exist before validation/deployment.
- `profile` is a CountBot `external_coding_tools.json` CLI profile. The CLI must already be installed and authenticated on the CountBot host.
- Only upstream template variables such as `{prompt}`, `{working_dir}`, and `{session_id}` are accepted.
- `allowFrom` is mandatory. The generated Feishu Bot is not a public execution endpoint.

## Generate and Deploy

```bash
npx tsx src/cli.ts countbot validate --agent-dir examples/echo-agent
npx tsx src/cli.ts countbot generate --agent-dir examples/echo-agent --out ./generated/countbot-codex
cd generated/countbot-codex
cp .env.example .env
set -a; source .env; set +a
node deploy.mjs
```

The deploy script merges only its named profile into `external_coding_tools.json`, then calls the channel-update API with `routing_mode: "direct"`. It does not overwrite other profiles or accounts. A remote CountBot needs an authenticated `COUNTBOT_API_TOKEN`; loopback deployments use CountBot's local-only API access.

Complete Feishu platform setup separately: enable Bot, persistent connection, `im.message.receive_v1`, scopes, release, and tenant approval. Add the Bot to an authorized group, then send `@Codex Production Agent <task>` from an ID in `allowFrom`.

## Excluded Scope

No CountBot teams, model routing, skills, memory, tools, browser, shell policy, or dashboard configuration is included. The external CLI Agent and its workspace must already be production-ready.
