# SoundKey

[English](README.md) | 简体中文

摘下一句，朗读，看哪个音没读准。

## 它做什么

你在 YouTube 上看英文视频，有一句听不清。SoundKey 是一个 Chrome 侧边栏，可以让你：

1. 摘下那一句字幕（整句，即使 YouTube 把它切成了几段），
2. 再听一遍那一刻的原声，
3. 对着麦克风朗读这一句，
4. 逐个音素（最小的语音单位）看哪些音和标准读音不一致，并标出含有这些音的单词，
5. 点任意一个词，看音标和中文释义，并存进生词本。

一切都在你自己的电脑上运行：一个小的 Rust 程序在 `127.0.0.1:17321` 提供侧边栏需要的服务。界面文字是中文。

## 前置条件

- **macOS**。只在这一个系统上用过；数据目录在所有系统上都是 `~/Library/Application Support/soundkey/`，没有在 Linux 或 Windows 上测试过。
- 桌面版 **Google Chrome**，以及带英文字幕的 YouTube 视频。
- **Rust**（构建和运行程序）和 **Node.js**（只用来跑测试）。
- **`espeak-ng`**，用来生成标准读音（`brew install espeak-ng`）。
- **[`uv`](https://docs.astral.sh/uv/)** 和网络，用于一次性的 `setup`：它会建一个 Python 3.12 环境，安装 PyTorch、`transformers` 和 `onnx`，下载发音模型并导出。导出的模型文件约 **1.2 GB**，安装过程需要更多空间。
- 一个麦克风，以及允许扩展使用它。

## 准备

本机需要 `espeak-ng`。音素模型第一次导出（这一步最久）：

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

## 局限

- 这是个人项目，不是成品，也**不在 Chrome 应用商店里**：需要你自己加载 `extension` 文件夹。
- 打分是拿你的声音和**合成的标准读音**比，不是和视频里的说话人比，也没有和真人评判对照过。把它当作"哪些音值得再听一遍"的提示，不要当成成绩。
- 只支持 YouTube，一次一句，不教语法和词汇。
- 使用时不会向任何地方发送数据。只有一次性的 `setup` 和 `setup-dict` 会下载东西（模型、Python 包、词典）。

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

## 许可证

你可以任选下面两种许可证之一使用本项目：

- Apache License, Version 2.0（[LICENSE-APACHE](LICENSE-APACHE)）
- MIT license（[LICENSE-MIT](LICENSE-MIT)）

除非你明确另行声明，你按 Apache-2.0 许可证的定义有意提交到本项目的任何贡献，都按上述双许可证授权，不附加任何其他条款或条件（英文版 README 有原文）。

SoundKey 不包含也不再分发 `espeak-ng`、音素模型和 ECDICT 词典，需要你自己安装或下载，并遵守它们各自的许可证，见[第三方组件清单](docs/security/third-party-components.md)。
