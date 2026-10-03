# ADR-0003: 用 wav2vec2 音素模型，导出成 ONNX，在 Rust 里推理

## Status

Accepted（补记，2026-10-03）

## Context

评分需要把用户录音识别成音素序列，再和标准音素对照。

仓库里能确认的事实：

- 模型是 `facebook/wav2vec2-lv-60-espeak-cv-ft`（`tools/export_onnx.py` 的 `MODEL_ID`）。
- 导出脚本只在安装时用一次，"Runtime does not use this script"，由 `fengsong setup` 调用，需要 Python 和 PyTorch（`tools/export_onnx.py`）。
- 运行时由 Rust 用 `ort` 加载 `model.onnx`（`src/asr.rs`），输出 logits 后做贪心 CTC 解码。
- 词表 `assets/vocab.json` 编进程序（`include_str!`），模型文件本身放在应用数据目录，不进仓库。

为什么选这个模型：待确认。推断：模型名里的 `espeak` 说明它的输出标签就是 espeak 风格的音素，和 ADR-0004 里 espeak-ng 给出的标准音素能直接对齐。没有文字依据。

## Decision

- 识别用 wav2vec2 音素模型，不用语音转文字。
- 先离线导出成 ONNX，运行时只依赖 `ort`，不依赖 Python。
- 模型不进仓库，用户首次运行 `cargo run --release -- setup` 自己导出。

## Alternatives Considered

历史上比较过哪些方案：待确认，仓库里没有记录。

## Consequences

### Positive

- 运行时是单个 Rust 程序，没有 Python 常驻。
- 测试用两个很小的 ONNX 夹具（`tests/fixtures/`），不需要下载真实模型。

### Negative

- 首次安装要下载并导出模型，需要 Python、PyTorch，体积大、耗时长。
- 词表和模型必须配套；换模型要同时换 `assets/vocab.json`。

### Risks

- 模型和词表的许可证待核对，开源前必须确认，见 `docs/status.md`。

## Related

- ADR-0002、ADR-0004
- 实现：`src/asr.rs`、`tools/export_onnx.py`、`assets/vocab.json`
