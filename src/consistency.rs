//! Facts that live in more than one language or file cannot share a source, so these
//! tests pin them to each other. See `docs/README.md` for which file is canonical.

use crate::paths::PORT;

const MANIFEST: &str = include_str!("../extension/manifest.json");
const SIDEPANEL: &str = include_str!("../extension/sidepanel.js");
const README: &str = include_str!("../README.md");
const MAIN: &str = include_str!("main.rs");

#[test]
fn the_extension_and_the_docs_use_the_port_the_server_listens_on() {
    let address = format!("127.0.0.1:{PORT}");
    for (name, text) in [
        ("extension/manifest.json", MANIFEST),
        ("extension/sidepanel.js", SIDEPANEL),
        ("README.md", README),
        ("src/main.rs", MAIN),
    ] {
        assert!(text.contains(&address), "{name} 里没有 {address}，端口和 src/paths.rs 的 PORT 不一致");
    }
}

#[test]
fn the_server_and_the_extension_carry_the_same_version() {
    let manifest: serde_json::Value = serde_json::from_str(MANIFEST).unwrap();
    assert_eq!(
        manifest["version"].as_str(),
        Some(env!("CARGO_PKG_VERSION")),
        "extension/manifest.json 和 Cargo.toml 的版本号要一起改"
    );
}
