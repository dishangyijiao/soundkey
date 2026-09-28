mod align;
mod asr;
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
}

fn main() -> anyhow::Result<()> {
    match Cli::parse().command {
        Cmd::Serve => server::serve(),
        Cmd::Setup => setup(),
    }
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
