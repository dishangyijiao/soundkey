# Security policy

## What SoundKey is, security-wise

SoundKey is a Chrome extension plus a program that runs on your own computer and listens only on `127.0.0.1:17321`. It has no account, no cloud service and no telemetry; your sentences and recordings stay in `~/Library/Application Support/soundkey/`. The reasoning is in [ADR-0001](docs/adr/ADR-0001-local-api-access-control.md) and the [architecture overview](docs/architecture/README.md).

## What the local server defends against, and what it does not

- **Defended:** web pages. The server sends no CORS headers, refuses any request whose `Origin` is not `chrome-extension://…`, and refuses any request whose `Host` is not a loopback address (which also blocks DNS rebinding).
- **Not defended (known and accepted):** another browser extension that has permission for `127.0.0.1:17321`, and any other program running as you on the same computer, which can omit the `Origin` header. Anyone who can already run code as you can read your recordings directly.

A report that a **web page** can read or change SoundKey data, or that the server can be reached from another computer, is exactly what this policy is for.

## Reporting a vulnerability

Please do not open a public issue for a security problem. Use GitHub's private vulnerability reporting: on the repository page, open the **Security** tab and choose **Report a vulnerability**. If that option is not shown, open a normal issue that asks for a private channel and contains no details.

Include what you did, what you expected, what happened, and the version (`Cargo.toml` and `extension/manifest.json`). This is a project maintained by one person in spare time: there is no guaranteed response time, but a report will be read, and a confirmed problem will be fixed and recorded in `docs/status.md`.

## Supported versions

Only the latest commit on `main`. There are no released versions yet.
