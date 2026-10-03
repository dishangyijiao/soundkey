# Agent Instructions

讽诵：Chrome 扩展（侧边栏）+ 本机 Rust 服务。摘下一句 YouTube 字幕，朗读，对照音素看哪个音没读准。

## 先读什么

按任务只读相关的部分，不要通读：

1. `README.md`：安装、运行、测试命令。
2. `docs/README.md`：每类事实的唯一来源在哪里。
3. `docs/inventory.md`：已知的重复来源、缺口和风险。
4. 要改的代码和它旁边的测试。

## 命令

```bash
cargo test            # Rust：单元测试 + tests/cli.rs
npm test              # 扩展：jsdom / vm 里跑真实脚本
npm run coverage      # 门槛：JS 行、分支、函数和 Rust 行、函数都是 100%
npm run mutate        # JS 增量变异测试（Stryker）
npm run mutate:rust   # Rust 变异测试（cargo-mutants，配置在 mutants.toml）
```

- 需要本机有 `espeak-ng`，没有时依赖它的测试直接失败。
- `tests/cli.rs` 的 `serve_*` 测试、Stryker 都要绑定本机端口；沙箱里会报 `EPERM`，这是环境限制，不是代码问题。

## 事实放哪里

- 不要把同一个事实写在两处；用引用代替复制。
- 事实的唯一来源见 `docs/README.md`。改了对外可见的行为，同步改那里指向的来源和测试。
- 不要根据假设补写历史决策的理由；不确定就写"待确认"。

## 开发规则

- 按 TDD：先写失败的测试，确认因正确原因失败，再写最小实现。
- 高风险逻辑加属性测试（JS 用 fast-check，Rust 用 proptest）。关键模块做增量变异测试；确属等价变异体的，在 `mutants.toml` 里排除并写明理由。
- 纯逻辑抽成无 DOM 依赖的函数，便于测试。
- 不为了让检查通过而削弱或删除测试。

## 提交

- Conventional Commits，中文描述，按模块拆成独立可评审的提交。
- 不带 Co-Authored-By 之类的 AI 署名。
- 只提交相关文件。不提交 `.claude/`、`coverage/`、`extension.crx`、`extension.pem`（含私钥）。

## 完成前

- 跑相关测试和检查，如实报告改了什么、没验证什么。
- 没跑完验证就不要说完成。
- 不自动合并；不悄悄改公开接口、持久化数据的含义或本机服务的安全边界。
