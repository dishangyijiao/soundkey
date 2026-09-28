use serde::{Deserialize, Serialize};
use std::collections::HashSet;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Step {
    Match,
    Sub,
    Del,
    Ins,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ErrorKind {
    Sub,
    Del,
    Ins,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct MarkedPhone {
    pub phone: String,
    pub bad: bool,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct GroupedError {
    pub kind: ErrorKind,
    pub from: Option<String>,
    pub to: Option<String>,
    pub class: String,
    pub count: usize,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Score {
    pub match_count: usize,
    pub expected_count: usize,
    pub expected: Vec<MarkedPhone>,
    pub heard: Vec<MarkedPhone>,
    pub errors: Vec<GroupedError>,
}

pub fn sound_class(phone: &str) -> &'static str {
    let vowel_chars = [
        'a', 'e', 'i', 'o', 'u', 'y', 'æ', 'ɑ', 'ɒ', 'ɔ', 'ə', 'ɛ', 'ɜ', 'ɪ', 'ʊ', 'ʌ', 'ø', 'œ',
        'ɨ', 'ɯ', 'ɤ', 'ɐ', 'ʏ', 'ɚ', 'ɝ', 'ᵻ', 'ʉ', 'ɵ', 'ä',
    ];
    match phone.chars().next() {
        Some(ch) if vowel_chars.contains(&ch) => "元音",
        _ => "辅音",
    }
}

pub fn clean_phone(raw: &str) -> String {
    let mut phone: String = raw
        .chars()
        .filter(|ch| {
            !matches!(
                ch,
                '\u{02C8}' | '\u{02CC}' | '\u{200D}' | '\u{200C}' | '\u{0361}' | '\u{035C}'
            )
        })
        .collect();
    phone = phone.replace(':', "\u{02D0}");
    if phone == "g" {
        phone = "ɡ".to_string();
    }
    phone
}

pub fn parse_ipa(raw: &str) -> Vec<String> {
    raw.split(|ch: char| ch.is_whitespace() || ch == '_')
        .filter(|part| !part.is_empty())
        .map(clean_phone)
        .filter(|part| !part.is_empty())
        .collect()
}

pub fn vocab_phones(vocab_json: &str) -> HashSet<String> {
    let map: serde_json::Map<String, serde_json::Value> =
        serde_json::from_str(vocab_json).unwrap_or_default();
    map.into_iter()
        .map(|(token, _)| token)
        .filter(|token| !token.starts_with('<'))
        .collect()
}

pub fn fit_vocab(phones: &[String], vocab: &HashSet<String>) -> Vec<String> {
    if vocab.is_empty() {
        return phones.to_vec();
    }
    let mut fitted = Vec::new();
    for phone in phones {
        if vocab.contains(phone) {
            fitted.push(phone.clone());
            continue;
        }
        let chars: Vec<char> = phone.chars().collect();
        let mut index = 0;
        let mut pieces = Vec::new();
        let mut stuck = false;
        while index < chars.len() {
            let mut found = None;
            for end in (index + 1..=chars.len()).rev() {
                let piece: String = chars[index..end].iter().collect();
                if vocab.contains(&piece) {
                    found = Some((end, piece));
                    break;
                }
            }
            match found {
                Some((end, piece)) => {
                    pieces.push(piece);
                    index = end;
                }
                None => {
                    stuck = true;
                    break;
                }
            }
        }
        if stuck || pieces.is_empty() {
            fitted.push(phone.clone());
        } else {
            fitted.extend(pieces);
        }
    }
    fitted
}

pub fn score(expected: &[String], heard: &[String]) -> Score {
    let steps = align(expected, heard);
    let mut expected_marks = Vec::new();
    let mut heard_marks = Vec::new();
    let mut raw = Vec::new();
    let mut expected_index = 0;
    let mut heard_index = 0;
    let mut match_count = 0;

    for step in steps {
        match step {
            Step::Match => {
                expected_marks.push(MarkedPhone {
                    phone: expected[expected_index].clone(),
                    bad: false,
                });
                heard_marks.push(MarkedPhone {
                    phone: heard[heard_index].clone(),
                    bad: false,
                });
                match_count += 1;
                expected_index += 1;
                heard_index += 1;
            }
            Step::Sub => {
                let from = expected[expected_index].clone();
                let to = heard[heard_index].clone();
                expected_marks.push(MarkedPhone {
                    phone: from.clone(),
                    bad: true,
                });
                heard_marks.push(MarkedPhone {
                    phone: to.clone(),
                    bad: true,
                });
                raw.push((ErrorKind::Sub, Some(from.clone()), Some(to), sound_class(&from)));
                expected_index += 1;
                heard_index += 1;
            }
            Step::Del => {
                let from = expected[expected_index].clone();
                expected_marks.push(MarkedPhone {
                    phone: from.clone(),
                    bad: true,
                });
                raw.push((ErrorKind::Del, Some(from.clone()), None, sound_class(&from)));
                expected_index += 1;
            }
            Step::Ins => {
                let to = heard[heard_index].clone();
                heard_marks.push(MarkedPhone {
                    phone: to.clone(),
                    bad: true,
                });
                raw.push((ErrorKind::Ins, None, Some(to.clone()), sound_class(&to)));
                heard_index += 1;
            }
        }
    }

    Score {
        match_count,
        expected_count: expected.len(),
        expected: expected_marks,
        heard: heard_marks,
        errors: group_errors(raw),
    }
}

fn group_errors(raw: Vec<(ErrorKind, Option<String>, Option<String>, &str)>) -> Vec<GroupedError> {
    let mut grouped: Vec<GroupedError> = Vec::new();
    for (kind, from, to, class) in raw {
        if let Some(existing) = grouped.iter_mut().find(|item| {
            item.kind == kind && item.from == from && item.to == to && item.class == class
        }) {
            existing.count += 1;
        } else {
            grouped.push(GroupedError {
                kind,
                from,
                to,
                class: class.to_string(),
                count: 1,
            });
        }
    }
    grouped
}

fn align(expected: &[String], heard: &[String]) -> Vec<Step> {
    let rows = expected.len();
    let cols = heard.len();
    let mut cost = vec![vec![0i32; cols + 1]; rows + 1];
    let mut back = vec![vec![Step::Match; cols + 1]; rows + 1];
    for row in 1..=rows {
        cost[row][0] = row as i32;
        back[row][0] = Step::Del;
    }
    for col in 1..=cols {
        cost[0][col] = col as i32;
        back[0][col] = Step::Ins;
    }
    for row in 1..=rows {
        for col in 1..=cols {
            let substitution_cost = if expected[row - 1] == heard[col - 1] { 0 } else { 1 };
            let substituted = cost[row - 1][col - 1] + substitution_cost;
            let deleted = cost[row - 1][col] + 1;
            let inserted = cost[row][col - 1] + 1;
            if substituted <= deleted && substituted <= inserted {
                cost[row][col] = substituted;
                back[row][col] = if substitution_cost == 0 {
                    Step::Match
                } else {
                    Step::Sub
                };
            } else if deleted <= inserted {
                cost[row][col] = deleted;
                back[row][col] = Step::Del;
            } else {
                cost[row][col] = inserted;
                back[row][col] = Step::Ins;
            }
        }
    }

    let mut steps = Vec::new();
    let mut row = rows;
    let mut col = cols;
    while row > 0 || col > 0 {
        match back[row][col] {
            Step::Match | Step::Sub => {
                steps.push(back[row][col]);
                row -= 1;
                col -= 1;
            }
            Step::Del => {
                steps.push(Step::Del);
                row -= 1;
            }
            Step::Ins => {
                steps.push(Step::Ins);
                col -= 1;
            }
        }
    }
    steps.reverse();
    steps
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_espeak_ipa() {
        let phones = parse_ipa("aɪ θ_ˈɪ_ŋ_k ð_ɪ_s ɪ_z ð_ə θ_ˈɜː_d t_ˈaɪ_m");
        assert_eq!(
            phones,
            vec![
                "aɪ", "θ", "ɪ", "ŋ", "k", "ð", "ɪ", "s", "ɪ", "z", "ð", "ə", "θ", "ɜː", "d", "t",
                "aɪ", "m",
            ]
        );
    }

    #[test]
    fn substitution_keeps_expected_length_as_denominator() {
        let scored = score(
            &phones(&["θ", "ɪ", "ŋ"]),
            &phones(&["s", "ɪ", "ŋ"]),
        );
        assert_eq!(scored.match_count, 2);
        assert_eq!(scored.expected_count, 3);
        assert!(scored.expected[0].bad);
        assert!(scored.heard[0].bad);
        assert_eq!(scored.errors.len(), 1);
        assert_eq!(scored.errors[0].kind, ErrorKind::Sub);
        assert_eq!(scored.errors[0].from.as_deref(), Some("θ"));
        assert_eq!(scored.errors[0].to.as_deref(), Some("s"));
        assert_eq!(scored.errors[0].class, "辅音");
    }

    #[test]
    fn insertion_does_not_change_denominator() {
        let scored = score(&phones(&["aɪ"]), &phones(&["aɪ", "s"]));
        assert_eq!(scored.match_count, 1);
        assert_eq!(scored.expected_count, 1);
        assert_eq!(scored.errors[0].kind, ErrorKind::Ins);
        assert_eq!(scored.errors[0].class, "辅音");
    }

    #[test]
    fn deletion_and_grouping() {
        let scored = score(
            &phones(&["ð", "ə", "ð"]),
            &phones(&["d", "ə"]),
        );
        assert_eq!(scored.match_count, 1);
        assert_eq!(scored.expected_count, 3);
        assert_eq!(scored.errors.len(), 2);
        assert_eq!(scored.errors[0].kind, ErrorKind::Sub);
        assert_eq!(scored.errors[0].count, 1);
        assert_eq!(scored.errors[1].kind, ErrorKind::Del);
        assert_eq!(scored.errors[1].class, "辅音");
    }

    #[test]
    fn diphthong_is_a_vowel() {
        assert_eq!(sound_class("aɪ"), "元音");
        assert_eq!(sound_class("ɜː"), "元音");
        assert_eq!(sound_class("ŋ"), "辅音");
    }

    fn phones(items: &[&str]) -> Vec<String> {
        items.iter().map(|item| (*item).to_string()).collect()
    }
}
