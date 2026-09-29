use crate::align::{score, Score};
use rusqlite::{params, Connection, OptionalExtension};
use serde::Deserialize;
use serde::Serialize;
use uuid::Uuid;

pub type DictionaryEntry = (String, Option<String>, Option<String>);

pub struct Store {
    conn: Connection,
}

#[derive(Clone, Debug, Serialize)]
pub struct Card {
    pub id: String,
    pub text: String,
    pub source: String,
    pub video_id: Option<String>,
    pub start_ms: Option<i64>,
    pub end_ms: Option<i64>,
    pub score: Option<Score>,
    pub latest_attempt_id: Option<String>,
}

pub struct NewCard {
    pub text: String,
    pub source: String,
    pub video_id: Option<String>,
    pub start_ms: Option<i64>,
    pub end_ms: Option<i64>,
}

#[derive(Clone, Debug, Serialize)]
pub struct Word {
    pub id: String,
    pub word: String,
    pub ipa: Option<String>,
    pub definition: Option<String>,
    pub source_sentence: Option<String>,
    pub video_id: Option<String>,
    pub start_ms: Option<i64>,
    pub end_ms: Option<i64>,
}

#[derive(Deserialize)]
pub struct NewWord {
    pub word: String,
    pub ipa: Option<String>,
    pub definition: Option<String>,
    pub source_sentence: Option<String>,
    pub video_id: Option<String>,
    pub start_ms: Option<i64>,
    pub end_ms: Option<i64>,
}

impl Store {
    pub fn open(path: &std::path::Path) -> rusqlite::Result<Self> {
        let mut conn = Connection::open(path)?;
        conn.execute_batch("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;")?;
        let version: i64 = conn.pragma_query_value(None, "user_version", |row| row.get(0))?;
        if version == 0 {
            let tx = conn.transaction()?;
            tx.execute_batch(
                "CREATE TABLE IF NOT EXISTS cards (
                id TEXT PRIMARY KEY,
                text TEXT NOT NULL,
                source TEXT NOT NULL,
                video_id TEXT,
                start_ms INTEGER,
                end_ms INTEGER,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS attempts (
                id TEXT PRIMARY KEY,
                card_id TEXT NOT NULL,
                text_snapshot TEXT NOT NULL,
                audio_path TEXT NOT NULL,
                score_json TEXT NOT NULL,
                created_at TEXT NOT NULL,
                FOREIGN KEY (card_id) REFERENCES cards(id)
            );
            CREATE TABLE words (
                id TEXT PRIMARY KEY, word TEXT NOT NULL, ipa TEXT, definition TEXT,
                source_sentence TEXT, video_id TEXT, start_ms INTEGER, end_ms INTEGER,
                created_at TEXT NOT NULL, deleted_at TEXT
            );
            CREATE INDEX words_active ON words(word) WHERE deleted_at IS NULL;
            PRAGMA user_version = 1;",
            )?;
            tx.commit()?;
        } else if version == 1 {
            // Current schema.
        } else {
            return Err(rusqlite::Error::InvalidQuery);
        }
        Ok(Self { conn })
    }

    pub fn create_card(&self, new_card: NewCard) -> rusqlite::Result<Card> {
        let text = new_card.text.trim().to_string();
        if new_card.source == "youtube" {
            if let Some(existing) =
                self.find_youtube(&text, new_card.video_id.as_deref(), new_card.start_ms)?
            {
                return self.card(&existing);
            }
        }
        let id = Uuid::new_v4().to_string();
        let now = now();
        self.conn.execute(
            "INSERT INTO cards (id, text, source, video_id, start_ms, end_ms, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            params![
                id,
                text,
                new_card.source,
                new_card.video_id,
                new_card.start_ms,
                new_card.end_ms,
                now,
                now
            ],
        )?;
        self.card(&id)
    }

    pub fn update_text(&self, id: &str, text: &str) -> rusqlite::Result<Option<Card>> {
        let text = text.trim();
        if text.is_empty() || Uuid::parse_str(id).is_err() {
            return Ok(None);
        }
        let changed = self.conn.execute(
            "UPDATE cards SET text = ?1, updated_at = ?2 WHERE id = ?3",
            params![text, now(), id],
        )?;
        if changed == 0 {
            return Ok(None);
        }
        self.card(id).map(Some)
    }

    pub fn list_cards(&self) -> rusqlite::Result<Vec<Card>> {
        let mut statement = self.conn.prepare(
            "SELECT id, text, source, video_id, start_ms, end_ms FROM cards ORDER BY created_at DESC",
        )?;
        let rows = statement.query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, Option<String>>(3)?,
                row.get::<_, Option<i64>>(4)?,
                row.get::<_, Option<i64>>(5)?,
            ))
        })?;
        let mut cards = Vec::new();
        for row in rows {
            let (id, text, source, video_id, start_ms, end_ms) = row?;
            let (score, latest_attempt_id) = self.score_for(&id, &text)?;
            cards.push(Card {
                id,
                text,
                source,
                video_id,
                start_ms,
                end_ms,
                score,
                latest_attempt_id,
            });
        }
        Ok(cards)
    }

    pub fn insert_attempt(
        &self,
        id: &str,
        card_id: &str,
        text_snapshot: &str,
        audio_path: &str,
        score: &Score,
    ) -> rusqlite::Result<()> {
        let score_json = serde_json::to_string(score).expect("score serializes");
        self.conn.execute(
            "INSERT INTO attempts (id, card_id, text_snapshot, audio_path, score_json, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![id, card_id, text_snapshot, audio_path, score_json, now()],
        )?;
        Ok(())
    }

    pub fn card_text(&self, id: &str) -> rusqlite::Result<Option<String>> {
        let mut statement = self.conn.prepare("SELECT text FROM cards WHERE id = ?1")?;
        let mut rows = statement.query(params![id])?;
        if let Some(row) = rows.next()? {
            Ok(Some(row.get(0)?))
        } else {
            Ok(None)
        }
    }

    pub fn attempt_audio(&self, id: &str) -> rusqlite::Result<Option<String>> {
        if Uuid::parse_str(id).is_err() {
            return Ok(None);
        }
        let mut statement = self
            .conn
            .prepare("SELECT audio_path FROM attempts WHERE id = ?1")?;
        let mut rows = statement.query(params![id])?;
        if let Some(row) = rows.next()? {
            Ok(Some(row.get(0)?))
        } else {
            Ok(None)
        }
    }

    pub fn words(&self) -> rusqlite::Result<Vec<Word>> {
        let mut st = self.conn.prepare("SELECT id,word,ipa,definition,source_sentence,video_id,start_ms,end_ms FROM words WHERE deleted_at IS NULL ORDER BY created_at DESC")?;
        let rows = st.query_map([], |r| {
            Ok(Word {
                id: r.get(0)?,
                word: r.get(1)?,
                ipa: r.get(2)?,
                definition: r.get(3)?,
                source_sentence: r.get(4)?,
                video_id: r.get(5)?,
                start_ms: r.get(6)?,
                end_ms: r.get(7)?,
            })
        })?;
        rows.collect()
    }

    pub fn add_word(&self, word: NewWord) -> rusqlite::Result<Word> {
        let spelling = word.word.trim().to_lowercase();
        if let Some(existing) = self.conn.query_row("SELECT id FROM words WHERE word=?1 AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 1", [&spelling], |r| r.get::<_,String>(0)).ok() {
            return self.word(&existing);
        }
        let id = Uuid::new_v4().to_string();
        self.conn.execute("INSERT INTO words(id,word,ipa,definition,source_sentence,video_id,start_ms,end_ms,created_at) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9)", params![id,spelling,word.ipa,word.definition,word.source_sentence,word.video_id,word.start_ms,word.end_ms,now()])?;
        self.word(&id)
    }

    pub fn delete_word(&self, id: &str) -> rusqlite::Result<bool> {
        if Uuid::parse_str(id).is_err() {
            return Ok(false);
        }
        Ok(self.conn.execute(
            "UPDATE words SET deleted_at=?1 WHERE id=?2 AND deleted_at IS NULL",
            params![now(), id],
        )? > 0)
    }

    /// (word, phonetic, Chinese translation). A missing dictionary table is an
    /// error, so the caller can tell the user to run `setup-dict`.
    pub fn dictionary_lookup(&self, word: &str) -> rusqlite::Result<Option<DictionaryEntry>> {
        let normalized = word.trim().to_lowercase();
        if normalized.is_empty() || normalized.len() > 80 {
            return Ok(None);
        }
        let find = |sql: &str, key: &str| {
            self.conn
                .query_row(sql, [key], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))
                .optional()
        };
        if let Some(found) = find(DIRECT_SQL, &normalized)? {
            return Ok(Some(found));
        }
        if let Some(found) = find(FORM_SQL, &normalized)? {
            return Ok(Some(found));
        }
        for candidate in lemma_candidates(&normalized) {
            if let Some(found) = find(DIRECT_SQL, &candidate)? {
                return Ok(Some(found));
            }
        }
        Ok(None)
    }

    fn word(&self, id: &str) -> rusqlite::Result<Word> {
        self.conn.query_row("SELECT id,word,ipa,definition,source_sentence,video_id,start_ms,end_ms FROM words WHERE id=?1",[id],|r|Ok(Word{id:r.get(0)?,word:r.get(1)?,ipa:r.get(2)?,definition:r.get(3)?,source_sentence:r.get(4)?,video_id:r.get(5)?,start_ms:r.get(6)?,end_ms:r.get(7)?}))
    }

    fn find_youtube(
        &self,
        text: &str,
        video_id: Option<&str>,
        start_ms: Option<i64>,
    ) -> rusqlite::Result<Option<String>> {
        let mut statement = self.conn.prepare(
            "SELECT id FROM cards WHERE source = 'youtube' AND text = ?1 AND video_id IS ?2 AND start_ms IS ?3",
        )?;
        let mut rows = statement.query(params![text, video_id, start_ms])?;
        if let Some(row) = rows.next()? {
            Ok(Some(row.get(0)?))
        } else {
            Ok(None)
        }
    }

    fn card(&self, id: &str) -> rusqlite::Result<Card> {
        let mut statement = self.conn.prepare(
            "SELECT id, text, source, video_id, start_ms, end_ms FROM cards WHERE id = ?1",
        )?;
        let mut rows = statement.query(params![id])?;
        let row = rows.next()?.expect("card exists");
        let id: String = row.get(0)?;
        let text: String = row.get(1)?;
        let (score, latest_attempt_id) = self.score_for(&id, &text)?;
        Ok(Card {
            id,
            text,
            source: row.get(2)?,
            video_id: row.get(3)?,
            start_ms: row.get(4)?,
            end_ms: row.get(5)?,
            score,
            latest_attempt_id,
        })
    }

    fn score_for(
        &self,
        card_id: &str,
        text: &str,
    ) -> rusqlite::Result<(Option<Score>, Option<String>)> {
        let mut latest = self.conn.prepare(
            "SELECT id FROM attempts WHERE card_id = ?1 ORDER BY created_at DESC LIMIT 1",
        )?;
        let mut latest_rows = latest.query(params![card_id])?;
        let latest_attempt_id = if let Some(row) = latest_rows.next()? {
            Some(row.get(0)?)
        } else {
            None
        };

        let mut matched = self.conn.prepare(
            "SELECT score_json FROM attempts WHERE card_id = ?1 AND text_snapshot = ?2 ORDER BY created_at DESC LIMIT 1",
        )?;
        let mut matched_rows = matched.query(params![card_id, text])?;
        let score = if let Some(row) = matched_rows.next()? {
            let json: String = row.get(0)?;
            serde_json::from_str::<Score>(&json).ok().map(|stored| {
                let expected = stored
                    .expected
                    .iter()
                    .map(|phone| phone.phone.clone())
                    .collect::<Vec<_>>();
                let heard = stored
                    .heard
                    .iter()
                    .map(|phone| phone.phone.clone())
                    .collect::<Vec<_>>();
                score(&expected, &heard)
            })
        } else {
            None
        };
        Ok((score, latest_attempt_id))
    }
}

/// Schema of the local dictionary built by `fengsong setup-dict`.
pub const DICTIONARY_SCHEMA: &str = "
    CREATE TABLE dictionary(word TEXT PRIMARY KEY, phonetic TEXT, translation TEXT);
    CREATE TABLE dictionary_forms(form TEXT NOT NULL, lemma TEXT NOT NULL, PRIMARY KEY(form, lemma));
";
const DIRECT_SQL: &str = "SELECT word, phonetic, translation FROM dictionary WHERE word = ?1";
const FORM_SQL: &str = "SELECT d.word, d.phonetic, d.translation FROM dictionary_forms f JOIN dictionary d ON d.word = f.lemma WHERE f.form = ?1 LIMIT 1";

/// Inflected forms listed in an ECDICT `exchange` field such as `p:ran/i:running/0:go`.
/// `0:` and `1:` are the lemma and a type flag, not forms of this word.
pub fn inflection_forms(exchange: &str) -> Vec<String> {
    let mut forms: Vec<String> = Vec::new();
    for item in exchange.split('/') {
        let Some((kind, form)) = item.split_once(':') else {
            continue;
        };
        let form = form.trim().to_lowercase();
        if matches!(kind, "0" | "1")
            || form.is_empty()
            || form.contains(':')
            || forms.contains(&form)
        {
            continue;
        }
        forms.push(form);
    }
    forms
}

/// ECDICT writes line breaks as the two characters `\` `n`.
pub fn clean_translation(raw: &str) -> Option<String> {
    let lines: Vec<&str> = raw
        .split("\\n")
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .collect();
    if lines.is_empty() {
        None
    } else {
        Some(lines.join("\n"))
    }
}

pub fn insert_dictionary_entry(
    conn: &Connection,
    word: &str,
    phonetic: Option<&str>,
    translation: Option<&str>,
    exchange: Option<&str>,
) -> rusqlite::Result<()> {
    let lemma = word.to_lowercase();
    conn.execute(
        "INSERT OR REPLACE INTO dictionary(word, phonetic, translation) VALUES(?1, ?2, ?3)",
        params![lemma, phonetic, translation.and_then(clean_translation)],
    )?;
    for form in inflection_forms(exchange.unwrap_or_default()) {
        conn.execute(
            "INSERT OR IGNORE INTO dictionary_forms(form, lemma) VALUES(?1, ?2)",
            params![form, lemma],
        )?;
    }
    Ok(())
}

fn lemma_candidates(word: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut push = |s: String| {
        if s.len() >= 2 && s != word && !out.contains(&s) {
            out.push(s);
        }
    };
    for (suffix, replacement) in [
        ("ies", "y"),
        ("ing", ""),
        ("ied", "y"),
        ("ed", ""),
        ("es", ""),
        ("s", ""),
    ] {
        if let Some(stem) = word.strip_suffix(suffix) {
            push(format!("{stem}{replacement}"));
            if suffix == "ing" || suffix == "ed" {
                push(format!("{stem}e"));
                let chars: Vec<char> = stem.chars().collect();
                if chars.len() > 1 && chars[chars.len() - 1] == chars[chars.len() - 2] {
                    push(chars[..chars.len() - 1].iter().collect());
                }
            }
        }
    }
    out
}

fn now() -> String {
    chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::align::{score, ErrorKind};
    use proptest::prelude::*;

    #[test]
    fn duplicate_youtube_card_is_reused_and_edited_text_hides_score() {
        let dir = std::env::temp_dir().join(format!("fengsong-{}", Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let store = Store::open(&dir.join("cards.sqlite")).unwrap();
        let first = store
            .create_card(NewCard {
                text: "I think this is the third time.".into(),
                source: "youtube".into(),
                video_id: Some("abc".into()),
                start_ms: Some(1000),
                end_ms: Some(2000),
            })
            .unwrap();
        let second = store
            .create_card(NewCard {
                text: "I think this is the third time.".into(),
                source: "youtube".into(),
                video_id: Some("abc".into()),
                start_ms: Some(1000),
                end_ms: Some(2000),
            })
            .unwrap();
        assert_eq!(first.id, second.id);

        let scored = score(&["θ".into(), "ɪ".into()], &["s".into(), "ɪ".into()]);
        store
            .insert_attempt(
                &Uuid::new_v4().to_string(),
                &first.id,
                &first.text,
                "audio/one.wav",
                &scored,
            )
            .unwrap();
        let listed = store.list_cards().unwrap();
        assert_eq!(listed[0].score.as_ref().unwrap().match_count, 1);
        assert_eq!(
            listed[0].score.as_ref().unwrap().errors[0].kind,
            ErrorKind::Sub
        );

        let edited = store
            .update_text(&first.id, "I think this is the third.")
            .unwrap()
            .unwrap();
        assert!(edited.score.is_none());
        assert!(edited.latest_attempt_id.is_some());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn words_deduplicate_soft_delete_and_dictionary_uses_inflections() {
        let dir = std::env::temp_dir().join(format!("fengsong-{}", Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let store = Store::open(&dir.join("cards.sqlite")).unwrap();
        store.conn.execute_batch(DICTIONARY_SCHEMA).unwrap();
        insert_dictionary_entry(
            &store.conn,
            "run",
            Some("rʌn"),
            Some("跑"),
            Some("d:ran/i:running"),
        )
        .unwrap();
        assert_eq!(
            store.dictionary_lookup("running").unwrap().unwrap().0,
            "run"
        );
        let item = NewWord {
            word: "running".into(),
            ipa: Some("ˈrʌnɪŋ".into()),
            definition: Some("跑".into()),
            source_sentence: Some("I am running".into()),
            video_id: Some("v".into()),
            start_ms: Some(1),
            end_ms: Some(2),
        };
        let first = store.add_word(item).unwrap();
        let duplicate = store
            .add_word(NewWord {
                word: "RUNNING".into(),
                ipa: None,
                definition: None,
                source_sentence: None,
                video_id: None,
                start_ms: None,
                end_ms: None,
            })
            .unwrap();
        assert_eq!(first.id, duplicate.id);
        assert_eq!(store.words().unwrap().len(), 1);
        assert!(store.delete_word(&first.id).unwrap());
        assert!(store.words().unwrap().is_empty());
        let restored = store
            .add_word(NewWord {
                word: "running".into(),
                ipa: None,
                definition: None,
                source_sentence: None,
                video_id: None,
                start_ms: None,
                end_ms: None,
            })
            .unwrap();
        assert_ne!(first.id, restored.id);
        let version: i64 = store
            .conn
            .pragma_query_value(None, "user_version", |r| r.get(0))
            .unwrap();
        assert_eq!(version, 1);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn old_score_json_is_realigned_when_read() {
        let dir = std::env::temp_dir().join(format!("fengsong-{}", Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let store = Store::open(&dir.join("cards.sqlite")).unwrap();
        let card = store
            .create_card(NewCard {
                text: "test".into(),
                source: "paste".into(),
                video_id: None,
                start_ms: None,
                end_ms: None,
            })
            .unwrap();
        let score = score(&["θ".into(), "ɪ".into()], &["s".into()]);
        let mut legacy = serde_json::to_value(&score).unwrap();
        legacy.as_object_mut().unwrap().remove("columns");
        store.conn.execute("INSERT INTO attempts(id,card_id,text_snapshot,audio_path,score_json,created_at) VALUES(?1,?2,?3,?4,?5,?6)",params![Uuid::new_v4().to_string(),card.id,card.text,"audio/x",legacy.to_string(),now()]).unwrap();
        let loaded = store.list_cards().unwrap().remove(0).score.unwrap();
        assert_eq!(loaded.columns.len(), 2);
        assert_eq!(loaded.columns[0].status, crate::align::ColumnStatus::Del);
        assert_eq!(loaded.columns[1].status, crate::align::ColumnStatus::Sub);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn common_suffix_fallbacks_are_conservative() {
        assert!(lemma_candidates("running").contains(&"run".into()));
        assert!(lemma_candidates("walked").contains(&"walk".into()));
        assert!(lemma_candidates("cities").contains(&"city".into()));
        assert!(lemma_candidates("went").is_empty());
    }
    #[test]
    fn lemma_candidates_are_distinct_and_never_the_input() {
        for word in ["running", "walked", "cities", "stopping", "days", "boxes"] {
            let candidates = lemma_candidates(word);
            assert!(candidates.iter().all(|candidate| candidate != word));
            let mut unique = candidates.clone();
            unique.sort();
            unique.dedup();
            assert_eq!(unique.len(), candidates.len());
        }
    }

    proptest! {
        #[test]
        fn arbitrary_lemma_candidates_are_distinct_and_never_the_input(word in "[a-z]{1,30}") {
            let candidates=lemma_candidates(&word);
            prop_assert!(candidates.iter().all(|candidate|candidate!=&word));
            let mut unique=candidates.clone();unique.sort();unique.dedup();prop_assert_eq!(unique.len(),candidates.len());
        }
    }

    fn dictionary_store() -> (Store, std::path::PathBuf) {
        let dir = std::env::temp_dir().join(format!("fengsong-{}", Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let store = Store::open(&dir.join("cards.sqlite")).unwrap();
        store.conn.execute_batch(DICTIONARY_SCHEMA).unwrap();
        let entries = [
            ("run", "rʌn", "v. 跑", "d:ran/i:running/3:runs"),
            ("trun", "trʌn", "n. 无关词", "i:trunning"),
            ("box", "bɒks", "n. 盒子", "s:boxes"),
            ("sandbox", "sændbɒks", "n. 沙盒", "s:sandboxes"),
            ("go", "ɡəʊ", "v. 去", "p:went/d:gone/i:going/3:goes/0:go"),
        ];
        for (word, phonetic, translation, exchange) in entries {
            insert_dictionary_entry(
                &store.conn,
                word,
                Some(phonetic),
                Some(translation),
                Some(exchange),
            )
            .unwrap();
        }
        (store, dir)
    }

    #[test]
    fn lookup_returns_the_chinese_translation_and_phonetic() {
        let (store, dir) = dictionary_store();
        let (word, phonetic, translation) = store.dictionary_lookup("Box").unwrap().unwrap();
        assert_eq!(
            (word.as_str(), phonetic.as_deref(), translation.as_deref()),
            ("box", Some("bɒks"), Some("n. 盒子"))
        );
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn lookup_without_a_dictionary_reports_the_missing_table_instead_of_no_result() {
        let dir = std::env::temp_dir().join(format!("fengsong-{}", Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let store = Store::open(&dir.join("cards.sqlite")).unwrap();
        let error = store.dictionary_lookup("hello").unwrap_err();
        assert!(error.to_string().contains("no such table"), "{error}");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn inflected_forms_resolve_to_their_lemma_by_exact_match() {
        let (store, dir) = dictionary_store();
        assert_eq!(store.dictionary_lookup("went").unwrap().unwrap().0, "go");
        assert_eq!(
            store.dictionary_lookup("running").unwrap().unwrap().0,
            "run"
        );
        assert_eq!(store.dictionary_lookup("boxes").unwrap().unwrap().0, "box");
        assert_eq!(
            store.dictionary_lookup("sandboxes").unwrap().unwrap().0,
            "sandbox"
        );
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_fragment_of_an_inflected_form_does_not_match_another_word() {
        let (store, dir) = dictionary_store();
        for fragment in ["xes", "unning", "wen", "oxes"] {
            assert!(
                store.dictionary_lookup(fragment).unwrap().is_none(),
                "{fragment}"
            );
        }
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn dictionary_queries_use_an_index() {
        let (store, dir) = dictionary_store();
        for sql in [DIRECT_SQL, FORM_SQL] {
            let plan: Vec<String> = store
                .conn
                .prepare(&format!("EXPLAIN QUERY PLAN {sql}"))
                .unwrap()
                .query_map(["x"], |row| row.get::<_, String>(3))
                .unwrap()
                .map(Result::unwrap)
                .collect();
            let plan = plan.join(" | ");
            assert!(plan.contains("SEARCH"), "{sql}: {plan}");
            assert!(!plan.contains("SCAN dictionary"), "{sql}: {plan}");
        }
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn inflection_forms_skip_lemma_pointers_and_normalise_case() {
        assert_eq!(
            inflection_forms("p:Ran/d:run/i:running/0:go/1:pdi"),
            ["ran", "run", "running"]
        );
        assert!(inflection_forms("").is_empty());
        assert!(inflection_forms("garbage").is_empty());
        assert_eq!(inflection_forms("s:boxes/s:boxes"), ["boxes"]);
    }

    proptest! {
        #[test]
        fn inflection_forms_are_clean_distinct_and_never_lemma_pointers(exchange in "[a-zA-Z0-9:/ ]{0,60}") {
            let forms = inflection_forms(&exchange);
            let mut unique = forms.clone();
            unique.sort();
            unique.dedup();
            prop_assert_eq!(unique.len(), forms.len());
            for form in &forms {
                prop_assert!(!form.is_empty() && !form.contains(['/', ':']));
                prop_assert_eq!(form.to_lowercase(), form.clone());
            }
        }
    }

    #[test]
    fn ecdict_escaped_line_breaks_become_real_ones() {
        assert_eq!(
            clean_translation("n. 盒子\\nvt. 装入盒中").unwrap(),
            "n. 盒子\nvt. 装入盒中"
        );
        assert_eq!(clean_translation("  a\\n\\nb \\n").unwrap(), "a\nb");
        assert_eq!(clean_translation("").as_deref(), None);
        assert_eq!(clean_translation(" \\n ").as_deref(), None);
    }

    #[test]
    fn stored_translation_is_cleaned() {
        let (store, dir) = dictionary_store();
        insert_dictionary_entry(&store.conn, "lid", None, Some("n. 盖\\nn. 眼睑"), None).unwrap();
        let (_, _, translation) = store.dictionary_lookup("lid").unwrap().unwrap();
        assert_eq!(translation.as_deref(), Some("n. 盖\nn. 眼睑"));
        let _ = std::fs::remove_dir_all(&dir);
    }

    proptest! {
        #[test]
        fn cleaned_translation_has_no_escaped_breaks_and_no_blank_lines(raw in "[a-z 一二\\\\n]{0,40}") {
            if let Some(clean) = clean_translation(&raw) {
                prop_assert!(!clean.contains("\\n"));
                prop_assert_eq!(clean.trim(), clean.as_str());
                prop_assert!(clean.lines().all(|line| !line.trim().is_empty()));
            }
        }
    }

    fn scratch_store() -> (Store, std::path::PathBuf) {
        let dir = std::env::temp_dir().join(format!("fengsong-{}", Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        (Store::open(&dir.join("cards.sqlite")).unwrap(), dir)
    }

    fn paste(store: &Store, text: &str) -> Card {
        store
            .create_card(NewCard { text: text.into(), source: "paste".into(), video_id: None, start_ms: None, end_ms: None })
            .unwrap()
    }

    #[test]
    fn reopening_a_database_keeps_its_data_and_version() {
        let dir = std::env::temp_dir().join(format!("fengsong-{}", Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("cards.sqlite");
        paste(&Store::open(&path).unwrap(), "kept");
        let reopened = Store::open(&path).unwrap();
        assert_eq!(reopened.list_cards().unwrap().len(), 1);
        let version: i64 = reopened.conn.pragma_query_value(None, "user_version", |r| r.get(0)).unwrap();
        assert_eq!(version, 1);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_database_from_a_newer_version_is_refused() {
        let dir = std::env::temp_dir().join(format!("fengsong-{}", Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("cards.sqlite");
        Connection::open(&path).unwrap().execute_batch("PRAGMA user_version = 99;").unwrap();
        assert!(Store::open(&path).is_err());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn card_text_finds_a_card_by_id_and_nothing_else() {
        let (store, dir) = scratch_store();
        let card = paste(&store, "find me");
        assert_eq!(store.card_text(&card.id).unwrap().as_deref(), Some("find me"));
        assert_eq!(store.card_text(&Uuid::new_v4().to_string()).unwrap(), None);
        assert_eq!(store.card_text("nope").unwrap(), None);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn update_text_ignores_blank_text_bad_ids_and_unknown_cards() {
        let (store, dir) = scratch_store();
        let card = paste(&store, "original");
        assert!(store.update_text(&card.id, "   ").unwrap().is_none());
        assert!(store.update_text("not-a-uuid", "x").unwrap().is_none());
        assert!(store.update_text(&Uuid::new_v4().to_string(), "x").unwrap().is_none());
        assert_eq!(store.card_text(&card.id).unwrap().as_deref(), Some("original"));
        assert_eq!(store.update_text(&card.id, "  changed ").unwrap().unwrap().text, "changed");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn attempt_audio_returns_the_stored_path_only_for_real_attempts() {
        let (store, dir) = scratch_store();
        let card = paste(&store, "say it");
        let attempt = Uuid::new_v4().to_string();
        let scored = score(&["a".into()], &["a".into()]);
        store.insert_attempt(&attempt, &card.id, &card.text, "audio/x.wav", &scored).unwrap();
        assert_eq!(store.attempt_audio(&attempt).unwrap().as_deref(), Some("audio/x.wav"));
        assert_eq!(store.attempt_audio(&Uuid::new_v4().to_string()).unwrap(), None);
        assert_eq!(store.attempt_audio("../etc/passwd").unwrap(), None);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn deleting_a_word_twice_or_with_a_bad_id_reports_not_found() {
        let (store, dir) = scratch_store();
        let word = store
            .add_word(NewWord { word: "gone".into(), ipa: None, definition: None, source_sentence: None, video_id: None, start_ms: None, end_ms: None })
            .unwrap();
        assert!(store.delete_word(&word.id).unwrap());
        assert!(!store.delete_word(&word.id).unwrap());
        assert!(!store.delete_word(&Uuid::new_v4().to_string()).unwrap());
        assert!(!store.delete_word("not-a-uuid").unwrap());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn lookup_length_limits_apply_before_the_dictionary_is_touched() {
        let (store, dir) = scratch_store(); // no dictionary installed
        assert!(store.dictionary_lookup(&"a".repeat(80)).is_err());
        assert!(store.dictionary_lookup(&"a".repeat(81)).unwrap().is_none());
        assert!(store.dictionary_lookup("   ").unwrap().is_none());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn lemma_candidates_follow_english_spelling_rules() {
        assert_eq!(lemma_candidates("walked"), ["walk", "walke"]);
        assert_eq!(lemma_candidates("boxes"), ["box", "boxe"]);
        assert_eq!(lemma_candidates("days"), ["day"]);
        assert!(lemma_candidates("cities").contains(&"city".to_string()));
        assert!(lemma_candidates("stopping").contains(&"stop".to_string()));
        assert!(lemma_candidates("hoping").contains(&"hope".to_string()));
        assert!(lemma_candidates("tied").contains(&"tie".to_string()));
    }

    #[test]
    fn lemma_candidates_are_never_shorter_than_two_letters_and_never_panic() {
        assert!(lemma_candidates("as").is_empty());
        assert!(lemma_candidates("is").is_empty());
        assert_eq!(lemma_candidates("bing"), ["be"]);
        assert!(lemma_candidates("").is_empty());
    }

    #[test]
    fn now_is_a_millisecond_precision_utc_timestamp() {
        let stamp = now();
        assert!(stamp.ends_with('Z'), "{stamp}");
        let parsed = chrono::DateTime::parse_from_rfc3339(&stamp).unwrap();
        assert!((chrono::Utc::now() - parsed.with_timezone(&chrono::Utc)).num_seconds().abs() < 5);
        assert_eq!(stamp.split('.').nth(1).unwrap().len(), 4); // "123Z"
    }
}
