//! Facts that live in more than one language or file cannot share a source, so these
//! tests pin them to each other. See `docs/README.md` for which file is canonical.

use crate::paths::PORT;

const MANIFEST: &str = include_str!("../extension/manifest.json");
const SIDEPANEL: &str = include_str!("../extension/sidepanel.js");
const README: &str = include_str!("../README.md");
const MAIN: &str = include_str!("main.rs");
const CONTRACT: &str = include_str!("../contracts/openapi/openapi.json");

#[test]
fn the_extension_and_the_docs_use_the_port_the_server_listens_on() {
    let address = format!("127.0.0.1:{PORT}");
    for (name, text) in [
        ("extension/manifest.json", MANIFEST),
        ("extension/sidepanel.js", SIDEPANEL),
        ("README.md", README),
        ("src/main.rs", MAIN),
        ("contracts/openapi/openapi.json", CONTRACT),
    ] {
        assert!(text.contains(&address), "{name} does not contain {address}: the port differs from PORT in src/paths.rs");
    }
}

#[test]
fn the_server_and_the_extension_carry_the_same_version() {
    let manifest: serde_json::Value = serde_json::from_str(MANIFEST).unwrap();
    assert_eq!(
        manifest["version"].as_str(),
        Some(env!("CARGO_PKG_VERSION")),
        "extension/manifest.json and Cargo.toml must change version together"
    );
    let contract: serde_json::Value = serde_json::from_str(CONTRACT).unwrap();
    assert_eq!(
        contract["info"]["version"].as_str(),
        Some(env!("CARGO_PKG_VERSION")),
        "contracts/openapi/openapi.json and Cargo.toml must change version together"
    );
}

/// Every text file of the project, as (path relative to the repository root, content).
fn project_texts() -> Vec<(String, String)> {
    const SKIPPED_DIRS: [&str; 9] = [
        "target", "node_modules", ".git", ".claude", "mutants.out", "reports", "coverage", ".stryker-tmp", "proptest-regressions",
    ];
    const TEXT_EXTENSIONS: [&str; 8] = ["rs", "js", "json", "md", "html", "py", "toml", "yml"];
    let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR"));
    let mut pending = vec![root.to_path_buf()];
    let mut texts = Vec::new();
    while let Some(dir) = pending.pop() {
        for entry in std::fs::read_dir(&dir).unwrap() {
            let path = entry.unwrap().path();
            let name = path.file_name().unwrap().to_string_lossy().into_owned();
            if path.is_dir() {
                if !SKIPPED_DIRS.contains(&name.as_str()) {
                    pending.push(path);
                }
            } else if TEXT_EXTENSIONS.contains(&path.extension().unwrap_or_default().to_string_lossy().as_ref()) {
                let relative = path.strip_prefix(root).unwrap().to_string_lossy().into_owned();
                texts.push((relative, std::fs::read_to_string(&path).unwrap()));
            }
        }
    }
    texts
}

/// The spelling check and the old-name check below name the forbidden words, so they
/// are built from parts and this file is skipped by both.
#[test]
fn the_product_is_spelled_soundkey_except_in_the_records_that_quote_the_old_spelling() {
    let wrong = ["Sound", "key"].concat();
    let records = [
        "src/consistency.rs",
        "docs/migration.md",
        "docs/adr/ADR-0006-adopt-soundkey-as-the-product-name.md",
        "docs/adr/ADR-0007-rename-internal-identifiers-to-soundkey.md",
    ];
    for (path, text) in project_texts() {
        if !records.contains(&path.as_str()) {
            assert!(!text.contains(&wrong), "{path} spells the product `{wrong}`; ADR-0007 requires `SoundKey` (or lowercase `soundkey` for identifiers)");
        }
    }
}

#[test]
fn the_former_product_name_is_gone_from_code_tests_and_contracts() {
    let former = ["feng", "song"].concat();
    for (path, text) in project_texts() {
        if !path.starts_with("docs/") && path != "src/consistency.rs" {
            assert!(!text.to_lowercase().contains(&former), "{path} still contains the former product name; ADR-0007 renamed the identifiers");
        }
    }
}
