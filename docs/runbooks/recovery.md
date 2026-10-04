# Recovery: back up, restore and roll back

This runbook covers the local data owned by the Rust service. Canonical storage paths and schema remain in [ADR-0005](../adr/ADR-0005-sqlite-and-local-files.md), [paths.rs](../../src/paths.rs) and migrations in [store.rs](../../src/store.rs). The service enables SQLite WAL mode. Always stop it before copying files; a live copy of just `cards.sqlite` may omit committed data still in its WAL file.

## Migrating data from the former name

Before ADR-0007 the data directory was `~/Library/Application Support/fengsong/`. With the service stopped and no `soundkey` directory present, move it once:

```bash
mv "$HOME/Library/Application Support/fengsong" "$HOME/Library/Application Support/soundkey"
```

The service does not read the old directory or the old `FENGSONG_*` variables.

## What to protect

The app data directory is `~/Library/Application Support/soundkey/` on macOS. It contains:

- `cards.sqlite`: cards, words, attempts and the imported dictionary.
- `audio/`: recordings referenced by attempts.
- `models/model.onnx`: the runtime scoring model; it can be regenerated with setup, but retaining it avoids a large export/download.
- `ECDICT-LICENSE.txt`: license copy written by dictionary setup.

Back up and restore the whole directory as one set. The model export environment `.export-venv` is in the project checkout rather than app data; it is setup tooling and is reproducible. Keep backups private because they include microphone recordings and learning history.

## Make a backup

1. Stop the service cleanly with Ctrl-C in its terminal. Close the extension panel or stop using it so it cannot submit another request.
2. Resolve the data directory. If you set `HOME` for the service, use that same home location; otherwise use your account home.

   ```zsh
   APP_DATA="$HOME/Library/Application Support/soundkey"
   BACKUP_ROOT="$HOME/Documents/soundkey-backups"
   STAMP="$(date +%Y%m%d-%H%M%S)"
   mkdir -p "$BACKUP_ROOT"
   ditto "$APP_DATA" "$BACKUP_ROOT/soundkey-$STAMP"
   ```

   Choose a backup root on a different disk for protection from disk failure. Ensure it has enough free space. Do not use a destination inside `APP_DATA`.
3. Check that the copy has a database, audio directory and model if one exists, then run an integrity check on the copied database:

   ```zsh
   test -s "$BACKUP_ROOT/soundkey-$STAMP/cards.sqlite"
   sqlite3 "$BACKUP_ROOT/soundkey-$STAMP/cards.sqlite" 'PRAGMA integrity_check;'
   ```

   Expected output: `ok`. Retain the timestamped copy; never make the only backup by overwriting it in place.

If the service cannot be stopped, do not copy its database files manually. Stop and investigate first; this application does not currently provide a coordinated online backup command.

## Restore a backup

1. Stop the service and close the extension panel. Preserve the current app data directory as a separate recovery copy before replacing anything.
2. Check `PRAGMA integrity_check` on the chosen backup. Confirm its `audio/` directory exists and that the model file is present if scoring is needed.
3. Restore the complete directory to the active app data path. Keep the old copy until the restored service has been checked.

   ```zsh
   APP_DATA="$HOME/Library/Application Support/soundkey"
   BACKUP="$HOME/Documents/soundkey-backups/soundkey-YYYYMMDD-HHMMSS"
   HOLD="$HOME/Library/Application Support/soundkey-recovery-before-restore-$(date +%Y%m%d-%H%M%S)"
   mv "$APP_DATA" "$HOLD"
   ditto "$BACKUP" "$APP_DATA"
   ```

   Replace the example backup name with the selected timestamp. If the active app data directory does not exist, omit the `mv` command. Do not merge directories: a recording file left over from newer data could otherwise be mistaken for restored data.
4. Start the same application version that last wrote the backup. Check that the service starts, the health endpoint responds, saved cards and words appear, and representative recordings play. If setup reports a missing model or speech engine, follow installation instructions in [README](../../README.md).
5. Keep `HOLD` until the restored data is confirmed. If restore fails, stop the service, move the failed restore aside, and move `HOLD` back to `APP_DATA`.

## Roll back an application update

The service migrates schemas forward only. It refuses to open a database with a schema version newer than it supports; there is no automatic downgrade. Before opening existing data with a new application version, stop the old service and take a complete backup using the procedure above.

If the new version fails after starting or migrating:

1. Stop it. Preserve the migrated app data directory for investigation.
2. Restore the complete pre-upgrade backup, including recordings, to the active app data path using the restore procedure.
3. Run the previous application version against that restored copy. Do not point an older binary at a database already migrated by the new version.

Never lower SQLite `user_version`, edit migration SQL, or copy only the database file as a rollback method. Schema migrations are in [store.rs](../../src/store.rs); the refusal of a newer schema is covered by its tests.

## Dictionary and scoring recovery

The dictionary shares `cards.sqlite`. Re-running `setup-dict` rebuilds the dictionary tables in one transaction; a rejected import preserves the previous dictionary. It does not replace the cards or attempts. A full directory restore is still the recovery path if the database itself is damaged.

The model can be regenerated with `cargo run --release -- setup`; the dictionary can be reinstalled with `cargo run --release -- setup-dict`. These setup commands write into the same app data directory. Preserve the current directory before rerunning either command if diagnosing a failure.

## Verification status

Verified on 2026-10-04 with a disposable SQLite WAL-mode database and a recording-like file: after closing the database, the full directory was copied with `ditto`, restored to another directory, the restored database returned `ok` from `PRAGMA integrity_check`, retained the committed row, and contained the recording-like file. This checks the documented file-copy mechanics only. Application-version rollback, a damaged database, backup-media failure and recovery of the owner's actual data remain untested.
