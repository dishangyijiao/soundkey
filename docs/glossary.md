# Glossary

Add a row whenever a new term appears. The "In this project" column points at real files so you can check the term against the code. The Chinese column is a learning aid for the project owner; the English column is the authoritative text.

| Category | Term | Plain explanation | 中文解释 | In this project |
|---|---|---|---|---|
| Docs | PRD | Product requirements document: why it is built, for whom, and what success looks like; no implementation details | 产品需求文档：为什么做、给谁用、成功的标准，不写技术实现 | None yet, see `docs/status.md` |
| Docs | Requirement | Something that must be true, ideally verifiable by a test | "必须成立的事"，最好能被测试验证 | None yet |
| Docs | ADR | Architecture decision record: why a choice was made and what was given up | 架构决策记录：当时为什么这样选，以及放弃了什么 | `docs/adr/` |
| Docs | Superseded | An ADR status: replaced by a newer decision; the old one is kept | ADR 的状态：已被新决策取代，旧的保留不删 | Rule in `docs/README.md` |
| Docs | Spec | How a feature should behave, precisely enough for a developer and a test to follow | 某个功能"到底怎么表现"，写到开发者和测试都能照着做 | None yet |
| Docs | Canonical source | Write each fact in one place and reference it elsewhere, so a change is never missed in one copy | 同一个事实只在一处写，其他地方引用，避免改一处漏另一处 | The table in `docs/README.md` |
| Docs | Traceability | Being able to go from code to why it exists, and from a requirement to the code and tests that satisfy it | 能从代码追到为什么有它，也能从需求追到哪段代码、哪个测试验证了它 | Not done yet |
| API | Contract | A machine-readable statement of what an interface accepts and returns | 用机器能读的格式写明接口收什么、回什么 | None yet; the API is in `src/server.rs` |
| API | OpenAPI | A common format for describing an HTTP API; it can be validated and turned into docs | 描述 HTTP 接口的通用格式，能自动校验、生成文档 | One is planned, derived from the code |
| API | Migration | A database schema change applied in version order | 按版本号顺序执行的数据库结构变更 | `src/store.rs`, versioned by `user_version` |
| Security | CORS | A browser rule deciding whether a web page may read data from another site | 浏览器的规则：网页能不能读另一个网站的数据 | Removed, see ADR-0001 |
| Security | Preflight | A question the browser asks first ("may I send this?") before a complex cross-origin request | 复杂请求发出前，浏览器先问一句"能不能发" | ADR-0001 |
| Security | Origin | The request header in which the browser says which site the request came from | 浏览器在跨站请求里带上的"我从哪个网站来" | `origin_allowed` in `src/server.rs` |
| Security | DNS rebinding | An attacker makes their own domain suddenly point to your machine to get around browser limits | 攻击者让自己的域名突然指向你的本机，借此绕过浏览器限制 | Blocked by `host_allowed` in `src/server.rs` |
| Security | Loopback | The addresses that point at this machine itself: `127.0.0.1`, `localhost`, `::1` | 指向本机自己的地址 | The server listens only here |
| Extension | host_permissions | The URLs a Chrome extension declares it needs; with it, the extension is exempt from CORS | Chrome 扩展声明"我要访问哪些网址"，有它就不受 CORS 限制 | `extension/manifest.json` |
| Extension | Side panel | The extension panel on the right side of Chrome; Fengsong's interface lives here | Chrome 右侧的扩展面板，讽诵的界面就在这里 | `extension/sidepanel.*` |
| Testing | TDD | Write a failing test first, then the smallest code that makes it pass | 先写会失败的测试，再写刚好让它通过的代码 | Development rules in `AGENTS.md` |
| Testing | Coverage | The share of code the tests execute; a signal, not proof the tests are right | 测试跑到了多少比例的代码，只是信号，不等于测对了 | `npm run coverage` |
| Testing | Property-based test | Instead of examples, state a rule that holds for any input and let a tool generate inputs to find a counterexample | 不写具体例子，写"对任何输入都成立的规律"，让工具随机生成输入来找反例 | fast-check for JS, proptest for Rust |
| Testing | Mutation testing | Deliberately break the code a little and see whether the tests notice; if not, they are not really checking | 故意把代码改坏一点，看测试能不能发现 | `npm run mutate`, `npm run mutate:rust` |
| Testing | Equivalent mutant | A change that does not alter behavior, so the tests not noticing is correct; exclude it | 改了代码但行为完全没变，测试"发现不了"是正常的，要排除 | `mutants.toml` |
| Testing | Fixture | Fixed data or a small model used only by tests | 测试专用的固定数据或小模型 | `tests/fixtures/*.onnx` |
| Speech | IPA / phoneme | The International Phonetic Alphabet, and the smallest unit of sound; scoring compares phoneme by phoneme | 国际音标和最小的发音单位，评分就是逐个音素对照 | `src/align.rs` |
| Speech | ONNX | A common model file format; the Rust program uses it to run the pronunciation model | 一种通用的模型文件格式，Rust 程序用它跑发音模型 | `src/asr.rs`, `tools/export_onnx.py` |
| Engineering | CI | A pipeline that runs tests and checks automatically on every commit | 每次提交自动跑测试和检查的流水线 | None yet, see `docs/status.md` |
| Engineering | Conventional Commits | A commit message format: `type(scope): description`, for example `fix(server): ...` | 提交信息的写法：`类型(范围): 描述` | Commit rules in `AGENTS.md` |
