mod align;
mod asr;
#[cfg(test)]
mod consistency;
mod ecdict;
mod espeak;
mod paths;
mod server;
mod store;
mod wav;

use clap::{Parser, Subcommand};
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
    const DEFAULT_URL: &str = "https://raw.githubusercontent.com/skywind3000/ECDICT/master/ecdict.csv";
    // Tests point this at a local file; `curl` reads `file://` URLs too.
    let url = std::env::var("FENGSONG_ECDICT_URL").unwrap_or(DEFAULT_URL.to_string());
    // The real file has about 770 thousand entries; far fewer means a wrong download.
    const MIN_ENTRIES: usize = 1000;
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
        .arg(&url)
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
    let mut conn = rusqlite::Connection::open(dir.join("cards.sqlite"))?;
    let imported = ecdict::import(std::fs::File::open(&download)?, &mut conn, MIN_ENTRIES);
    let _ = std::fs::remove_file(&download);
    let count = imported?;
    eprintln!("已导入 {count} 条词条。");
    std::fs::write(dir.join("ECDICT-LICENSE.txt"), LICENSE)?;
    eprintln!(
        "ECDICT 已安装到 {}，保留字段：word、phonetic、translation（中文释义）、exchange（词形）。",
        dir.display()
    );
    Ok(())
}

fn setup() -> anyhow::Result<()> {
    let out = paths::app_dir().join("models");
    std::fs::create_dir_all(&out)?;
    let model = out.join("model.onnx");
    if model.is_file() {
        eprintln!("模型已经在 {}", model.display());
        return Ok(());
    }
    // Tests point this at a scratch project; the default is this source tree.
    let root = std::env::var_os("FENGSONG_ROOT")
        .map(PathBuf::from)
        .unwrap_or(PathBuf::from(env!("CARGO_MANIFEST_DIR")));
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
