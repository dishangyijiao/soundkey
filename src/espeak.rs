use crate::align::parse_ipa;
use std::process::Command;

/// Map the English IPA inventory emitted by espeak-ng to its own mnemonic
/// phoneme alphabet (the syntax accepted inside [[...]]).
///
/// Vowels carry a stress mark (`'`): spoken on their own, unstressed vowels are
/// reduced by espeak-ng and no longer sound like the phone that was asked for.
/// Every entry is checked by a round trip in the tests (espeak reads the code
/// back as the same IPA), because a wrong mnemonic is silent or a different sound.
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
        "ɹ" => "r-",
        "ɾ" => "*",
        "w" => "w",
        "j" => "j",
        "iː" => "'i:",
        "i" => "I",
        "ɪ" => "'I",
        "ᵻ" => "I#",
        "ɐ" => "a#",
        "əl" => "@L",
        "ɛ" => "'E",
        "æ" => "'a",
        "ɔ" => "'O",
        "ɑː" => "'A:",
        "ɔː" => "'O:",
        "ʊ" => "'U",
        "uː" => "'u:",
        "ʌ" => "'V",
        "ə" => "@",
        "ɚ" => "3",
        "ɜː" => "'3:",
        "eɪ" => "'eI",
        "aɪ" => "'aI",
        "ɔɪ" => "'OI",
        "aʊ" => "'aU",
        "oʊ" => "'oU",
        "ɑːɹ" => "'A@",
        "ɔːɹ" => "'O@",
        "ɛɹ" => "'e@",
        "ɪɹ" => "'I@",
        "ʊɹ" => "'U@",
        _ => return None,
    })
}

// User text goes after `--`: espeak-ng would otherwise read a leading `-` as an
// option (`--version`, `-f<file>`).
fn synth_args(text: &str) -> Vec<String> {
    ["-v", "en-us", "--stdout", "--", text]
        .map(String::from)
        .to_vec()
}

fn ipa_args(text: &str) -> Vec<String> {
    ["-v", "en-us", "-q", "--ipa=1", "--", text]
        .map(String::from)
        .to_vec()
}

// On their own these are a few milliseconds of closure or nothing at all
// (`dʒ` and `ɾ` come out silent); a trailing schwa makes them audible.
const NEEDS_VOWEL: [&str; 8] = ["p", "b", "t", "d", "k", "ɡ", "dʒ", "ɾ"];

pub fn synthesize_phone(ipa: &str) -> Result<Vec<u8>, String> {
    if ipa.is_empty() || ipa.chars().count() > 12 {
        return Err("只支持单个音素".into());
    }
    let code = espeak_code(ipa).ok_or_else(|| format!("暂不支持音素 {ipa}"))?;
    let suffix = if NEEDS_VOWEL.contains(&ipa) { "@" } else { "" };
    speak(&format!("[[{code}{suffix}]]"))
}

pub fn synthesize_text(text: &str) -> Result<Vec<u8>, String> {
    if text.trim().is_empty() || text.chars().count() > 1000 {
        return Err("句子长度不合适".into());
    }
    speak(&text.replace(['\n', '\r'], " "))
}

fn speak(text: &str) -> Result<Vec<u8>, String> {
    let output = Command::new("espeak-ng")
        .args(synth_args(text))
        .output()
        .map_err(|_| "需要先安装 espeak-ng".to_string())?;
    if !output.status.success() || output.stdout.len() < 44 {
        return Err("合成失败".into());
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
        .args(ipa_args(&text))
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

    const ENGLISH_PHONES: &[&str] = &[
        "p", "b", "t", "d", "k", "ɡ", "f", "v", "θ", "ð", "s", "z", "ʃ", "ʒ", "h", "tʃ", "dʒ", "m",
        "n", "ŋ", "l", "ɹ", "ɾ", "w", "j", "iː", "i", "ɪ", "ɛ", "æ", "ɑː", "ɔː", "ʊ", "uː", "ʌ",
        "ə", "ɚ", "ɜː", "ᵻ", "ɐ", "əl", "ɔ", "eɪ", "aɪ", "ɔɪ", "aʊ", "oʊ", "ɑːɹ", "ɔːɹ", "ɛɹ",
        "ɪɹ", "ʊɹ",
    ];

    // espeak-ng prints a few phonemes with a different but equivalent symbol
    // when they are spoken on their own.
    fn round_trip_spelling(ipa: &str) -> &str {
        match ipa {
            "ɪɹ" => "ɪə",
            other => other,
        }
    }

    fn peak(wav: &[u8]) -> i32 {
        wav[44..]
            .chunks_exact(2)
            .map(|pair| i16::from_le_bytes([pair[0], pair[1]]).unsigned_abs() as i32)
            .max()
            .unwrap_or(0)
    }

    #[test]
    fn every_english_phone_has_a_mapping_that_espeak_reads_back_as_itself() {
        if !available() {
            return;
        }
        for phone in ENGLISH_PHONES {
            let code = espeak_code(phone).unwrap_or_else(|| panic!("{phone} 没有映射"));
            let back = expected_phones(&format!("[[{code}]]")).unwrap().concat();
            assert_eq!(back, round_trip_spelling(phone), "{phone} -> [[{code}]]");
        }
    }

    #[test]
    fn every_english_phone_is_audible_not_silence() {
        if !available() {
            return;
        }
        for phone in ENGLISH_PHONES {
            let wav = synthesize_phone(phone).unwrap_or_else(|e| panic!("{phone}: {e}"));
            assert_eq!(&wav[0..4], b"RIFF", "{phone}");
            assert!(peak(&wav) > 300, "{phone} 合成出来是静音");
        }
    }

    #[test]
    fn every_phone_espeak_emits_for_real_sentences_can_be_played() {
        if !available() {
            return;
        }
        let sentences = [
            "See the green tree, we saw four cars, your bird and the girl were near here.",
            "Boy, go home; I would think so, air is fair. Please look at the moon.",
            "Water and butter are better in the city. Roses are pretty, happy and about.",
            "The judge chose a cheap jacket. Measure the vision and thank the young man.",
            "The quick brown fox jumps over the lazy dog. Pack my box with five dozen liquor jugs.",
            "It's a beautiful day, isn't it? Could you tell me the way to the station?",
            "Unfortunately, the government announced another important decision about education.",
            "A university student studies psychology, philosophy and literature in Europe and America.",
        ];
        for sentence in sentences {
            for phone in expected_phones(sentence).unwrap() {
                assert!(
                    espeak_code(&phone).is_some(),
                    "「{sentence}」里的 {phone} 没有映射"
                );
            }
        }
    }

    #[test]
    fn unknown_phones_fail_explicitly() {
        assert!(synthesize_phone("ɡʰ").unwrap_err().contains("暂不支持"));
        assert!(synthesize_phone("").is_err());
    }

    #[test]
    fn text_starting_with_a_dash_is_spoken_not_treated_as_an_option() {
        if !available() {
            return;
        }
        let wav = synthesize_text("--version").unwrap();
        assert_eq!(&wav[0..4], b"RIFF");
        assert!(peak(&wav) > 300);
        assert!(expected_phones("--version").unwrap().len() < 20);
    }

    #[test]
    fn user_text_is_passed_after_the_end_of_options_marker() {
        assert_eq!(
            synth_args("-f x")[..],
            ["-v", "en-us", "--stdout", "--", "-f x"]
        );
        assert_eq!(
            ipa_args("hi")[..],
            ["-v", "en-us", "-q", "--ipa=1", "--", "hi"]
        );
    }

    #[test]
    fn a_phone_is_one_to_twelve_characters() {
        assert!(synthesize_phone("").unwrap_err().contains("只支持单个音素"));
        assert!(synthesize_phone(&"a".repeat(12)).unwrap_err().contains("暂不支持"));
        assert!(synthesize_phone(&"a".repeat(13)).unwrap_err().contains("只支持单个音素"));
    }

    #[test]
    fn text_is_limited_to_a_thousand_characters_and_must_not_be_blank() {
        if !available() {
            return;
        }
        assert_eq!(&synthesize_text(&"a ".repeat(500)).unwrap()[0..4], b"RIFF");
        assert!(synthesize_text(&format!("{}a", "a ".repeat(500))).unwrap_err().contains("长度"));
        assert!(synthesize_text("  ").unwrap_err().contains("长度"));
    }
}
