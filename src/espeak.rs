use crate::align::parse_ipa;
use std::process::Command;

pub fn available() -> bool {
    Command::new("espeak-ng")
        .arg("--version")
        .output()
        .map(|output| output.status.success())
        .unwrap_or(false)
}

pub fn expected_phones(text: &str) -> Result<Vec<String>, String> {
    let text = text.replace(['\n', '\r'], " ");
    let output = Command::new("espeak-ng")
        .args(["-v", "en-us", "-q", "--ipa=1"])
        .arg(text)
        .output()
        .map_err(|_| "需要先安装 espeak-ng".to_string())?;
    if !output.status.success() {
        return Err("espeak-ng 没有读出这句的音标".to_string());
    }
    let raw = String::from_utf8_lossy(&output.stdout);
    let phones = parse_ipa(&raw);
    if phones.is_empty() {
        return Err("espeak-ng 没有读出这句的音标".to_string());
    }
    Ok(phones)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_a_sentence() {
        if !available() {
            return;
        }
        let phones = expected_phones("I think this is the third time.").unwrap();
        assert!(phones.iter().any(|phone| phone == "θ"));
        assert!(phones.len() > 8);
    }
}
