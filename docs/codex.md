# 本地 Codex 接入设计

本分支把 Codex 接到飞书时，使用本机 `codex app-server --stdio` 的 JSON-RPC，不使用浏览器自动化，也不把本机 Codex 的对话全文投喂给另一个模型。

## 数据流

```text
飞书 @Bot
  -> Coding Agent（union_id 或同应用 open_id 校验）
  -> 历史地图（本机、脱敏索引） -> codex app-server: thread/list + thread/read
  -> 恢复或创建会话（目录白名单） -> thread/resume/thread/start + turn/start
  -> Codex 本机审批和沙箱
  -> 飞书线程回复
```

历史地图用 JSON 保存，以保持 Node.js 20+ 无原生模块依赖。它是由 App Server 原始结构生成的“投影”，包括：会话元数据、回合摘要、文件变更、工具类别、父子/fork 关系、主题、地图水位和记忆建议。它不取代 Codex 的历史文件，也不修改 `thread/memoryMode`；真正恢复总是调用 `thread/resume`。

为避免复制敏感数据，地图会脱敏常见 API Key、App Secret 与 Authorization/Bearer 值，并限制每个会话的索引文本大小。它仍可能包含对话的业务信息，因此必须保留在本机受限目录，不能提交 Git，也不能上传给 LangBot、模型供应商或飞书。

飞书的 `/history search <关键词>` 与 `/history show <thread-id>` 每次都会先做一次增量同步；`show` 除恢复元数据外还包含最近三个有内容回合的脱敏摘录。飞书只承载这个受限投影，完整上下文继续由本地 Codex 历史提供，并在 `/codex resume` 时恢复到原线程或其安全 fork。

## LangBot 选择和限制

LangBot 的 AgentRunner Protocol v1 允许进程外运行器以 run-scoped Host API/MCP bridge 获取被授权的历史、工具和资产。其官方 `langbot-local-agent` 是 LangBot 托管模型的本地 runner，不代表它能任意访问用户电脑。

因此，本仓库的 `langbot` 子命令继续支持**声明式、自定义 Agent**：确定的系统提示、模型 UUID、回退模型和运行限额。完整 Codex Coding Agent 采用本目录的独立 bridge 核心，并且在接入 AgentRunner 时必须保持同样的 `union_id`/同应用 `open_id` 用户白名单和目录边界。不能通过 LangBot Pipeline、RAG、插件或 MCP 配置来扩大本机 Codex 的权限。

上游状态在实现时已核验：LangBot AgentRunner Protocol v1 及其 4.11.x 相关集成仍在快速演进。部署前必须固定并联测 LangBot、Plugin SDK 和 runner 的兼容版本；本仓库不将当前开发分支当成永久稳定 ABI。
