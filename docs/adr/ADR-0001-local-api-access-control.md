# ADR-0001: The local API accepts only the extension and sends no CORS headers

## Status

Accepted (2026-10-03)

## Context

The local server listens on `127.0.0.1:17321` and has endpoints that read and write cards, words and recordings. It used `CorsLayer::permissive()`, which answered every origin with `Access-Control-Allow-Origin: *`, so any web page open in the user's browser could read that data.

Why permissive was chosen at the time: to be confirmed (the commit messages do not say; inferred to be a development shortcut).

The only caller is the extension side panel (`extension/sidepanel.js`). It is an extension page and `manifest.json` grants `host_permissions: http://127.0.0.1:17321/*`, so its requests are exempt from CORS anyway.

Threats:

- A web page reads API responses across origins (enabled by the permissive CORS headers).
- A web page sends a write request that needs no preflight, such as a `text/plain` form post (CORS headers do not stop it; the server has to refuse it itself).
- DNS rebinding: the attacker's domain resolves to 127.0.0.1 and the browser treats it as same-origin.

## Decision

1. Send no CORS headers at all.
2. Refuse, with 403, any request that has an `Origin` header not starting with `chrome-extension://`. Requests without `Origin` (the extension's own audio elements, curl) are allowed.
3. Refuse, with 403, any request whose `Host` is not a loopback address (`127.0.0.1`, `localhost`, `::1`). Requests without a `Host` header are allowed because they cannot come from rebinding.

The implementation is `guard_local_access` in `src/server.rs`, and the tests in `src/server.rs` pin the behavior.

## Alternatives Considered

- Restrict CORS to the extension ID only: not enough, a web page's write requests would still reach the server, and the ID of an unpacked extension changes with its path.
- A shared secret on every request: it would also stop other local processes, but the extension would have to store and send the secret, which is complex and adds nothing against the main threat, web pages. Kept as a later option.

## Consequences

### Positive

- A web page can neither read nor write any data.
- The `tower-http` dependency is gone.

### Negative

- Every extension (not only Fengsong) has a `chrome-extension://` origin, so another extension with host permission for `127.0.0.1:17321` can still call the API. Known and accepted.
- Other local processes are not affected (they can omit `Origin`); this is outside the scope of this decision.
- If web pages (not the extension) ever need to call the local server, this decision has to be revisited.

### Risks

- The `Origin` check relies on the browser sending it honestly; a non-browser client can forge it. That is expected: this decision defends against web pages, not against malicious local programs.

## Related

- Architecture: to be written, see `docs/status.md`
- Implementation and tests: `src/server.rs` (`guard_local_access`, `origin_allowed`, `host_allowed`)
