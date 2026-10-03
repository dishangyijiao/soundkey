# 术语表

遇到新术语就补一行。"在本项目里"一列指向真实的文件，方便对照着看。

| 类别 | 术语 | 白话解释 | 在本项目里 |
|---|---|---|---|
| 文档 | PRD | 产品需求文档：为什么做、给谁用、成功的标准，不写技术实现 | 还没有，见 `docs/status.md` |
| 文档 | Requirement（需求） | "必须成立的事"，最好能被测试验证 | 还没有 |
| 文档 | ADR | 架构决策记录：当时为什么这样选，以及放弃了什么 | `docs/adr/` |
| 文档 | Superseded | ADR 的状态：已被新决策取代，旧的保留不删 | 规则写在 `docs/README.md` |
| 文档 | Spec（规格） | 某个功能"到底怎么表现"，写到开发者和测试都能照着做 | 还没有 |
| 文档 | Canonical source（唯一来源） | 同一个事实只在一处写，其他地方引用，避免改一处漏另一处 | `docs/README.md` 的对照表 |
| 文档 | Traceability（可追溯） | 能从代码追到为什么有它，也能从需求追到哪段代码、哪个测试验证了它 | 还没做 |
| 接口 | Contract（契约） | 用机器能读的格式写明接口收什么、回什么 | 暂无，接口在 `src/server.rs` |
| 接口 | OpenAPI | 描述 HTTP 接口的通用格式，能自动校验、生成文档 | 计划推导一份 |
| 接口 | Migration（迁移） | 按版本号顺序执行的数据库结构变更 | `src/store.rs`，用 `user_version` 记版本 |
| 安全 | CORS | 浏览器的规则：网页能不能读另一个网站的数据 | 已去掉，见 ADR-0001 |
| 安全 | Preflight（预检） | 复杂请求发出前，浏览器先问一句"能不能发" | ADR-0001 |
| 安全 | Origin | 浏览器在跨站请求里带上的"我从哪个网站来" | `src/server.rs` 的 `origin_allowed` |
| 安全 | DNS 重绑定 | 攻击者让自己的域名突然指向你的本机，借此绕过浏览器限制 | `src/server.rs` 的 `host_allowed` 挡它 |
| 安全 | Loopback（回环地址） | 指向本机自己的地址：`127.0.0.1`、`localhost`、`::1` | 服务只听这里 |
| 扩展 | host_permissions | Chrome 扩展声明"我要访问哪些网址"，有它就不受 CORS 限制 | `extension/manifest.json` |
| 扩展 | Side panel（侧边栏） | Chrome 右侧的扩展面板，讽诵的界面就在这里 | `extension/sidepanel.*` |
| 测试 | TDD | 先写会失败的测试，再写刚好让它通过的代码 | `AGENTS.md` 的开发规则 |
| 测试 | Coverage（覆盖率） | 测试跑到了多少比例的代码，只是信号，不等于测对了 | `npm run coverage` |
| 测试 | Property-based test（属性测试） | 不写具体例子，写"对任何输入都成立的规律"，让工具随机生成输入来找反例 | JS 用 fast-check，Rust 用 proptest |
| 测试 | Mutation testing（变异测试） | 故意把代码改坏一点，看测试能不能发现；发现不了说明测试没真正检查 | `npm run mutate`、`npm run mutate:rust` |
| 测试 | Equivalent mutant（等价变异体） | 改了代码但行为完全没变，测试"发现不了"是正常的，要排除 | `mutants.toml` |
| 测试 | Fixture（夹具） | 测试专用的固定数据或小模型 | `tests/fixtures/*.onnx` |
| 发音 | IPA / 音素（phoneme） | 国际音标和最小的发音单位，评分就是逐个音素对照 | `src/align.rs` |
| 发音 | ONNX | 一种通用的模型文件格式，Rust 程序用它跑发音模型 | `src/asr.rs`、`tools/export_onnx.py` |
| 工程 | CI | 每次提交自动跑测试和检查的流水线 | 还没有，见 `docs/status.md` |
| 工程 | Conventional Commits | 提交信息的写法：`类型(范围): 描述`，如 `fix(server): ...` | `AGENTS.md` 的提交规则 |
