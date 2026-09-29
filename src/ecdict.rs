//! Imports the ECDICT CSV into the local dictionary tables.

use crate::store::{insert_dictionary_entry, DICTIONARY_SCHEMA};
use rusqlite::Connection;
use std::io::Read;

/// Replaces the dictionary with the entries in `reader`, in one transaction:
/// a rejected import (missing column, too few rows) leaves the old dictionary as it was.
/// Returns how many entries were imported.
pub fn import<R: Read>(reader: R, conn: &mut Connection, min_rows: usize) -> anyhow::Result<usize> {
    let mut reader = csv::ReaderBuilder::new().flexible(true).from_reader(reader);
    let headers = reader.headers()?.clone();
    let column = |name: &str| {
        headers
            .iter()
            .position(|header| header == name)
            .ok_or_else(|| anyhow::anyhow!("ECDICT CSV 缺少 {name} 字段"))
    };
    let (word_i, phonetic_i, translation_i, exchange_i) =
        (column("word")?, column("phonetic")?, column("translation")?, column("exchange")?);

    let tx = conn.transaction()?;
    tx.execute_batch("DROP TABLE IF EXISTS dictionary; DROP TABLE IF EXISTS dictionary_forms;")?;
    tx.execute_batch(DICTIONARY_SCHEMA)?;
    let mut count = 0;
    for record in reader.records() {
        let record = record?;
        let field = |index: usize| record.get(index).filter(|text| !text.is_empty());
        let Some(word) = field(word_i).map(str::trim).filter(|word| !word.is_empty()) else {
            continue;
        };
        insert_dictionary_entry(&tx, word, field(phonetic_i), field(translation_i), field(exchange_i))?;
        count += 1;
    }
    if count < min_rows {
        anyhow::bail!("只导入了 {count} 条（至少需要 {min_rows} 条），下载内容不像 ECDICT CSV");
    }
    tx.commit()?;
    Ok(count)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::store::{DICTIONARY_SCHEMA, Store};

    const HEADER: &str = "word,phonetic,definition,translation,pos,collins,oxford,tag,bnc,frq,exchange,detail,audio";

    fn csv(rows: &[&str]) -> String {
        format!("{HEADER}\r\n{}\r\n", rows.join("\r\n"))
    }

    fn memory() -> Connection {
        Connection::open_in_memory().unwrap()
    }

    fn one(conn: &Connection, sql: &str) -> Option<String> {
        conn.query_row(sql, [], |r| r.get::<_, Option<String>>(0)).unwrap()
    }

    #[test]
    fn imports_quoted_commas_embedded_newlines_and_crlf() {
        let data = csv(&[
            "hello,həˈləʊ,,\"n. 问候, 招呼\\nint. 喂\",,,,,,,\"p:helloed/i:helloing\",,",
            "\"say \"\"hi\"\"\",,,\"line one\nline two\",,,,,,,,,",
        ]);
        let mut conn = memory();
        assert_eq!(import(data.as_bytes(), &mut conn, 2).unwrap(), 2);
        assert_eq!(
            one(&conn, "SELECT translation FROM dictionary WHERE word='hello'").as_deref(),
            Some("n. 问候, 招呼\nint. 喂")
        );
        assert_eq!(one(&conn, "SELECT phonetic FROM dictionary WHERE word='hello'").as_deref(), Some("həˈləʊ"));
        assert_eq!(
            one(&conn, "SELECT translation FROM dictionary WHERE word='say \"hi\"'").as_deref(),
            Some("line one\nline two")
        );
    }

    #[test]
    fn indexes_inflected_forms_of_each_entry() {
        let data = csv(&["go,,,去,,,,,,,p:went/d:gone/i:going/0:go,,"]);
        let mut conn = memory();
        import(data.as_bytes(), &mut conn, 1).unwrap();
        let forms: Vec<String> = conn
            .prepare("SELECT form FROM dictionary_forms WHERE lemma='go' ORDER BY form")
            .unwrap()
            .query_map([], |r| r.get(0))
            .unwrap()
            .map(Result::unwrap)
            .collect();
        assert_eq!(forms, ["going", "gone", "went"]);
    }

    #[test]
    fn accepts_a_byte_order_mark_and_lowercases_words() {
        let data = format!("\u{feff}{}", csv(&["Apple,,,苹果,,,,,,,,,"]));
        let mut conn = memory();
        assert_eq!(import(data.as_bytes(), &mut conn, 1).unwrap(), 1);
        assert_eq!(one(&conn, "SELECT translation FROM dictionary WHERE word='apple'").as_deref(), Some("苹果"));
    }

    #[test]
    fn skips_rows_without_a_word_and_stores_empty_fields_as_null() {
        let data = csv(&[",,,没有词,,,,,,,,,", "  ,,,空白,,,,,,,,,", "cat,,,,,,,,,,,,"]);
        let mut conn = memory();
        assert_eq!(import(data.as_bytes(), &mut conn, 1).unwrap(), 1);
        assert_eq!(one(&conn, "SELECT count(*) || '' FROM dictionary").as_deref(), Some("1"));
        assert_eq!(one(&conn, "SELECT phonetic FROM dictionary WHERE word='cat'"), None);
        assert_eq!(one(&conn, "SELECT translation FROM dictionary WHERE word='cat'"), None);
    }

    #[test]
    fn a_missing_column_is_named_in_the_error() {
        let mut conn = memory();
        let error = import("word,phonetic,definition\r\na,b,c\r\n".as_bytes(), &mut conn, 1).unwrap_err();
        assert!(error.to_string().contains("translation"), "{error}");
        let error = import("".as_bytes(), &mut conn, 1).unwrap_err();
        assert!(error.to_string().contains("word"), "{error}");
    }

    #[test]
    fn exactly_min_rows_is_enough_one_fewer_is_not() {
        let data = csv(&["a,,,一,,,,,,,,,", "b,,,二,,,,,,,,,"]);
        assert_eq!(import(data.as_bytes(), &mut memory(), 2).unwrap(), 2);
        let error = import(data.as_bytes(), &mut memory(), 3).unwrap_err();
        assert!(error.to_string().contains("2"), "{error}");
    }

    #[test]
    fn a_rejected_import_leaves_the_existing_dictionary_untouched() {
        let mut conn = memory();
        conn.execute_batch(DICTIONARY_SCHEMA).unwrap();
        crate::store::insert_dictionary_entry(&conn, "keep", None, Some("保留"), None).unwrap();
        assert!(import(csv(&["a,,,一,,,,,,,,,"]).as_bytes(), &mut conn, 5).is_err());
        assert_eq!(one(&conn, "SELECT translation FROM dictionary WHERE word='keep'").as_deref(), Some("保留"));
    }

    #[test]
    fn importing_again_replaces_old_entries_instead_of_mixing_them() {
        let mut conn = memory();
        import(csv(&["old,,,旧,,,,,,,p:olds,,"]).as_bytes(), &mut conn, 1).unwrap();
        import(csv(&["new,,,新,,,,,,,,,"]).as_bytes(), &mut conn, 1).unwrap();
        assert_eq!(one(&conn, "SELECT count(*) || '' FROM dictionary WHERE word='old'").as_deref(), Some("0"));
        assert_eq!(one(&conn, "SELECT count(*) || '' FROM dictionary_forms").as_deref(), Some("0"));
    }

    #[test]
    fn the_imported_dictionary_can_be_looked_up() {
        let dir = std::env::temp_dir().join(format!("fengsong-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("cards.sqlite");
        {
            let mut conn = Connection::open(&path).unwrap();
            import(csv(&["go,ɡəʊ,,去,,,,,,,p:went,,"]).as_bytes(), &mut conn, 1).unwrap();
        }
        let store = Store::open(&path).unwrap();
        assert_eq!(store.dictionary_lookup("went").unwrap().unwrap().0, "go");
        let _ = std::fs::remove_dir_all(&dir);
    }
}
