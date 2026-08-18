# Feishu Agent Scaffold

把**已经适配本契约的本地 Agent 文件夹**接入飞书。服务启动后，用户在群里 `@Bot` 发送消息，或在私聊中发消息，脚手架把规范化请求交给 Agent，再把结果回复到原消息下。

本项目只做运行容器、飞书入口和模型网关。它**不会**分析、修正、重构或补全 Agent 的业务方向、提示词、工具调用、权限策略和依赖。Agent 文件夹不满足契约时，应该修 Agent，而不是让脚手架猜测意图。

## 能力范围

- 用 `lark-cli config init --new` 创建独立飞书开放平台应用，并以独立 `profile` 保存配置。
- 用 `lark-cli application +slash-command-create` 注册 Bot 斜杠命令。
- 用飞书官方 Node SDK 的 WebSocket 长连接接收消息、发送线程回复；生产运行时不调用 `lark-cli`。
- OpenAI-compatible 模型适配器：OpenAI、DeepSeek、Kimi K3、GLM、MiMo，以及任意自定义兼容端点。
- Anthropic Messages 适配器：Claude 系列。
- Image 2 生图适配器：Agent 返回自然语言生图请求，脚手架异步调用 Image 2 并把图片回复到飞书。
- Docker Compose 部署，以及 Agent 合约验证命令。

## 两种 Agent 模式

| 模式 | 入口 | 能做什么 | 不能做什么 | 权限边界 |
| --- | --- | --- | --- | --- |
| 最小 Agent 框架 + 自定义 Agent | `feishu-agent run --agent-dir ...`，或 LangBot 声明式部署 | 按 Agent 文件夹的 `createAgent()` 或已确定的 LangBot 提示词处理飞书消息 | 不会把普通 Agent 变成 Coding Agent，不会猜测工具、目录、提示词或权限 | Agent 提供方显式声明模型、依赖、凭据和权限 |
| 本地 Coding Agent | `feishu-agent codex run` | 搜索/查看/恢复本机 Codex 对话，并在批准的本地目录继续开发 | 不会访问未白名单目录，不会向未授权飞书用户暴露历史，不会自动批准 Codex 的操作 | 飞书 `union_id`（多 profile 推荐）或同应用 `open_id` 白名单 + 本机目录白名单 + 现有 Codex 审批/沙箱策略 |

这两种模式不能混淆。前者的最小合约在本 README 的“Agent 文件夹契约”；后者是机器管理员显式接入的本机开发能力，**不接受**任意上传的 Agent 文件夹或 GitHub 仓库来获得本机文件访问权。

## 本地 Codex Coding Agent 与历史地图

本机 Codex 的正确接入点是 `codex app-server --stdio`。脚手架通过它的 `thread/list`、`thread/read`、`thread/resume` 和 `turn/start` 调用历史与开发能力，不会把完整历史对话复制进普通模型提示词。

先构建历史地图。地图保存在本机 `CODEX_HOME/history-map.json`（默认 `~/.codex/history-map.json`），权限为仅当前用户可读写；它保存脱敏后的摘要、回合、文件变更、工具轨迹、fork/父子关系、主题和“记忆建议”，原始会话仍由 Codex 本地历史保存。地图是增量更新的，不会改变任何 Codex 会话的记忆设置。

```bash
# 首次执行会索引所有本地、含已归档的交互式会话；可先用 --limit 验证。
npx tsx src/cli.ts codex map sync
npx tsx src/cli.ts codex map search "飞书 agent"
npx tsx src/cli.ts codex map show 019ffb0a-849c-7240-a08f-ca975fe171c6
```

记忆标记含义：

- `required`：会话含文件变更、工具调用、分支关系或长开发上下文；继续开发前必须恢复该原线程。
- `checkpoint`：历史仍可恢复，地图持续记录变化；只在需要背景时恢复。
- `none`：没有可读的持久回合或会话是临时的；地图保留元数据并说明无法恢复的原因。

指定验收会话 `019ffb0a-849c-7240-a08f-ca975fe171c6` 会在 App Server 中以其本机标题、工作目录和 29 个可恢复回合出现。它是本功能的首个回归样本，而不是被复制到仓库的测试数据。

启动飞书 Coding Agent 前，机器管理员必须写出允许访问本机历史的飞书用户标识，以及允许开发的工作目录。多 application/profile 部署优先登记租户内稳定的 `union_id`；`open_id` 仅适用于用同一个飞书应用取得和接收事件的标识。不要用群成员列表、Bot 名称或 email 代替这些标识。

```bash
FEISHU_APP_ID=... FEISHU_APP_SECRET=... \
  npx tsx src/cli.ts codex run \
  --allow-union-id on_authorized_user \
  --allowed-root /absolute/path/to/workspace
```

在飞书中 @Bot 后可使用：

```text
/history sync
/history search <关键词>
/history show <thread-id>
/codex resume <thread-id> <开发任务>
/codex new <工作目录编号> <开发任务>
```

`/history search` 与 `/history show` 会在查询前增量同步本机历史；`show` 给出地图总览与最近三个有内容回合的脱敏摘录，用来判断是否应恢复上下文。完整、可继续的对话仍由本机 Codex 历史保存，使用 `resume` 回到原线程；不把原始全量对话复制到飞书或普通模型上下文。

`resume` 只会继续其 `cwd` 位于白名单内的既有线程，`new` 只能选择命令列出的编号目录。若原线程正被另一个 Codex 客户端写入，脚手架会从该线程创建一个新 fork 并明确回复新 ID，不会争抢原线程的写锁。脚手架保留本机 Codex 的审批和沙箱设置，绝不自动批准命令、文件写入或外部访问。若 Codex 请求人工审批，需在本机 Codex 客户端处理后再继续；这不是飞书 Bot 可以安全绕过的步骤。

## LangBot 原生接入

`langbot` 子命令仅接入 LangBot 当前的 **Lark Bot + Pipeline + local-agent runner**。它把 Agent 已确定的系统提示、模型 UUID 和运行限制生成 LangBot 可执行部署产物，不执行或改写 Agent 的 `index.mjs`，也不配置 LangBot 的 RAG、知识库、插件、MCP、工作流、管理台或其他渠道。

```bash
npx tsx src/cli.ts langbot validate --agent-dir examples/echo-agent
npx tsx src/cli.ts langbot generate --agent-dir examples/echo-agent --out ./generated/langbot-echo
```

详细的文件契约、真实 API 依据、部署命令和 `@Bot` 生产验证命令见 [docs/langbot.md](docs/langbot.md)。

`models.yaml` 只包含模型别名、端点和 API Key 环境变量名。真正的 Key 永远放在部署环境中。

LangBot 是本项目优先支持的 IM Agent 宿主之一：它覆盖多 IM、Pipeline、插件、MCP、RAG 与 AgentRunner Protocol v1。但开源生态没有可证明的“绝对最广泛”单一框架，本仓库不会作此声明。对于已确定职责的自定义 Agent，现有 `local-agent` 部署已足够；对于完整 Coding Agent，应使用 LangBot 的**进程外 AgentRunner**把受限的 Codex App Server 桥接进去。该桥接必须继承本文的 `union_id`/同应用 `open_id`、目录、审批、超时和密钥隔离边界，不能把 Codex 本机权限交给普通 LangBot Pipeline。

## 本地 Profile 控制台

控制台是只监听 `127.0.0.1` 的本地 Web UI，用于查看和维护两类后台 Profile：

- **Agent Profiles**：将一个 LangBot/Codex runtime 与 `lark-cli` application profile、Agent 源目录、部署产物目录绑定。LangBot Profile 可以依次执行预检、生成可审查产物、部署同步。
- **User Profiles**：从本机 `lark-cli` 配置读取已授权用户的显示名、所属 CLI Profile 和 token 状态。页面不会返回 App Secret、token、原始 `open_id`/`union_id` 或完整 App ID。

```bash
npm run control
# 默认打开 http://127.0.0.1:4318
```

首次启动会在 `~/.feishu-agent-scaffold/profiles.json` 使用默认的 `langbot-codex` Agent Profile；它只保存公开部署元数据。也可指定另一个本地 registry：

```bash
npx tsx src/cli.ts control --port 4318 --registry /absolute/path/to/profiles.json
```

控制台动作的边界是明确的：`Preflight` 只校验本地 Agent 契约；`Generate` 只重建 LangBot 请求产物，不发网络请求；`Sync` 才会执行已存在的 `deploy.mjs`，并要求在界面输入 `SYNC <profile-id>`。同步要求部署目录已有未提交的本地 `.env`，其内容仅由子进程读取，绝不返回给浏览器或写入审计日志。每次操作会写入同一目录的 `sync-log.json`，最多保存 100 条脱敏记录。

这不是飞书权限管理后台：创建/重新授权 `lark-cli` profile 仍使用受控的 CLI OAuth 流程；Bot 权限、应用发布和管理员审批仍在飞书开发者平台完成。

### Vercel 托管 UI

生产 UI 发布在 [feishu-profile-control.vercel.app](https://feishu-profile-control.vercel.app)。Vercel 只托管静态 HTML；浏览器从当前电脑连接 `http://127.0.0.1:4318`，所以 Profile、用户身份、审计日志和部署凭据不会上传到 Vercel。

使用托管 UI 前，在需要被控制的电脑启动 connector，并只允许生产域名：

```bash
npm run control -- \
  --port 4318 \
  --allow-origin https://feishu-profile-control.vercel.app
```

也可以通过环境变量持久配置，多个精确 Origin 用逗号分隔：

```bash
FEISHU_CONTROL_ALLOWED_ORIGINS=https://feishu-profile-control.vercel.app npm run control
```

非 HTTPS 的远端 Origin 会被拒绝；任意未列入白名单的页面访问 `/api/*` 会收到 `403`。生产 UI 已连接本仓库，推送 `main` 后 Vercel 自动执行 `npm run vercel-build`。该构建只把 `src/control/ui.ts` 编译为静态 `public/index.html`。

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

要只验证生图媒体链路而不放入真实 Image 2 Key：

```bash
AGENT_DIR=./examples/image2-agent IMAGE_PROVIDER=fake npm start
```

这会使用 fake provider 返回测试 PNG；它能验证飞书上传/回复路径，但不能证明 Image 2 生成质量或真实 API 可用。

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
- 入口模块必须导出 `createAgent(context)`；它返回一个带 `async handle(input)` 的对象。结果可以是文本，也可以包含一份生图请求：`{ text?: string, image?: { prompt, size?, quality? } }`。
- `context.llm.chat({ messages, model?, temperature?, maxTokens? })` 是模型入口。未传 `model` 时使用 manifest 的 `defaultModel`，再回退到 `models.yaml` 的 `defaultModel`。
- `triggers` 至少一个：`mention` 允许群 `@Bot`；`direct-message` 允许私聊。
- Agent 自己依赖的 npm 包、二进制、网络权限、持久化、工具凭据与安全策略必须在 Agent 交付时明确并可部署。脚手架不安装、猜测或修复它们。

参见可运行示例：[examples/echo-agent](examples/echo-agent) 和 [examples/image2-agent](examples/image2-agent)。

### 生图 Agent

`examples/image2-agent` 把飞书中的自然语言直接作为 Image 2 prompt。脚手架不替 Agent 改写提示词，也不额外调用聊天模型。运行时会先回复确认文本，再以飞书 `message_id` 做幂等键创建内存 Job，调用 Image 2，上传结果到飞书图片接口，并回复原消息。

当前 Job Store 只在进程内存中，重启后任务不会恢复；这是 V1 的明确边界，不应伪装成生产队列。

默认使用 `IMAGE_PROVIDER=image2`。本次不要求真实 API 凭证，未配置时收到生图请求会给出明确错误。要验证飞书图片上传链路，可设置 `IMAGE_PROVIDER=fake`；fake provider 只返回一张标记为测试的 1x1 PNG，不代表真实生图成功。

Image 2 适配器使用最小的 OpenAI Images-compatible 请求：`POST {IMAGE2_BASE_URL}/images/generations`，发送 `model`、`prompt`、`size`、`quality` 和 `n: 1`，并兼容 `b64_json` 或临时 `url` 响应。若 Image 2 实际协议不同，只需替换 `src/media/image2.ts`，不改飞书入口和 Agent 契约。

完整的 V1 范围、五步审视和真实验收门槛见 [docs/image2-v1.md](docs/image2-v1.md)。

### GitHub 仓库交付条件

GitHub 仓库不是另一种运行时协议。先用脚手架将一个**明确 ref** 检出到新目录，再选择一个子目录作为 `--agent-dir`；该目录仍必须满足同一份最小契约。不要把整个 monorepo、未锁定的默认分支或含环境凭据的目录直接作为 Agent 输入。

```bash
npx tsx src/cli.ts fetch-agent \
  --repo https://github.com/example/my-agent \
  --ref v1.2.3 \
  --out ./agents/my-agent-v1.2.3 \
  --agent-subdir agent
npx tsx src/cli.ts validate-agent --agent-dir ./agents/my-agent-v1.2.3/agent
```

`fetch-agent` 只接受无凭据的 HTTPS `github.com/owner/repository` URL，拒绝覆盖已有目录，禁用 Git hooks，并且不会安装依赖、运行安装脚本或执行仓库代码。`validate-agent` 会导入 Agent 入口来验证合约，因而只能在人工审查并满足依赖隔离条件后运行。

仓库交付必须额外提供：精确 commit/tag、Agent 子目录、Node/运行时版本与锁文件、安装命令、外部依赖清单、网络出口与数据处理说明。脚手架不会 `npm install`、执行安装脚本、克隆私有仓库或根据 README 猜测入口；这些工作必须由部署责任人先在隔离环境完成并验证。

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
6. 若输入来自 GitHub：固定 commit/tag、Agent 子目录、锁文件、安装命令和依赖清单分别是什么？是否已在隔离环境验证，而不是运行时临时安装？
7. 飞书需要哪些精确权限和事件订阅？是否已确认管理员可批准，且不会要求超出业务范围的用户数据访问？
8. 运行在哪里（本机、Docker、服务器、Kubernetes）？App Secret 与模型 Key 如何存储、轮换、审计？
9. 若启用本地 Coding Agent：已授权的飞书 `union_id`（或同应用 `open_id`）、允许工作目录、Codex 审批/沙箱策略、历史地图位置与数据留存责任人分别是谁？
10. 如何观测失败、限流、模型成本与用户投诉？谁负责停止 Bot、回滚版本和撤销权限？
11. GitHub 仓库的 owner、可见性、默认分支和协作者权限是否确认？仓库中不得出现任何真实密钥或用户数据。

任一项未解决时，停止创建/发布 Bot，记录缺失项后交还给项目负责人。这个停止条件是设计要求，不是脚手架可自动弥补的缺陷。

## 本地校验

```bash
npm run check
```

测试覆盖 Agent 默认模型注入、文本模型请求、Image 2 响应映射、Job 幂等、群聊/私聊触发策略和飞书图片消息编排。真实飞书发布仍需要租户内人工完成授权、权限配置、版本审批和一次 staging 对话验收。
