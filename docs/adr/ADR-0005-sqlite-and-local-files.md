# ADR-0005: SQLite for cards, words and the dictionary; recordings as files; migrations by user_version

## Status

Accepted (written after the fact, 2026-10-03)

## Context

The app has to persist sentence cards, the score of every read-aloud attempt, the word notebook, and the dictionary used for word lookup.

Facts confirmed in the repository:

- The database is `cards.sqlite`, opened with `rusqlite` (with `bundled`, so SQLite is compiled into the program), in `~/Library/Application Support/fengsong/`.
- Recordings are WAV files under `audio/` in the same directory; the database stores only the path and the score JSON (`attempts.audio_path`, `score_json`).
- The dictionary (ECDICT) is imported into the same `cards.sqlite`, rebuilt as a whole in one transaction, and a failed import keeps the old dictionary (`src/ecdict.rs`).
- The schema version is kept in SQLite's `user_version`, currently 2; a higher version is refused rather than guessed at (`Store::open` in `src/store.rs`).
- Words are soft-deleted with `deleted_at`, and a partial index covers only the records that are not deleted.

Why this was chosen. **Confirmed by the owner:** it is a single-user local app, and SQLite needs no setup and is a single file. Also confirmed: the owner wants to analyze their own data with SQL or CSV, which a structured store makes possible.

## Decision

- All structured data goes into SQLite; audio goes into files.
- Schema changes are only ever appended as new versions, run in `user_version` order, each step in one transaction.
- Opening a database newer than the program is an error: no downgrade and no overwrite.

## Alternatives Considered

Which options were compared: not recorded.

## Consequences

### Positive

- One file, so backup and moving to another machine are simple.
- Migrations are tested, including refusing a future version.

### Negative

- Migrations only go forward; to return to an older program version the user has to back up the database themselves.
- The dictionary shares the database with the cards, and importing it rebuilds its tables; it is large (about 770 thousand entries).

### Risks

- Migrations take no automatic backup, so a failed upgrade could damage user data.

## Related

- ADR-0002
- Implementation: `src/store.rs`, `src/ecdict.rs`
- Single source of the schema: the migrations in `src/store.rs`; do not write a second copy in documents
