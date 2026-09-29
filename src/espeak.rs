use crate::align::parse_ipa;
use std::process::Command;

/// Map the English IPA inventory emitted by espeak-ng to its own mnemonic
/// phoneme alphabet (the syntax accepted inside [[...]]).
pub fn espeak_code(ipa: &str) -> Option<&'static str> {
    Some(match ipa {
        "p" => "p",
        "b" => "b",
        "t" => "t",
        "d" => "d",
        "k" => "k",
        "ɡ" => "g",
        "f" => "f",
        "v" => "v",
        "θ" => "T",
        "ð" => "D",
        "s" => "s",
        "z" => "z",
        "ʃ" => "S",
        "ʒ" => "Z",
        "h" => "h",
        "tʃ" => "tS",
        "dʒ" => "dZ",
        "m" => "m",
        "n" => "n",
        "ŋ" => "N",
        "l" => "l",
        "ɹ" => "r",
        "ɾ" => "4",
        "w" => "w",
        "j" => "j",
        "i" => "i:",
        "ɪ" => "I",
        "e" => "e",
        "ɛ" => "e",
        "æ" => "{",
        "ɑ" => "A:",
        "ɒ" => "Q",
        "ɔ" => "O:",
        "o" => "oU",
        "ʊ" => "U",
        "u" => "u:",
        "ʌ" => "V",
        "ə" => "@",
        "ɚ" => "3",
        "ɝ" => "3:",
        "eɪ" => "eI",
        "aɪ" => "aI",
        "ɔɪ" => "OI",
        "aʊ" => "aU",
        "oʊ" => "oU",
        "ɪə" => "I@",
        "eə" => "e@",
        "ʊə" => "U@",
        "ɜː" => "3:",
        _ => return None,
    })
}

pub fn synthesize_phone(ipa: &str) -> Result<Vec<u8>, String> {
    if ipa.is_empty() || ipa.chars().count() > 12 {
        return Err("只支持单个音素".into());
    }
    let code = espeak_code(ipa).ok_or_else(|| format!("暂不支持音素 {ipa}"))?;
    let suffix = if matches!(ipa, "p" | "t" | "k") {
        "@"
    } else {
        ""
    };
    let output = Command::new("espeak-ng")
        .args(["-v", "en-us", "--stdout"])
        .arg(format!("[[{code}{suffix}]]"))
        .output()
        .map_err(|_| "需要先安装 espeak-ng".to_string())?;
    if !output.status.success() || output.stdout.len() < 44 {
        return Err("音素合成失败".into());
    }
    Ok(output.stdout)
}

pub fn synthesize_text(text: &str) -> Result<Vec<u8>, String> {
    if text.trim().is_empty() || text.chars().count() > 1000 {
        return Err("句子长度不合适".into());
    }
    let normalized = text.replace(['\n', '\r'], " ");
    let output = Command::new("espeak-ng")
        .args(["-v", "en-us", "--stdout"])
        .arg(normalized)
        .output()
        .map_err(|_| "需要先安装 espeak-ng".to_string())?;
    if !output.status.success() || output.stdout.len() < 44 {
        return Err("句子合成失败".into());
    }
    Ok(output.stdout)
}

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

    #[test]
    fn supported_ipa_mappings_generate_wav_and_unknown_phones_fail_explicitly() {
        let supported = [
            "p", "b", "t", "d", "k", "ɡ", "f", "v", "θ", "ð", "s", "z", "ʃ", "ʒ", "h", "tʃ", "dʒ",
            "m", "n", "ŋ", "l", "ɹ", "ɾ", "w", "j", "i", "ɪ", "e", "ɛ", "æ", "ɑ", "ɒ", "ɔ", "o",
            "ʊ", "u", "ʌ", "ə", "ɚ", "ɝ", "eɪ", "aɪ", "ɔɪ", "aʊ", "oʊ", "ɪə", "eə", "ʊə", "ɜː",
        ];
        for phone in supported {
            let wav = synthesize_phone(phone).unwrap_or_else(|e| panic!("{phone}: {e}"));
            assert_eq!(&wav[0..4], b"RIFF");
        }
        assert!(synthesize_phone("ɡʰ").unwrap_err().contains("暂不支持"));
        let sentence = synthesize_text("I think this is the third time.").unwrap();
        assert_eq!(&sentence[0..4], b"RIFF");
        assert!(synthesize_text(" ").is_err());
        let vocab = crate::align::vocab_phones(include_str!("../assets/vocab.json"));
        for phone in vocab {
            if espeak_code(&phone).is_none() {
                assert!(synthesize_phone(&phone).unwrap_err().contains("暂不支持"));
            }
        }
    }
}
