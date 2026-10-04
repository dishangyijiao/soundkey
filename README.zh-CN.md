# SoundKey

[English](README.md) | 简体中文

摘下一句，朗读，看哪个音没读准。

## 准备

本机需要 `espeak-ng`。音素模型第一次导出：

```bash
cargo run --release -- setup
```

首次使用生词查询前，安装本地 ECDICT 词库（需要网络和 `curl`）：

```bash
cargo run --release -- setup-dict
```

命令会显示下载体积，并把只含单词、音标、中文释义和词形字段的 SQLite 词库写入应用数据目录；ECDICT 上游提供约 76 万条基础词目，按 [MIT 许可](https://github.com/skywind3000/ECDICT/blob/master/LICENSE) 使用，许可证副本会保存在本机。

## 运行

```bash
cargo run --release -- serve
```

Chrome 打开 `chrome://extensions`，打开开发者模式，加载已解压的扩展，选这个项目里的 `extension` 目录。打开 YouTube 后点扩展图标，右侧就是 SoundKey。

程序听在 `http://127.0.0.1:17321`。卡片和录音保存在 `~/Library/Application Support/soundkey/`。如果你用过旧名称，需要把旧目录移动一次，见 [ADR-0007](docs/adr/ADR-0007-rename-internal-identifiers-to-soundkey.md)。

## 开发与测试

按 TDD 开发：先写会失败的测试，再写刚好让它通过的实现，最后重构。行为改动没有对应的测试，就不合并。

```bash
cargo test          # Rust：单元测试 + tests/cli.rs（真实启动二进制）
npm test            # 扩展：jsdom / vm 里跑真实的扩展脚本
npm run coverage    # 门槛：JS 的行、分支、函数和 Rust 的行、函数都必须是 100%
python3 -m unittest tools.test_check_markdown_links
python3 tools/check_markdown_links.py
```

- Rust 覆盖率用 [`cargo-llvm-cov`](https://github.com/taiki-e/cargo-llvm-cov)（`cargo install cargo-llvm-cov`）。`?` 产生的错误分支只统计区域覆盖率，不设门槛，因为要靠损坏 SQLite 或文件系统才触发得到。
- 测试需要本机有 `espeak-ng`。没有时依赖它的测试会直接失败，而不是悄悄跳过。
- 不下载真实模型：`tests/fixtures/*.onnx` 是两个极小的 ONNX 夹具，用 `python tools/make_test_model.py` 重新生成（需要 `onnx`）。
- `tests/cli.rs` 用 `HOME` 指向临时目录，并通过 `SOUNDKEY_PORT`、`SOUNDKEY_ROOT`、`SOUNDKEY_ECDICT_URL` 把端口、导出环境和词库下载换成本地的东西，不碰网络，也不碰你的真实数据。
- 变异测试检查测试是不是真的在断言：`npm run mutate`（JS，Stryker）、`npm run mutate:rust`（Rust，cargo-mutants）。

## 与 AI 代理协作

`AGENTS.md` 是给 AI 代理的规则（`CLAUDE.md` 引用它）。`docs/README.md` 说明各类事实放在哪里，`docs/status.md` 记录还缺什么，`docs/glossary.md` 解释术语。文档和代码都用英文写，这份中文 README 只是对照版本。
