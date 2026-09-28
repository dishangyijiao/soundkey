use crate::align::Score;
use rusqlite::{params, Connection};
use serde::Serialize;
use uuid::Uuid;

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

impl Store {
    pub fn open(path: &std::path::Path) -> rusqlite::Result<Self> {
        let conn = Connection::open(path)?;
        conn.execute_batch(
            "
            PRAGMA journal_mode = WAL;
            PRAGMA foreign_keys = ON;
            CREATE TABLE IF NOT EXISTS cards (
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
            ",
        )?;
        Ok(Self { conn })
    }

    pub fn create_card(&self, new_card: NewCard) -> rusqlite::Result<Card> {
        let text = new_card.text.trim().to_string();
        if new_card.source == "youtube" {
            if let Some(existing) = self.find_youtube(&text, new_card.video_id.as_deref(), new_card.start_ms)? {
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
        let mut statement = self.conn.prepare("SELECT audio_path FROM attempts WHERE id = ?1")?;
        let mut rows = statement.query(params![id])?;
        if let Some(row) = rows.next()? {
            Ok(Some(row.get(0)?))
        } else {
            Ok(None)
        }
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

    fn score_for(&self, card_id: &str, text: &str) -> rusqlite::Result<(Option<Score>, Option<String>)> {
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
            serde_json::from_str(&json).ok()
        } else {
            None
        };
        Ok((score, latest_attempt_id))
    }
}

fn now() -> String {
    chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::align::{score, ErrorKind};

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

        let scored = score(
            &["θ".into(), "ɪ".into()],
            &["s".into(), "ɪ".into()],
        );
        store
            .insert_attempt(&Uuid::new_v4().to_string(), &first.id, &first.text, "audio/one.wav", &scored)
            .unwrap();
        let listed = store.list_cards().unwrap();
        assert_eq!(listed[0].score.as_ref().unwrap().match_count, 1);
        assert_eq!(listed[0].score.as_ref().unwrap().errors[0].kind, ErrorKind::Sub);

        let edited = store.update_text(&first.id, "I think this is the third.").unwrap().unwrap();
        assert!(edited.score.is_none());
        assert!(edited.latest_attempt_id.is_some());
        let _ = std::fs::remove_dir_all(&dir);
    }
}
