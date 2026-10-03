# 仓库盘点

盘点日期：2026-10-03。"观察"指仓库里能直接看到的事实；"推断"是判断，需要确认。

## 现状

| 层 | 观察 | 评价 |
|---|---|---|
| 意图 | 只有 `README.md` 第一句 | 缺 |
| 决策 | 没有 ADR | 缺 |
| 架构 | 没有文档；代码显示是 Rust 本机服务 + Chrome 扩展 + espeak-ng + ONNX 模型 + SQLite | 缺 |
| 契约 | 无 OpenAPI；路由在 `src/server.rs` 的 `router()`；数据库迁移在 `src/store.rs` | 部分 |
| 规格 | 没有 | 缺 |
| 实现 | `src/` 按 `align`、`wav`、`espeak`、`asr`、`ecdict`、`store`、`server` 分模块 | 好 |
| 验证 | JS/Rust 行、函数 100% 覆盖门槛；属性测试；Stryker、cargo-mutants；`tests/cli.rs` 与 ONNX 夹具 | 很好 |
| CI | 没有 `.github/`，只能本机手动跑 | 缺 |
| 运维 | 没有 runbook；安装靠 README 命令 | 缺（本机工具，只需简短的安装排障说明） |
| AI 规则 | 本次新增 `AGENTS.md` | 已补 |

## 重复或冲突的来源（观察）

- 端口 `17321` 同时写在 `src/paths.rs`、`extension/manifest.json`、`extension/sidepanel.js`（已处理：不同语言无法共用一个来源，改由 `src/consistency.rs` 的测试对齐）。
- 版本号：`Cargo.toml` 与 `extension/manifest.json` 曾不一致（已处理：对齐到 0.2.0，并由同一个测试检查）。
- HTTP 接口只在代码里；扩展端与测试各自假设响应形状。

## 高风险

1. **本机接口的跨域策略（已处理）**：原先 `CorsLayer::permissive()` 让任何网页都能调用本机接口，已按 `docs/adr/ADR-0001-local-api-access-control.md` 收紧。
2. **许可证（观察 + 待确认）**：仓库没有 `LICENSE`。模型是 `facebook/wav2vec2-lv-60-espeak-cv-ft`（`tools/export_onnx.py`），`assets/vocab.json` 由它而来，许可证待核对原始模型卡；`espeak-ng` 以外部进程调用，其许可证待确认；ECDICT 为 MIT，已保存许可证副本。
3. **分发（推断）**：扩展必须配合本机程序，还要自己导出模型，普通用户难以安装。这决定能否"给别人用"，值得写成 ADR。

## 待补清单（按优先级）

1. ~~收紧本机接口的跨域策略~~（已完成，ADR-0001）。
2. ADR：本机服务 + 扩展的架构、音素模型、发音合成、SQLite 迁移。每条的历史理由无法确认的部分标"待确认"。
3. ~~端口、版本号归为单一来源~~（已完成，见 `src/consistency.rs`）。
4. 从已验证的路由和测试响应推导 `contracts/openapi/openapi.yaml`，并加校验。
5. 简短 PRD；评分对齐、录音流程两份 Spec。
6. GitHub Actions：`npm test`、`cargo test`、覆盖率。
7. 开源前：`LICENSE`、`CONTRIBUTING.md`、第三方许可证清单、分发方案。

暂时不做：`infra/`、`observability/`、SLO。这是本机工具，这些没有对应的实物。
