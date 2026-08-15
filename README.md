# Feishu Agent Scaffold

把**已经适配本契约的本地 Agent 文件夹**接入飞书。服务启动后，用户在群里 `@Bot` 发送消息，或在私聊中发消息，脚手架把规范化请求交给 Agent，再把结果回复到原消息下。

本项目只做运行容器、飞书入口和模型网关。它**不会**分析、修正、重构或补全 Agent 的业务方向、提示词、工具调用、权限策略和依赖。Agent 文件夹不满足契约时，应该修 Agent，而不是让脚手架猜测意图。

## 能力范围

- 用 `lark-cli config init --new` 创建独立飞书开放平台应用，并以独立 `profile` 保存配置。
- 用 `lark-cli application +slash-command-create` 注册 Bot 斜杠命令。
- 用飞书官方 Node SDK 的 WebSocket 长连接接收消息、发送线程回复；生产运行时不调用 `lark-cli`。
- OpenAI-compatible 模型适配器：OpenAI、DeepSeek、Kimi K3、GLM、MiMo，以及任意自定义兼容端点。
- Anthropic Messages 适配器：Claude 系列。
- Docker Compose 部署，以及 Agent 合约验证命令。

另有仅面向已有本地 Coding Agent 的 [CountBot bridge](docs/countbot.md)。它生成 CountBot 原生的 `external_coding_tools.json` profile 及飞书 direct-routing 配置，让飞书 `@Bot` 直接交给已安装、已认证的 Codex、Claude 等 CLI；不会配置 CountBot 的模型、记忆、团队、RAG、工具或管理台。

`models.yaml` 只包含模型别名、端点和 API Key 环境变量名。真正的 Key 永远放在部署环境中。

## 快速开始

需要 Node.js 20+、`lark-cli`，并已为当前飞书租户完成 CLI 配置。

```bash
git clone <your-repository-url>
cd feishu-agent-scaffold
npm ci
cp .env.example .env
```

把 `.env` 中的 `AGENT_DIR` 指向已通过下方契约的 Agent 文件夹；选择一个模型并填写其 API Key。先验证 Agent：

```bash
npx tsx src/cli.ts validate-agent --agent-dir "$AGENT_DIR"
```

创建飞书应用并注册命令。`profile` 必须是新名称，避免覆盖现有飞书应用配置：

```bash
npx tsx src/cli.ts bootstrap --profile my-agent-bot --slash-command agent --slash-description "向 Agent 提问"
```

该命令会打开飞书的应用创建/授权流程。完成后，从新建应用的开发者后台取得 App ID 与 App Secret，填写至 `.env` 的 `FEISHU_APP_ID`、`FEISHU_APP_SECRET`。随后在同一应用后台完成以下平台必需步骤：

1. 启用 **Bot** 能力。
2. 配置应用身份所需的消息权限，至少包括接收 `im.message.receive_v1` 与回复消息所需权限。
3. 启用长连接（WebSocket）事件订阅，订阅 `im.message.receive_v1`。
4. 创建版本、申请所需权限并发布；企业管理员审批是飞书平台权限，不能由本仓库绕过。

最后运行：

```bash
npm run build
npm start
```

在群聊中 `@Bot` 即可触发；私聊是否触发由 Agent manifest 的 `triggers` 决定。

## Docker 部署

先在 `.env` 填入 App 凭证、模型 Key，以及 Agent 文件夹的**绝对路径**：

```bash
docker compose up --build -d
docker compose logs -f
```

Agent 文件夹通过只读 volume 挂载。不要把 `.env`、模型 Key 或 App Secret 提交到 Git。

## Agent 文件夹契约

一个合格的 Agent 文件夹至少包含：

```text
my-agent/
├── agent.manifest.json
└── index.mjs
```

`agent.manifest.json` 必须严格符合：

```json
{
  "schemaVersion": 1,
  "name": "Agent 显示名",
  "description": "Agent 的明确职责",
  "entry": "index.mjs",
  "triggers": ["mention", "direct-message"],
  "defaultModel": "deepseek-chat"
}
```

- `schemaVersion` 目前只能为 `1`。
- `entry` 必须是 Agent 文件夹内部的 ES module，禁止 `../` 越界。
- 入口模块必须导出 `createAgent(context)`；它返回一个带 `async handle(input)` 的对象，结果必须是 `{ text: string }`。
- `context.llm.chat({ messages, model?, temperature?, maxTokens? })` 是模型入口。未传 `model` 时使用 manifest 的 `defaultModel`，再回退到 `models.yaml` 的 `defaultModel`。
- `triggers` 至少一个：`mention` 允许群 `@Bot`；`direct-message` 允许私聊。
- Agent 自己依赖的 npm 包、二进制、网络权限、持久化、工具凭据与安全策略必须在 Agent 交付时明确并可部署。脚手架不安装、猜测或修复它们。

参见可运行示例：[examples/echo-agent](examples/echo-agent)。

## 不接收的 Agent 文件夹

以下任一情况都不能通过本脚手架建 Bot，必须先由 Agent 提供方修复：

- 没有 manifest、字段不完整、入口文件不存在，或入口逃逸到 Agent 文件夹之外。
- 没有 `createAgent(context)` 或没有异步 `handle(input)`。
- 要求脚手架推断业务角色、补写系统提示词、挑选工具、修正工作流或“让它自己决定做什么”。
- 依赖未声明的数据库、浏览器、系统服务、私有网络、文件路径或人工交互。
- 要求把 API Key、App Secret、用户数据写死进仓库或 Agent 源码。
- 模型接口不是 OpenAI-compatible 或 Anthropic Messages，且没有提供可验证的适配规范。
- 依赖未获授权的飞书权限、跨租户数据访问，或无法说明数据留存与模型供应商数据处理方式。

## 模型配置

`models.yaml` 定义别名。对于绝大多数国内外模型，使用 `openai-compatible` 即可：

```yaml
my-model:
  provider: openai-compatible
  model: vendor-model-id
  baseUrl: https://vendor.example/v1
  apiKeyEnv: VENDOR_API_KEY
```

Claude 使用：

```yaml
claude:
  provider: anthropic
  model: claude-sonnet-4-6
  baseUrl: https://api.anthropic.com
  apiKeyEnv: ANTHROPIC_API_KEY
```

如供应商修改请求/响应结构，先在该 Agent 交付中提供适配说明或扩展 Provider；不要伪装成兼容接口后再排障。

## 将仓库交给搭建 Agent 前的必答清单

只有以下问题全部有明确、可执行答案，才可以用脚手架创建 Bot：

1. 目标飞书租户、应用名称、应用可见范围、发布审批人分别是谁？是企业自建应用还是商店应用？
2. 要接入的 Agent 文件夹绝对路径是什么？它是否已按本 README 的 manifest 和入口契约通过 `validate-agent`？
3. Agent 的职责边界、可处理/不可处理的任务、群聊与私聊触发方式是什么？这些应已经写在 Agent 内，而非由脚手架补全。
4. 使用哪个模型别名、供应商、地区端点、模型版本、Key 注入方式和故障回退策略？供应商的数据保留/合规要求是否已确认？
5. Agent 依赖哪些外部系统、工具、数据库、网络出口和凭据？这些依赖是否在部署环境可用并已最小授权？
6. 飞书需要哪些精确权限和事件订阅？是否已确认管理员可批准，且不会要求超出业务范围的用户数据访问？
7. 运行在哪里（本机、Docker、服务器、Kubernetes）？App Secret 与模型 Key 如何存储、轮换、审计？
8. 如何观测失败、限流、模型成本与用户投诉？谁负责停止 Bot、回滚版本和撤销权限？
9. GitHub 仓库的 owner、可见性、默认分支和协作者权限是否确认？仓库中不得出现任何真实密钥或用户数据。

任一项未解决时，停止创建/发布 Bot，记录缺失项后交还给项目负责人。这个停止条件是设计要求，不是脚手架可自动弥补的缺陷。

## 本地校验

```bash
npm run check
```

测试覆盖 Agent 默认模型注入、OpenAI-compatible 请求和 Anthropic Messages 请求。真实飞书发布需要租户内人工完成授权、权限配置和版本审批。
