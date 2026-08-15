# LangBot 原生 Agent 接入

本集成把一个**已经确定职责和提示词**的 Agent 文件夹配置为 LangBot 的飞书/Lark Bot。它只生成和部署 LangBot 的 Lark Bot、Pipeline 与 `local-agent` runner 配置；不实现 LangBot 的管理台、RAG、知识库、插件市场、MCP、工作流或其他 IM 渠道。

## 上游接口依据

本集成依据 LangBot `master` 的提交 [`1f1a3aff55d828ac2ccc51b2f3ec6b0e78c0a56b`](https://github.com/langbot-app/LangBot/tree/1f1a3aff55d828ac2ccc51b2f3ec6b0e78c0a56b) 实现。

- [Lark 适配器声明](https://github.com/langbot-app/LangBot/blob/1f1a3aff55d828ac2ccc51b2f3ec6b0e78c0a56b/src/langbot/pkg/platform/sources/lark.yaml) 要求 `app_id`、`app_secret`、`bot_name`，支持 `https://open.feishu.cn` 与 `https://open.larksuite.com`，默认使用 WebSocket 长连接，可开启流式回复。
- [Lark 运行代码](https://github.com/langbot-app/LangBot/blob/1f1a3aff55d828ac2ccc51b2f3ec6b0e78c0a56b/src/langbot/pkg/platform/sources/lark.py) 以 `bot_name` 作为 `bot_account_id`，供 @Bot 规则匹配。
- [默认 Pipeline](https://github.com/langbot-app/LangBot/blob/1f1a3aff55d828ac2ccc51b2f3ec6b0e78c0a56b/src/langbot/templates/default-pipeline-config.json) 使用 `ai.runner.runner: local-agent`，并以 `trigger.group-respond-rules.at: true` 响应群内 @Bot。
- [Pipeline HTTP API](https://github.com/langbot-app/LangBot/blob/1f1a3aff55d828ac2ccc51b2f3ec6b0e78c0a56b/src/langbot/pkg/api/http/controller/groups/pipelines/pipelines.py) 提供 `GET/POST /api/v1/pipelines` 和 `GET/PUT /api/v1/pipelines/{uuid}`；[Bot HTTP API](https://github.com/langbot-app/LangBot/blob/1f1a3aff55d828ac2ccc51b2f3ec6b0e78c0a56b/src/langbot/pkg/api/http/controller/groups/platform/bots.py) 提供 `GET/POST /api/v1/platform/bots` 和 `PUT /api/v1/platform/bots/{uuid}`。

因此这里的“已有 Agent 接入”是**LangBot 原生的声明式 Agent**：确定的系统提示 + 已在 LangBot 创建好的模型 UUID。LangBot 的 `local-agent` 并不会执行本仓库 `index.mjs` 中的 `createAgent()` 代码。该代码仍可给本仓库的 `run` 命令使用，但不能被本集成当作 LangBot 插件或任意代码执行器。

## Agent 文件夹条件

在已有脚手架契约的基础上，Agent 文件夹还必须包含 `langbot.agent.json`：

```text
my-agent/
├── agent.manifest.json
├── index.mjs
└── langbot.agent.json
```

```json
{
  "schemaVersion": 1,
  "modelUuid": "LangBot 管理界面中已创建模型的 UUID",
  "fallbackModelUuids": [],
  "systemPrompt": "已经确定、可直接交给模型的系统提示词",
  "timeoutSeconds": 300,
  "maxRounds": 10,
  "removeThink": false,
  "bot": {
    "botName": "必须与飞书已发布机器人名称完全一致",
    "domain": "https://open.feishu.cn",
    "streamReply": true
  },
  "pipeline": {
    "name": "唯一且稳定的 LangBot Pipeline 名称",
    "description": "该 Agent 的职责说明"
  }
}
```

必须满足：模型 UUID 已在目标 LangBot Workspace 可用；系统提示、模型、回退模型和运行时限制已经由 Agent 提供方确定；`botName` 与飞书应用后台的 Bot 名称一致；目标 LangBot 实例已有能管理资源的 API Key。

不能接入：需要运行 `index.mjs`、本地 CLI、浏览器自动化或未声明工具的 Agent；需要脚手架选择提示词、推断模型或改正业务方向的 Agent；需要 RAG、插件、MCP、工作流等 LangBot 功能才能定义其基本职责的 Agent。这些是上游额外能力，当前分支不配置。

## 生成与部署

先校验并生成可审查产物，两个命令都不会联系 LangBot 或飞书：

```bash
npx tsx src/cli.ts langbot validate --agent-dir examples/echo-agent
npx tsx src/cli.ts langbot generate --agent-dir examples/echo-agent --out ./generated/langbot-echo
```

生成目录包含：

- `pipeline-create.request.json`：创建 Pipeline 的真实 API 请求体。
- `pipeline-config.patch.json`：只管理本 Agent 的触发规则、`local-agent` 模型、提示词和输出设置；部署脚本会与服务器现有 Pipeline 配置深度合并。
- `bot.request.json`：真实 `lark` Bot 请求体，凭证位置保留为环境变量占位符。
- `deploy.mjs`：显式执行时调用 LangBot API，按名称创建或更新 Pipeline 和 Bot。

审查生成结果后：

```bash
cd generated/langbot-echo
cp .env.example .env
# 填入 LANGBOT_API_URL、LANGBOT_API_KEY、FEISHU_APP_ID、FEISHU_APP_SECRET
set -a; source .env; set +a
node deploy.mjs
```

`deploy.mjs` 使用 `Authorization: Bearer $LANGBOT_API_KEY` 调用 LangBot。它会写入 LangBot 资源，所以必须由拥有目标 Workspace 权限的操作者执行；脚手架的生成与测试不会替用户执行它。

## 进入飞书生产

部署脚本不会代替飞书完成应用创建、Bot 能力启用、权限申请、`im.message.receive_v1` 事件订阅、长连接设置、版本发布和管理员审批。完成这些飞书侧前置后，将 Bot 加入目标群并实际验证：

```text
@Echo Agent 请只回复 OK
```

这会走 LangBot 的 Lark 长连接、@Bot 触发规则和 `local-agent` Pipeline。先在测试群验证，再扩大应用可见范围。
