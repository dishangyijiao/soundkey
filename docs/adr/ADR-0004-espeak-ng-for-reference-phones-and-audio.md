# ADR-0004: 用 espeak-ng 生成标准音素和标准朗读

## Status

Accepted（补记，2026-10-03）

## Context

评分要有"应该读成什么"的标准音素，界面还要能播放标准朗读。

仓库里能确认的事实：

- 通过外部命令 `espeak-ng` 调用（`src/espeak.rs`，`Command::new`），不是链接库。
- 同一个程序既给出标准 IPA（`/phones`），也合成标准朗读（`/speak`）。
- 把 IPA 单个音素合成成声音时，需要映射到 espeak 自己的助记符，并给元音加重音标记，否则弱读后听起来不像原音。映射表的每一项都有"往返测试"：espeak 读回来必须还是同一个 IPA（`src/espeak.rs` 的注释和测试）。
- 没装 `espeak-ng` 时，依赖它的测试直接失败，不悄悄跳过（`README.md`）。

为什么选 espeak-ng：待确认。推断：它能离线、免费地从文本给出音素，并且和 ADR-0003 的模型标签同源。没有文字依据。

## Decision

- 标准音素和标准朗读都由本机的 `espeak-ng` 提供。
- 以子进程方式调用，用户自己安装（`brew install espeak-ng`）。
- 用户文本放在 `--` 之后传给它，避免以 `-` 开头的文本被当成选项（`src/espeak.rs` 的注释）。

## Alternatives Considered

历史上比较过哪些方案：待确认，仓库里没有记录。

## Consequences

### Positive

- 不用自己维护发音词典。
- 子进程隔离，崩溃不会带倒主程序。

### Negative

- 用户必须自己装 `espeak-ng`；合成的声音是机器味的。
- 音素映射表要靠测试守住，改动风险高。

### Risks

- `espeak-ng` 的许可证待确认。以子进程方式调用，与链接进程序的法律含义不同，开源前需要核实。

## Related

- ADR-0002、ADR-0003
- 实现：`src/espeak.rs`
