mod align;
mod asr;
mod espeak;
mod paths;
mod server;
mod store;
mod wav;

use clap::{Parser, Subcommand};
use std::io::{BufRead, BufReader};
use std::path::PathBuf;
use std::process::Command;

#[derive(Parser)]
#[command(name = "fengsong", about = "摘下一句，朗读，看哪个音没读准。")]
struct Cli {
    #[command(subcommand)]
    command: Cmd,
}

#[derive(Subcommand)]
enum Cmd {
    /// 在 127.0.0.1:17321 听卡片和朗读评分
    Serve,
    /// 把音素模型导出到本机目录
    Setup,
    /// 下载 ECDICT 并安装裁剪后的本地词典
    SetupDict,
}

fn main() -> anyhow::Result<()> {
    match Cli::parse().command {
        Cmd::Serve => server::serve(),
        Cmd::Setup => setup(),
        Cmd::SetupDict => setup_dict(),
    }
}

fn setup_dict() -> anyhow::Result<()> {
    const URL: &str = "https://raw.githubusercontent.com/skywind3000/ECDICT/master/ecdict.csv";
    const LICENSE: &str = "MIT License\n\nCopyright (c) 2025 Linwei\n\nPermission is hereby granted, free of charge, to any person obtaining a copy\nof this software and associated documentation files (the \"Software\"), to deal\nin the Software without restriction, including without limitation the rights\nto use, copy, modify, merge, publish, distribute, sublicense, and/or sell\ncopies of the Software, and to permit persons to whom the Software is\nfurnished to do so, subject to the following conditions:\n\nThe above copyright notice and this permission notice shall be included in all\ncopies or substantial portions of the Software.\n\nTHE SOFTWARE IS PROVIDED \"AS IS\", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR\nIMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,\nFITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE\nAUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER\nLIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,\nOUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE\nSOFTWARE.\n";
    eprintln!("ECDICT 基础词库约 76 万条，正在从 GitHub 下载 CSV；数据按上游 MIT 许可使用。");
    let dir = paths::app_dir();
    std::fs::create_dir_all(&dir)?;
    let download = dir.join("ecdict-download.csv.part");
    let status = Command::new("curl")
        .args([
            "--fail",
            "--location",
            "--silent",
            "--show-error",
            "--output",
        ])
        .arg(&download)
        .arg(URL)
        .status()?;
    if !status.success() {
        let _ = std::fs::remove_file(&download);
        anyhow::bail!("ECDICT 下载失败；请检查网络后重试");
    }
    let download_bytes = std::fs::metadata(&download)?.len();
    eprintln!(
        "已下载 {} MiB，正在精简并写入本地 SQLite。",
        download_bytes / (1024 * 1024)
    );
    let file = std::fs::File::open(&download)?;
    let mut reader = BufReader::new(file);
    let header = read_csv_record(&mut reader)?.ok_or_else(|| anyhow::anyhow!("ECDICT CSV 为空"))?;
    let _ = std::fs::remove_file(&download);
    let col = |name: &str| {
        header
            .iter()
            .position(|f| f == name)
            .ok_or_else(|| anyhow::anyhow!("ECDICT CSV 缺少 {name} 字段"))
    };
    let (word_i, ipa_i, def_i, exchange_i) = (
        col("word")?,
        col("phonetic")?,
        col("definition")?,
        col("exchange")?,
    );
    let mut conn = rusqlite::Connection::open(dir.join("cards.sqlite"))?;
    let tx = conn.transaction()?;
    tx.execute_batch("DROP TABLE IF EXISTS dictionary_new; CREATE TABLE dictionary_new(word TEXT PRIMARY KEY, phonetic TEXT, definition TEXT, exchange TEXT);")?;
    {
        let mut insert=tx.prepare("INSERT OR REPLACE INTO dictionary_new(word,phonetic,definition,exchange) VALUES(?1,?2,?3,?4)")?;
        let mut count = 0usize;
        while let Some(row) = read_csv_record(&mut reader)? {
            if let Some(word) = row.get(word_i).filter(|w| !w.trim().is_empty()) {
                insert.execute(rusqlite::params![
                    word.to_lowercase(),
                    row.get(ipa_i).filter(|s| !s.is_empty()),
                    row.get(def_i).filter(|s| !s.is_empty()),
                    row.get(exchange_i).filter(|s| !s.is_empty())
                ])?;
                count += 1;
            }
        }
        if count < 1000 {
            anyhow::bail!("下载内容不像 ECDICT CSV（{count} 条）");
        }
    }
    tx.execute_batch("DROP TABLE IF EXISTS dictionary; ALTER TABLE dictionary_new RENAME TO dictionary; CREATE INDEX dictionary_word ON dictionary(word);")?;
    tx.commit()?;
    std::fs::write(dir.join("ECDICT-LICENSE.txt"), LICENSE)?;
    eprintln!(
        "ECDICT 已安装到 {}，保留字段：word、phonetic、definition、exchange。",
        dir.display()
    );
    Ok(())
}

fn read_csv_record<R: BufRead>(reader: &mut R) -> std::io::Result<Option<Vec<String>>> {
    let mut record = Vec::new();
    let mut line = Vec::new();
    let mut quoted = false;
    loop {
        line.clear();
        let read = reader.read_until(b'\n', &mut line)?;
        if read == 0 {
            if record.is_empty() {
                return Ok(None);
            }
            break;
        }
        let mut index = 0;
        while index < line.len() {
            if line[index] == b'"' {
                if quoted && line.get(index + 1) == Some(&b'"') {
                    index += 2;
                    continue;
                }
                quoted = !quoted;
            }
            index += 1;
        }
        record.extend_from_slice(&line);
        if !quoted {
            break;
        }
    }
    let mut fields = Vec::new();
    let mut field = Vec::new();
    let mut index = 0;
    while index < record.len() {
        match record[index] {
            b'"' => {
                if quoted && record.get(index + 1) == Some(&b'"') {
                    field.push(b'"');
                    index += 1;
                } else {
                    quoted = !quoted;
                }
            }
            b',' if !quoted => fields.push(
                String::from_utf8_lossy(&std::mem::take(&mut field))
                    .trim_end_matches('\r')
                    .to_string(),
            ),
            b'\n' if !quoted => {
                if index + 1 == record.len() {
                    break;
                }
                field.push(b'\n');
            }
            byte => field.push(byte),
        }
        index += 1;
    }
    if fields.is_empty() || !field.is_empty() {
        fields.push(
            String::from_utf8_lossy(&field)
                .trim_end_matches('\r')
                .to_string(),
        );
    }
    if fields.first().is_some_and(|s| s.starts_with('\u{feff}')) {
        fields[0] = fields[0].trim_start_matches('\u{feff}').to_string();
    }
    Ok(Some(fields))
}

fn setup() -> anyhow::Result<()> {
    let out = paths::app_dir().join("models");
    std::fs::create_dir_all(&out)?;
    let model = out.join("model.onnx");
    if model.is_file() {
        eprintln!("模型已经在 {}", model.display());
        return Ok(());
    }
    let root = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let python = root.join(".export-venv/bin/python");
    let script = root.join("tools/export_onnx.py");
    if !python.is_file() {
        let created = Command::new("uv")
            .current_dir(&root)
            .args(["venv", "--python", "3.12", ".export-venv"])
            .status()?;
        if !created.success() {
            anyhow::bail!("创建导出环境失败");
        }
        let installed = Command::new("uv")
            .args(["pip", "install", "--python"])
            .arg(&python)
            .args(["torch", "transformers", "onnx"])
            .status()?;
        if !installed.success() {
            anyhow::bail!("安装导出依赖失败");
        }
    }
    let status = Command::new(python)
        .arg(script)
        .arg("--out")
        .arg(&out)
        .env("NO_PROXY", "127.0.0.1,localhost")
        .env("no_proxy", "127.0.0.1,localhost")
        .status()?;
    if !status.success() {
        anyhow::bail!("模型导出失败");
    }
    eprintln!("模型在 {}", out.display());
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn ecdict_csv_records_support_quotes_commas_and_newlines() {
        let bytes=b"word,definition,exchange\r\nhello,\"a greeting, often used\",\"p:hellos\"\r\nline,\"first line\nsecond line\",\r\n";
        let mut reader = BufReader::new(&bytes[..]);
        assert_eq!(
            read_csv_record(&mut reader).unwrap().unwrap(),
            vec!["word", "definition", "exchange"]
        );
        assert_eq!(
            read_csv_record(&mut reader).unwrap().unwrap(),
            vec!["hello", "a greeting, often used", "p:hellos"]
        );
        assert_eq!(
            read_csv_record(&mut reader).unwrap().unwrap(),
            vec!["line", "first line\nsecond line", ""]
        );
        assert!(read_csv_record(&mut reader).unwrap().is_none());
    }
}
