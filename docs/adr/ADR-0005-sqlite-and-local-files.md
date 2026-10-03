# ADR-0005: 用 SQLite 存卡片、生词和词典，录音存成文件，按 user_version 做迁移

## Status

Accepted（补记，2026-10-03）

## Context

要持久保存：句子卡片、每次跟读的评分、生词本，以及查词用的词典。

仓库里能确认的事实：

- 数据库是 `rusqlite`（带 `bundled`，随程序编译进去）打开的 `cards.sqlite`，位于 `~/Library/Application Support/fengsong/`。
- 录音是 WAV 文件，放在同目录的 `audio/` 下；数据库里只存路径和评分 JSON（`attempts.audio_path`、`score_json`）。
- 词典（ECDICT）导入到同一个 `cards.sqlite`，在一个事务里整体重建，导入失败时保留旧词典（`src/ecdict.rs`）。
- 库的结构版本记在 SQLite 的 `user_version`，目前是 2；遇到更高版本会拒绝打开，不去猜（`src/store.rs` 的 `Store::open`）。
- 生词用 `deleted_at` 软删除，并有只覆盖未删除记录的部分索引。

为什么这样选：待确认。推断：单用户本机应用，SQLite 零配置、单文件。没有文字依据。

## Decision

- 结构化数据全部放 SQLite，音频放文件。
- 结构变更只能追加新版本，按 `user_version` 顺序执行，每一步在一个事务里。
- 打开比自己更新的库时报错，不降级、不覆盖。

## Alternatives Considered

历史上比较过哪些方案：待确认，仓库里没有记录。

## Consequences

### Positive

- 单个文件，备份和迁移都简单。
- 迁移有测试，包括拒绝未来版本。

### Negative

- 迁移只能向前；想回退到旧版本程序，要自己备份数据库。
- 词典和卡片同库，词典导入时会重建表，体量大（约 77 万条）。

### Risks

- 没有迁移的自动备份，一次出错的升级可能损坏用户数据。

## Related

- ADR-0002
- 实现：`src/store.rs`、`src/ecdict.rs`
- 结构的唯一来源：`src/store.rs` 的迁移，不要在文档里另写一份
