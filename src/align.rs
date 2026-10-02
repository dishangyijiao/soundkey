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
    #[serde(default)]
    pub columns: Vec<ScoreColumn>,
    #[serde(default)]
    pub words: Vec<ScoredWord>,
}

/// One word of the sentence and the slice of `columns` that belongs to it.
/// `phones` is how many expected phones the word has; it is what gets
/// stored, the column range is recomputed whenever the score is.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct ScoredWord {
    pub text: String,
    pub phones: usize,
    #[serde(default)]
    pub first_column: usize,
    #[serde(default)]
    pub column_count: usize,
    #[serde(default)]
    pub bad: bool,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct ScoreColumn {
    pub expected: Option<MarkedPhone>,
    pub heard: Option<MarkedPhone>,
    pub status: ColumnStatus,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ColumnStatus {
    Match,
    Sub,
    Del,
    Ins,
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
        .filter(|token| !token.is_empty() && !token.starts_with('<'))
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
    let mut columns = Vec::new();

    for step in steps {
        match step {
            Step::Match => {
                let expected_mark = MarkedPhone {
                    phone: expected[expected_index].clone(),
                    bad: false,
                };
                let heard_mark = MarkedPhone {
                    phone: heard[heard_index].clone(),
                    bad: false,
                };
                expected_marks.push(expected_mark.clone());
                heard_marks.push(heard_mark.clone());
                columns.push(ScoreColumn {
                    expected: Some(expected_mark),
                    heard: Some(heard_mark),
                    status: ColumnStatus::Match,
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
                columns.push(ScoreColumn {
                    expected: Some(expected_marks.last().unwrap().clone()),
                    heard: Some(heard_marks.last().unwrap().clone()),
                    status: ColumnStatus::Sub,
                });
                raw.push((
                    ErrorKind::Sub,
                    Some(from.clone()),
                    Some(to),
                    sound_class(&from),
                ));
                expected_index += 1;
                heard_index += 1;
            }
            Step::Del => {
                let from = expected[expected_index].clone();
                expected_marks.push(MarkedPhone {
                    phone: from.clone(),
                    bad: true,
                });
                columns.push(ScoreColumn {
                    expected: Some(expected_marks.last().unwrap().clone()),
                    heard: None,
                    status: ColumnStatus::Del,
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
                columns.push(ScoreColumn {
                    expected: None,
                    heard: Some(heard_marks.last().unwrap().clone()),
                    status: ColumnStatus::Ins,
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
        columns,
        words: Vec::new(),
    }
}

/// Score a sentence given as words, each with its own expected phones.
pub fn score_words(words: &[(String, Vec<String>)], heard: &[String]) -> Score {
    let expected: Vec<String> = words.iter().flat_map(|(_, phones)| phones.clone()).collect();
    let spans: Vec<(String, usize)> = words
        .iter()
        .map(|(text, phones)| (text.clone(), phones.len()))
        .collect();
    let mut scored = score(&expected, heard);
    attach_words(&mut scored, &spans);
    scored
}

/// Recompute a stored score with the current alignment, keeping its words.
pub fn rescore(stored: &Score) -> Score {
    let phones = |marks: &[MarkedPhone]| marks.iter().map(|m| m.phone.clone()).collect::<Vec<_>>();
    let mut scored = score(&phones(&stored.expected), &phones(&stored.heard));
    let spans: Vec<(String, usize)> =
        stored.words.iter().map(|w| (w.text.clone(), w.phones)).collect();
    attach_words(&mut scored, &spans);
    scored
}

/// Give every column to a word. A column with an expected phone belongs to the
/// word of that phone; an inserted phone belongs to the word before it (or the
/// first word, if the speaker added something before the sentence started).
/// Spans that do not add up to the expected phones are dropped, not guessed.
fn attach_words(scored: &mut Score, spans: &[(String, usize)]) {
    scored.words.clear();
    if spans.is_empty() || spans.iter().map(|(_, n)| n).sum::<usize>() != scored.expected_count {
        return;
    }
    let mut ends = Vec::with_capacity(spans.len());
    let mut total = 0;
    for (_, phones) in spans {
        total += phones;
        ends.push(total);
    }
    let mut owner = 0;
    while owner + 1 < spans.len() && ends[owner] == 0 {
        owner += 1;
    }
    let mut seen = 0;
    let mut owners = Vec::with_capacity(scored.columns.len());
    for column in &scored.columns {
        if column.expected.is_some() {
            while seen >= ends[owner] {
                owner += 1;
            }
            seen += 1;
        }
        owners.push(owner);
    }
    scored.words = spans
        .iter()
        .enumerate()
        .map(|(index, (text, phones))| {
            let first_column = owners.iter().filter(|&&o| o < index).count();
            let column_count = owners.iter().filter(|&&o| o == index).count();
            let bad = scored.columns[first_column..first_column + column_count]
                .iter()
                .any(|column| column.status != ColumnStatus::Match);
            ScoredWord {
                text: text.clone(),
                phones: *phones,
                first_column,
                column_count,
                bad,
            }
        })
        .collect();
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
            let substitution_cost = if expected[row - 1] == heard[col - 1] {
                0
            } else {
                1
            };
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
mod property_tests {
    use super::*;
    use proptest::prelude::*;
    proptest! {
        #[test]
        fn aligned_columns_project_back_to_both_original_sequences(
            expected in prop::collection::vec("[pθəɪŋɹ]{1,3}", 0..25),
            heard in prop::collection::vec("[pθəɪŋɹ]{1,3}", 0..25),
        ) {
            let scored=score(&expected,&heard);
            prop_assert_eq!(scored.columns.iter().filter_map(|c|c.expected.as_ref().map(|p|p.phone.clone())).collect::<Vec<_>>(),expected);
            prop_assert_eq!(scored.columns.iter().filter_map(|c|c.heard.as_ref().map(|p|p.phone.clone())).collect::<Vec<_>>(),heard);
        }

        #[test]
        fn word_column_ranges_tile_all_columns_in_order(
            words in prop::collection::vec(prop::collection::vec("[pθə]", 0..4), 1..6),
            heard in prop::collection::vec("[pθə]", 0..15),
        ) {
            let words: Vec<(String, Vec<String>)> = words.into_iter().enumerate().map(|(i, p)| (i.to_string(), p)).collect();
            let scored = score_words(&words, &heard);
            prop_assert_eq!(scored.words.len(), words.len());
            let mut next = 0;
            for (scored_word, (_, expected)) in scored.words.iter().zip(&words) {
                prop_assert_eq!(scored_word.first_column, next);
                next += scored_word.column_count;
                let own = &scored.columns[scored_word.first_column..next];
                prop_assert_eq!(own.iter().filter(|c| c.expected.is_some()).count(), expected.len());
            }
            prop_assert_eq!(next, scored.columns.len());
        }

        #[test]
        fn errors_add_up_to_the_edit_distance_and_to_the_expected_length(
            expected in prop::collection::vec("[pθə]", 0..12),
            heard in prop::collection::vec("[pθə]", 0..12),
        ) {
            let scored = score(&expected, &heard);
            let total: usize = scored.errors.iter().map(|e| e.count).sum();
            prop_assert_eq!(total, edit_distance(&expected, &heard));
            let missed: usize = scored
                .errors
                .iter()
                .filter(|e| e.kind != ErrorKind::Ins)
                .map(|e| e.count)
                .sum();
            prop_assert_eq!(scored.match_count + missed, expected.len());
            prop_assert_eq!(scored.expected_count, expected.len());
        }
    }

    fn edit_distance(a: &[String], b: &[String]) -> usize {
        let mut row: Vec<usize> = (0..=b.len()).collect();
        for i in 1..=a.len() {
            let mut diagonal = row[0];
            row[0] = i;
            for j in 1..=b.len() {
                let above = row[j];
                row[j] = (diagonal + usize::from(a[i - 1] != b[j - 1])).min(row[j] + 1).min(row[j - 1] + 1);
                diagonal = above;
            }
        }
        row[b.len()]
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn word_spans_that_do_not_add_up_to_the_expected_phones_are_dropped() {
        let phones = |text: &str| text.chars().map(String::from).collect::<Vec<_>>();
        let mut scored = score(&phones("ab"), &phones("ab"));
        attach_words(&mut scored, &[("ab".to_string(), 1)]);
        assert!(scored.words.is_empty());
        attach_words(&mut scored, &[("ab".to_string(), 2), ("c".to_string(), 1)]);
        assert!(scored.words.is_empty());
        attach_words(&mut scored, &[("ab".to_string(), 2)]);
        assert_eq!(scored.words.len(), 1);
        attach_words(&mut scored, &[]);
        assert!(scored.words.is_empty());
    }

    #[test]
    fn clean_phone_strips_marks_and_normalises_length_and_g() {
        assert_eq!(clean_phone("\u{02C8}θ\u{0361}ɪ"), "θɪ");
        assert_eq!(clean_phone("i:"), "i\u{02D0}");
        assert_eq!(clean_phone("g"), "\u{0261}");
        assert_eq!(clean_phone("\u{0261}"), "\u{0261}");
    }

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
        let scored = score(&phones(&["θ", "ɪ", "ŋ"]), &phones(&["s", "ɪ", "ŋ"]));
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
        let scored = score(&phones(&["ð", "ə", "ð"]), &phones(&["d", "ə"]));
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

    fn set(items: &[&str]) -> HashSet<String> {
        items.iter().map(|item| item.to_string()).collect()
    }

    #[test]
    fn vocab_phones_never_contains_an_empty_token() {
        let vocab = vocab_phones(r#"{"":0,"a":1}"#);
        assert_eq!(vocab, set(&["a"]));
    }

    #[test]
    fn vocab_phones_reads_tokens_and_drops_special_ones() {
        let vocab = vocab_phones(r#"{"<pad>":0,"a":1,"tʃ":2,"<unk>":3}"#);
        assert_eq!(vocab, set(&["a", "tʃ"]));
        assert!(vocab_phones("not json").is_empty());
    }

    #[test]
    fn fit_vocab_keeps_known_phones_and_splits_unknown_ones_into_known_pieces() {
        let vocab = set(&["a", "ɪ", "tʃ", "t", "ʃ"]);
        let fit = |phone: &str| fit_vocab(&[phone.to_string()], &vocab);
        assert_eq!(fit("a"), ["a"]);
        assert_eq!(fit("tʃ"), ["tʃ"]);
        assert_eq!(fit("aɪ"), ["a", "ɪ"]);
        assert_eq!(fit("ʃt"), ["ʃ", "t"]);
        assert_eq!(fit("aɪx"), ["aɪx"]);
        assert_eq!(fit(""), [""]);
        assert_eq!(fit_vocab(&["aɪx".to_string()], &HashSet::new()), ["aɪx"]);
    }

    fn word(text: &str, items: &[&str]) -> (String, Vec<String>) {
        (text.to_string(), phones(items))
    }

    #[test]
    fn words_get_their_own_columns_and_only_the_misread_one_is_bad() {
        let words = [word("I", &["aɪ"]), word("think", &["θ", "ɪ", "ŋ", "k"])];
        let scored = score_words(&words, &phones(&["aɪ", "s", "ɪ", "ŋ", "k"]));
        let spans: Vec<_> = scored
            .words
            .iter()
            .map(|w| (w.text.as_str(), w.first_column, w.column_count, w.bad))
            .collect();
        assert_eq!(spans, [("I", 0, 1, false), ("think", 1, 4, true)]);
    }

    #[test]
    fn an_inserted_phone_belongs_to_the_word_before_it_and_a_leading_one_to_the_first() {
        let words = [word("a", &["ə"]), word("b", &["b"])];
        let scored = score_words(&words, &phones(&["ə", "s", "b"]));
        assert_eq!((scored.words[0].column_count, scored.words[0].bad), (2, true));
        assert_eq!((scored.words[1].first_column, scored.words[1].bad), (2, false));
        let scored = score_words(&words, &phones(&["s", "ə", "b"]));
        assert_eq!((scored.words[0].first_column, scored.words[0].column_count), (0, 2));
        assert!(scored.words[0].bad);
    }

    #[test]
    fn a_word_without_phones_gets_no_columns_and_is_not_bad() {
        let words = [word("1", &[]), word("go", &["ɡ", "oʊ"])];
        let scored = score_words(&words, &phones(&["s", "ɡ", "oʊ"]));
        assert_eq!((scored.words[0].column_count, scored.words[0].bad), (0, false));
        assert_eq!((scored.words[1].first_column, scored.words[1].column_count), (0, 3));
    }

    #[test]
    fn rescoring_keeps_the_words() {
        let words = [word("I", &["aɪ"]), word("go", &["ɡ", "oʊ"])];
        let scored = score_words(&words, &phones(&["aɪ", "k", "oʊ"]));
        assert_eq!(rescore(&scored), scored);
        let mut legacy = scored.clone();
        legacy.words.clear();
        assert!(rescore(&legacy).words.is_empty());
    }

    #[test]
    fn identical_errors_are_grouped_and_different_ones_are_not() {
        let scored = score(&phones(&["θ", "θ", "θ", "ð"]), &phones(&["s", "s", "t", "ð"]));
        let counts: Vec<(Option<&str>, Option<&str>, usize)> =
            scored.errors.iter().map(|e| (e.from.as_deref(), e.to.as_deref(), e.count)).collect();
        assert_eq!(counts, [(Some("θ"), Some("s"), 2), (Some("θ"), Some("t"), 1)]);
        let scored = score(&phones(&["ð", "ð"]), &phones(&["d"]));
        assert_eq!(scored.errors.len(), 2);
        // Which of the two ð is the substitution is a tie; only the totals matter.
        for kind in [ErrorKind::Sub, ErrorKind::Del] {
            let group = scored.errors.iter().find(|error| error.kind == kind).unwrap();
            assert_eq!(group.count, 1);
        }
    }
}
