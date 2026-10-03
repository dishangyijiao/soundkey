# 文档与事实来源

原则：一个事实只有一个来源，其他地方引用它，不复制它。
仓库记录"应该是什么样"；运行时的实际状态以本机进程和日志为准。

## 事实在哪里

| 问题 | 来源 | 状态 |
|---|---|---|
| 为什么做这个、给谁用 | `README.md` 第一句 | 只有一句，缺 PRD |
| 为什么这样选型 | `docs/adr/` | 还没有，见 `inventory.md` |
| HTTP 接口 | `src/server.rs` 里的路由和 `src/server.rs` 的测试 | 暂无 OpenAPI，计划推导一份 |
| 数据结构 | `src/store.rs` 里按 `user_version` 排序的迁移 | 规范，保持 |
| 评分对齐的行为 | `src/align.rs` 及其测试 | 暂无 Spec |
| 扩展行为 | `extension/*.js` 及 `test/*.test.js` | 以测试为准 |
| 端口 | `src/paths.rs` 的 `PORT` | `manifest.json`、`sidepanel.js` 另有 2 处重复 |
| 扩展版本 | `extension/manifest.json` | 和 `Cargo.toml` 版本号不一致 |
| 怎么安装、运行、测试 | `README.md`、`package.json` scripts | 规范 |
| 交付流程 | 无 CI | 缺 |
| 给 AI 的工作规则 | `AGENTS.md` | 规范 |

状态为"缺"或"重复"的项，详见 `inventory.md`，按优先级逐个补，不一次做完。

## 约定

- 机器可验证的事实用结构化或可执行的形式（迁移、OpenAPI、测试），Markdown 只解释它们。
- ADR 一旦 Accepted 就不改历史；决策变了就新建一条，旧的标 `Superseded by`。
- 确认不了的理由写"待确认"，不编造。
