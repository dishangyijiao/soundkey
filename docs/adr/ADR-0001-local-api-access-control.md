# ADR-0001: 本机接口只接受扩展的请求，不发 CORS 头

## Status

Accepted（2026-10-03）

## Context

本机服务监听 `127.0.0.1:17321`，有读写卡片、生词、录音的接口。之前用 `CorsLayer::permissive()`，对任何来源都回 `Access-Control-Allow-Origin: *`，所以用户浏览器里打开的任何网页都能读到这些数据。

当时选 permissive 的原因：待确认（提交信息里没有说明，推断是开发时图省事）。

调用方只有扩展侧边栏（`extension/sidepanel.js`）。它是扩展页面，`manifest.json` 里有 `host_permissions: http://127.0.0.1:17321/*`，所以请求本来就不受 CORS 限制。

威胁：

- 网页跨域读取接口响应（靠宽松的 CORS 头）。
- 网页发起不需要预检的写请求，比如 `text/plain` 表单提交（CORS 头挡不住，服务端得自己拒绝）。
- DNS 重绑定：攻击者域名解析到 127.0.0.1，浏览器就把它当同源。

## Decision

1. 不发任何 CORS 头。
2. 拒绝带 `Origin` 头但不是 `chrome-extension://` 开头的请求，返回 403。没有 `Origin` 的请求（扩展自己的音频元素、curl）放行。
3. 拒绝 `Host` 不是回环地址（`127.0.0.1`、`localhost`、`::1`）的请求，返回 403。没有 `Host` 头的请求放行，因为它不可能来自重绑定。

实现在 `src/server.rs` 的 `guard_local_access`，行为由 `src/server.rs` 里的测试固定。

## Alternatives Considered

- 只把 CORS 收紧到扩展 ID：不行，网页的写请求仍能到达；而且未打包扩展的 ID 随路径变化。
- 给每个请求加共享密钥：能防住别的本机进程，但扩展要保存并带上密钥，复杂度高，对"网页攻击"这个主要威胁没有额外收益。留作以后的选项。

## Consequences

### Positive

- 网页既读不到数据，也写不进数据。
- 去掉了 `tower-http` 依赖。

### Negative

- 任何扩展（不限讽诵）都带 `chrome-extension://` 来源，所以别的扩展若有对 `127.0.0.1:17321` 的 host 权限，仍然能调用。已知并接受。
- 同机上的其他本地进程不受影响（它们可以不带 `Origin`），这也在本决策范围之外。
- 以后若要让网页（不是扩展）调用本机服务，需要重新决策。

### Risks

- `Origin` 判断依赖浏览器如实发送；非浏览器客户端可以伪造。这是预期内的：本决策防的是"网页"，不是"本机恶意程序"。

## Related

- 架构：待补，见 `docs/inventory.md`
- 实现与测试：`src/server.rs`（`guard_local_access`、`origin_allowed`、`host_allowed`）
