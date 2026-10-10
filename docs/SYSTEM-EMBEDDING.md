# 系统默认向量搜索

默认模型为 `qwen3.7-text-embedding`，北京地域、1024 维。系统为现有和新账号自动准备独立索引，历史搜索默认开启语义检索。用户无需添加向量连接、提供 Key 或选择向量模型；设置页只显示搜索服务状态。对话模型仍使用用户自己的连接配置。

## 后端配置

- `SYSTEM_EMBEDDING_MODEL`：默认 `qwen3.7-text-embedding`。
- `SYSTEM_EMBEDDING_REGION`：默认 `cn`，须与运营方 Key 的地域一致。
- `SYSTEM_EMBEDDING_DIMENSIONS`：默认 `1024`。
- `SYSTEM_EMBEDDING_API_KEY`：可通过服务端环境变量提供，配置类型使用 `SecretStr`。
- `SYSTEM_EMBEDDING_KEY_FILE`：默认 `.runtime/system-embedding.key`，保存使用应用 Fernet 主密钥加密后的 Key。环境变量 Key 优先。

本地已将提供的 Key 导入后端加密运行时文件；原始 `千问key.txt` 和运行时目录均由 Git 忽略。Key 不复制到用户连接记录，不返回给浏览器，也不能通过用户的默认对话模型接口选用。生产环境配置入口为 `production.env.example` 与 `compose.production.yaml`。

系统 Key 和 Fernet 主密钥必须另行备份；它们不包含在数据库 dump 中。恢复时没有系统 Key，关键词搜索仍可使用。

## 索引与用量

每个账号拥有自己的 `embedding_profiles` 和 `search_chunks`，继续受 PostgreSQL RLS 保护。系统索引的 `connection_id` 为 NULL，用户自有索引继续关联用户连接。新迁移 `c314ec08a291` 允许此字段为空；回退只清除系统派生索引，不删除原任务及历史事件。

worker 每批最多处理 20 条缺少向量的有效历史记录，通过一次模型请求批量生成向量。查询也只检索当前账号的数据。新增历史增量更新，已索引记录不重复调用。数据移入垃圾站、永久删除或遗忘后继续遵守原有过滤与派生清理规则。

索引和语义查询计入账号的后台调用／Token 保护额度，分别记录为 `embedding` 与 `embedding-query`；模型测试和主动对话仍单独记录。当前保守预留量不是厂商实收账单。历史较多时按每日额度逐步准备；达到额度或服务不可用时回到关键词搜索，索引失败作业遵守既有重试与次日恢复机制。

## 本地验证

- 真实 Key 调用 `qwen3.7-text-embedding` 成功，返回 1024 维向量。
- 测试账号未添加用户连接，索引状态为 ready；查询“采购食品”返回混合检索，首项是“买牛奶和水果”。
- 新增后端回归覆盖自动初始化、增量批量索引、租户隔离、凭据不公开、请求协议、额度阻断、服务失败降级和异常维度不发布。
- 完整后端 55 项通过，前端类型检查和生产构建通过；浏览器完整结果见 [验收说明](P1-P4-ACCEPTANCE.md)。
- Git 可跟踪文件扫描未发现提供的真实 Key；自动测试使用假 Key，并禁用本地真实凭据文件。

此次真实联调仅证明向量接口可用，未替代对话模型、正式邮件或生产环境验收。
