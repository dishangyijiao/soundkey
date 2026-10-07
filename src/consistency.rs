//! Facts that live in more than one language or file cannot share a source, so these
//! tests pin them to each other. See `docs/README.md` for which file is canonical.

use crate::paths::PORT;

const MANIFEST: &str = include_str!("../extension/manifest.json");
const SIDEPANEL: &str = include_str!("../extension/sidepanel.js");
const README: &str = include_str!("../README.md");
const MAIN: &str = include_str!("main.rs");
const CONTRACT: &str = include_str!("../contracts/openapi/openapi.json");
const REQUIREMENTS: &str = include_str!("../docs/requirements.md");
const SERVER: &str = include_str!("server.rs");

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

/// Every `REQ-###` identifier that appears in `text`.
fn requirement_ids(text: &str) -> std::collections::BTreeSet<String> {
    let bytes = text.as_bytes();
    let mut found = std::collections::BTreeSet::new();
    for start in text.match_indices("REQ-").map(|(index, _)| index) {
        let digits = &bytes[start + 4..];
        if digits.len() >= 3 && digits[..3].iter().all(u8::is_ascii_digit) {
            found.insert(text[start..start + 7].to_string());
        }
    }
    found
}

/// The three lines above `fn name(`, where the requirement comment sits.
fn lines_above_test<'a>(source: &'a str, name: &str) -> Vec<&'a str> {
    let lines: Vec<&str> = source.lines().collect();
    let at = lines.iter().position(|line| line.contains(&format!("fn {name}("))).unwrap_or_else(|| panic!("no test named {name}"));
    lines[at.saturating_sub(3)..at].to_vec()
}

#[test]
fn every_requirement_cited_in_code_and_tests_exists_in_the_requirements_document() {
    let known = requirement_ids(REQUIREMENTS);
    for (path, text) in project_texts() {
        if path.starts_with("src/") || path.starts_with("test/") || path.starts_with("tests/") || path.starts_with("extension/") {
            for id in requirement_ids(&text) {
                assert!(known.contains(&id), "{path} cites {id}, which docs/requirements.md does not define");
            }
        }
    }
}

#[test]
fn the_tests_that_guard_req_005_cite_it() {
    for name in [
        "a_recording_is_scored_stored_and_can_be_played_back",
        "a_word_recording_is_scored_against_the_word_and_shows_in_the_notebook",
        "unusable_recordings_are_rejected_with_a_reason",
    ] {
        assert!(
            lines_above_test(SERVER, name).iter().any(|line| line.contains("REQ-005")),
            "src/server.rs: the test {name} guards REQ-005 acceptance criteria and must carry a `// REQ-005` comment"
        );
    }
}

#[test]
#[should_panic(expected = "no test named a_test_that_does_not_exist")]
fn a_misspelled_test_name_fails_loudly_instead_of_passing_silently() {
    lines_above_test(SERVER, "a_test_that_does_not_exist");
}

/// A file of the repository, or an empty string, so a missing file fails an assertion instead of the build.
fn repo_file(relative: &str) -> String {
    std::fs::read_to_string(std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join(relative)).unwrap_or_default()
}

const LICENSE_EXPRESSION: &str = "MIT OR Apache-2.0";

#[test]
fn the_project_is_licensed_under_mit_or_apache_2_0_everywhere_it_says_so() {
    assert_eq!(env!("CARGO_PKG_LICENSE"), LICENSE_EXPRESSION, "Cargo.toml");
    let package: serde_json::Value = serde_json::from_str(&repo_file("package.json")).unwrap();
    assert_eq!(package["license"].as_str(), Some(LICENSE_EXPRESSION), "package.json");
}

#[test]
fn both_license_files_hold_the_standard_text_with_the_copyright_line() {
    let mit = repo_file("LICENSE-MIT");
    assert!(mit.starts_with("MIT License\n"), "LICENSE-MIT must start with the standard title");
    assert!(mit.contains("Copyright (c) 2026 "), "LICENSE-MIT needs a copyright line");
    assert!(mit.contains("Permission is hereby granted, free of charge, to any person obtaining a copy"));
    assert!(mit.contains("THE SOFTWARE IS PROVIDED \"AS IS\", WITHOUT WARRANTY OF ANY KIND"));
    let apache = repo_file("LICENSE-APACHE");
    assert!(apache.contains("Apache License\n"), "LICENSE-APACHE must hold the Apache License");
    assert!(apache.contains("Version 2.0, January 2004"));
    assert!(apache.contains("END OF TERMS AND CONDITIONS"));
    assert!(apache.contains("4. Redistribution."), "the full terms must be present, not a summary");
}

#[test]
fn both_readmes_name_both_licenses_link_the_files_and_state_the_contribution_terms() {
    for (name, text) in [("README.md", repo_file("README.md")), ("README.zh-CN.md", repo_file("README.zh-CN.md"))] {
        assert!(text.contains("Apache License, Version 2.0"), "{name} must name the Apache license");
        assert!(text.contains("(LICENSE-APACHE)") && text.contains("(LICENSE-MIT)"), "{name} must link both license files");
        assert!(text.contains("MIT"), "{name} must name the MIT license");
    }
    let english = repo_file("README.md");
    assert!(
        english.contains("dual licensed as above, without any additional terms or conditions"),
        "the English README must state what a contribution is licensed under"
    );
}

#[test]
fn both_readmes_tell_a_newcomer_what_is_needed_and_what_the_limits_are() {
    // Things a stranger must be told before spending an hour: the tools setup needs, the platform it was used on, and that
    // nothing is uploaded while it runs.
    for (name, text) in [("README.md", repo_file("README.md")), ("README.zh-CN.md", repo_file("README.zh-CN.md"))] {
        for needed in ["espeak-ng", "uv", "macOS", "Chrome", "127.0.0.1", "1.2 GB", "YouTube"] {
            assert!(text.contains(needed), "{name} does not mention {needed}");
        }
    }
    let english = repo_file("README.md");
    for heading in ["## What it does", "## Requirements", "## Limits"] {
        assert!(english.contains(heading), "README.md lacks the section {heading}");
    }
    let chinese = repo_file("README.zh-CN.md");
    for heading in ["## 它做什么", "## 前置条件", "## 局限"] {
        assert!(chinese.contains(heading), "README.zh-CN.md lacks the section {heading}");
    }
}

/// Whether a `uses:` reference is safe: a local action (`./...`) lives in this repository, any other must name a full commit hash.
fn action_is_pinned(reference: &str) -> bool {
    if reference.starts_with("./") {
        return true;
    }
    let revision = reference.rsplit('@').next().unwrap();
    revision.len() == 40 && revision.chars().all(|c| c.is_ascii_hexdigit())
}

#[test]
fn only_a_full_commit_hash_or_a_local_action_counts_as_pinned() {
    let hash = "11d5960a326750d5838078e36cf38b85af677262";
    assert!(action_is_pinned(&format!("actions/checkout@{hash}")));
    assert!(action_is_pinned("./.github/actions/local"));
    for unpinned in ["actions/checkout@v4", "dtolnay/rust-toolchain@stable", "actions/checkout@11d5960", "actions/checkout", &format!("actions/checkout@{hash}0")] {
        assert!(!action_is_pinned(unpinned), "{unpinned} must not count as pinned");
    }
}

#[test]
fn every_third_party_action_in_the_workflows_is_pinned_to_a_full_commit_hash() {
    // A tag such as v4 can be moved to different code later; a 40-character commit hash cannot.
    let dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join(".github").join("workflows");
    let mut checked = 0;
    for entry in std::fs::read_dir(dir).unwrap() {
        let path = entry.unwrap().path();
        let text = std::fs::read_to_string(&path).unwrap();
        for line in text.lines().filter(|line| line.trim_start().starts_with("- uses:") || line.trim_start().starts_with("uses:")) {
            let reference = line.split("uses:").nth(1).unwrap().split('#').next().unwrap().trim();
            assert!(action_is_pinned(reference), "{}: `{reference}` is not pinned to a full commit hash", path.display());
            checked += 1;
        }
    }
    assert!(checked >= 6, "expected to check the actions of the CI workflow, checked {checked}");
}
