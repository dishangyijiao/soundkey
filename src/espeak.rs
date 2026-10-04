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

const PROGRAM: &str = "espeak-ng";

fn speak(text: &str) -> Result<Vec<u8>, String> {
    speak_with(PROGRAM, text)
}

fn speak_with(program: &str, text: &str) -> Result<Vec<u8>, String> {
    let output = Command::new(program)
        .args(synth_args(text))
        .output()
        .map_err(|_| "需要先安装 espeak-ng".to_string())?;
    if !output.status.success() || output.stdout.len() < 44 {
        return Err("合成失败".into());
    }
    Ok(output.stdout)
}

pub fn available() -> bool {
    available_with(PROGRAM)
}

fn available_with(program: &str) -> bool {
    Command::new(program)
        .arg("--version")
        .output()
        .map(|output| output.status.success())
        .unwrap_or(false)
}

fn raw_ipa_with(program: &str, text: &str) -> Result<String, String> {
    let text = text.replace(['\n', '\r'], " ");
    let output = Command::new(program)
        .args(ipa_args(&text))
        .output()
        .map_err(|_| "需要先安装 espeak-ng".to_string())?;
    if !output.status.success() {
        return Err("espeak-ng 没有读出这句的音标".to_string());
    }
    Ok(String::from_utf8_lossy(&output.stdout).into_owned())
}

pub fn expected_phones(text: &str) -> Result<Vec<String>, String> {
    expected_phones_with(PROGRAM, text)
}

fn expected_phones_with(program: &str, text: &str) -> Result<Vec<String>, String> {
    let phones = parse_ipa(&raw_ipa_with(program, text)?);
    if phones.is_empty() {
        return Err("espeak-ng 没有读出这句的音标".to_string());
    }
    Ok(phones)
}

/// The words of a sentence, split the same way as `tokenize` in
/// `extension/cues.js`: letters and digits, joined by `'`, `’`, `-` or `.`
/// when there is a letter or digit on both sides.
pub fn words(text: &str) -> Vec<String> {
    let chars: Vec<char> = text.chars().collect();
    let mut out = Vec::new();
    let mut current = String::new();
    for (index, &ch) in chars.iter().enumerate() {
        let joins = matches!(ch, '\'' | '’' | '-' | '.')
            && !current.is_empty()
            && chars.get(index + 1).is_some_and(|next| next.is_alphanumeric());
        if ch.is_alphanumeric() || joins {
            current.push(ch);
        } else if !current.is_empty() {
            out.push(std::mem::take(&mut current));
        }
    }
    if !current.is_empty() {
        out.push(current);
    }
    out
}

/// Each word of the sentence with the phones espeak-ng expects for it. The
/// whole sentence is read at once so function words keep their weak forms;
/// when espeak-ng's word boundaries do not line up with ours (numbers become
/// several words), every word is read on its own instead.
pub fn expected_words(text: &str) -> Result<Vec<(String, Vec<String>)>, String> {
    expected_words_with(PROGRAM, text)
}

fn expected_words_with(program: &str, text: &str) -> Result<Vec<(String, Vec<String>)>, String> {
    let words = words(text);
    if words.is_empty() {
        return Err("这句里没有英文单词".to_string());
    }
    let raw = raw_ipa_with(program, text)?;
    let chunks: Vec<Vec<String>> = raw.split_whitespace().map(parse_ipa).collect();
    let pairs: Vec<(String, Vec<String>)> = if chunks.len() == words.len() {
        words.into_iter().zip(chunks).collect()
    } else {
        words
            .into_iter()
            .map(|word| raw_ipa_with(program, &word).map(|raw| (word, parse_ipa(&raw))))
            .collect::<Result<_, _>>()?
    };
    if pairs.iter().all(|(_, phones)| phones.is_empty()) {
        return Err("espeak-ng 没有读出这句的音标".to_string());
    }
    Ok(pairs)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The tests that listen to real speech need espeak-ng; fail loudly
    /// instead of passing without checking anything.
    fn require_espeak() {
        assert!(available(), "these tests need espeak-ng (brew install espeak-ng)");
    }

    const NO_SUCH_PROGRAM: &str = "soundkey-no-such-program";

    #[test]
    fn a_missing_program_asks_for_the_installation() {
        let missing = "需要先安装 espeak-ng";
        assert_eq!(speak_with(NO_SUCH_PROGRAM, "hi").unwrap_err(), missing);
        assert_eq!(raw_ipa_with(NO_SUCH_PROGRAM, "hi").unwrap_err(), missing);
        assert!(!available_with(NO_SUCH_PROGRAM));
    }

    #[test]
    fn a_program_that_fails_is_a_failed_synthesis_and_a_failed_reading() {
        assert_eq!(speak_with("false", "hi").unwrap_err(), "合成失败");
        assert_eq!(raw_ipa_with("false", "hi").unwrap_err(), "espeak-ng 没有读出这句的音标");
        assert!(!available_with("false"));
    }

    #[test]
    fn a_program_that_succeeds_with_no_output_has_neither_sound_nor_phones() {
        assert_eq!(speak_with("true", "hi").unwrap_err(), "合成失败");
        assert_eq!(expected_phones_with("true", "hi").unwrap_err(), "espeak-ng 没有读出这句的音标");
        assert_eq!(expected_words_with("true", "hi").unwrap_err(), "espeak-ng 没有读出这句的音标");
        assert!(available_with("true"));
    }

    #[test]
    fn a_sentence_without_words_never_reaches_the_program() {
        assert_eq!(expected_words_with(NO_SUCH_PROGRAM, "-- ...").unwrap_err(), "这句里没有英文单词");
    }

    #[test]
    fn reads_a_sentence() {
        require_espeak();
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
        require_espeak();
        for phone in ENGLISH_PHONES {
            let code = espeak_code(phone);
            assert!(code.is_some(), "{phone} has no mapping");
            let code = code.unwrap();
            let back = expected_phones(&format!("[[{code}]]")).unwrap().concat();
            assert_eq!(back, round_trip_spelling(phone), "{phone} -> [[{code}]]");
        }
    }

    #[test]
    fn every_english_phone_is_audible_not_silence() {
        require_espeak();
        for phone in ENGLISH_PHONES {
            let wav = synthesize_phone(phone);
            assert!(wav.is_ok(), "{phone}: {wav:?}");
            let wav = wav.unwrap();
            assert_eq!(&wav[0..4], b"RIFF", "{phone}");
            assert!(peak(&wav) > 300, "{phone} was synthesized as silence");
        }
    }

    #[test]
    fn every_phone_espeak_emits_for_real_sentences_can_be_played() {
        require_espeak();
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
                    "{phone} in \"{sentence}\" has no mapping"
                );
            }
        }
    }

    #[test]
    fn words_keep_contractions_hyphens_and_abbreviations_together() {
        assert_eq!(
            words("It's 1990, well-known people don’t like the U.S. -- at all."),
            ["It's", "1990", "well-known", "people", "don’t", "like", "the", "U.S", "at", "all"]
        );
        assert!(words(" -- ... ").is_empty());
        assert_eq!(words("'quoted' -dash end-"), ["quoted", "dash", "end"]);
    }

    #[test]
    fn each_word_gets_its_own_phones_even_when_espeak_splits_a_number() {
        require_espeak();
        let pairs = expected_words("I think, in 1990.").unwrap();
        let texts: Vec<&str> = pairs.iter().map(|(word, _)| word.as_str()).collect();
        assert_eq!(texts, ["I", "think", "in", "1990"]);
        assert_eq!(pairs[1].1, ["θ", "ɪ", "ŋ", "k"]);
        assert!(pairs[3].1.len() > 8);
        assert!(expected_words("--").is_err());
    }

    #[test]
    fn unknown_phones_fail_explicitly() {
        assert!(synthesize_phone("ɡʰ").unwrap_err().contains("暂不支持"));
        assert!(synthesize_phone("").is_err());
    }

    #[test]
    fn text_starting_with_a_dash_is_spoken_not_treated_as_an_option() {
        require_espeak();
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
        require_espeak();
        assert_eq!(&synthesize_text(&"a ".repeat(500)).unwrap()[0..4], b"RIFF");
        assert!(synthesize_text(&format!("{}a", "a ".repeat(500))).unwrap_err().contains("长度"));
        assert!(synthesize_text("  ").unwrap_err().contains("长度"));
    }
}
