# ADR-0002: 由 Chrome 扩展加本机 Rust 服务组成，评分和存储都在本机

## Status

Accepted（补记，2026-10-03）。这是对已经存在的做法的事后记录，原始讨论没有留下文字。

## Context

讽诵要做的事：从 YouTube 摘一句字幕，朗读标准音，录下用户的朗读，逐个音素对照，指出哪个音没读准。

仓库里能确认的事实：

- 初始提交信息写的是"摘下句子，朗读，并在本机做音素对照"。
- 扩展负责界面和取字幕：`extension/sidepanel.*` 是侧边栏，`extension/page.js`、`content.js` 在 YouTube 页面里取字幕。
- 本机服务负责合成发音、识别音素、评分、存卡片和录音：`src/server.rs`、`src/asr.rs`、`src/espeak.rs`、`src/store.rs`。
- 服务只监听 `127.0.0.1:17321`（`src/paths.rs`）。

为什么选这种拆分：待确认。下面两条是推断，没有文字依据：

- 推断：模型推理和音素合成放在浏览器里不现实，所以放到本机进程。
- 推断：用户的录音留在本机，不上传。

## Decision

- 扩展只做界面和取字幕，不跑模型。
- 本机服务提供 HTTP 接口，做合成、识别、评分和存储，数据放在 `~/Library/Application Support/fengsong/`。
- 两者通过 `127.0.0.1` 通信，访问控制见 ADR-0001。

## Alternatives Considered

历史上比较过哪些方案：待确认，仓库里没有记录。

## Consequences

### Positive

- 录音和卡片都在用户自己的电脑上（见上面第二条推断，待确认）。
- 评分逻辑是普通的 Rust 代码，可以单独测试，不依赖浏览器。

### Negative

- 用户必须先装并启动本机程序，扩展单独不能用。这是将来"给别人用"的最大障碍，见 `docs/status.md` 的分发一项。
- 两个组件各有版本号，由 `src/consistency.rs` 的测试保持一致。

### Risks

- 本机程序没启动时，扩展只能提示"没开"，体验差。

## Related

- ADR-0001：本机接口的访问控制
- ADR-0003：音素模型
- ADR-0004：发音合成
- ADR-0005：本机存储
