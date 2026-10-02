//! Runs the real `fengsong` binary. `HOME` points at a scratch directory so the
//! user's data is never touched; the network, `uv` and Python are replaced by
//! local files and tiny shell scripts.

use std::fs;
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Output, Stdio};
use std::time::{Duration, Instant};

const BIN: &str = env!("CARGO_BIN_EXE_fengsong");
const CSV_HEADER: &str = "word,phonetic,definition,translation,pos,collins,oxford,tag,bnc,frq,exchange,detail,audio";

struct Scratch(PathBuf);

impl Scratch {
    fn new() -> Self {
        let dir = std::env::temp_dir().join(format!("fengsong-cli-{}", std::process::id())).join(format!("{:x}", rand_suffix()));
        fs::create_dir_all(&dir).unwrap();
        Scratch(dir)
    }

    fn path(&self, relative: &str) -> PathBuf {
        self.0.join(relative)
    }

    /// The app directory the binary derives from `HOME`.
    fn app_dir(&self) -> PathBuf {
        self.path("home/Library/Application Support/fengsong")
    }

    fn command(&self, args: &[&str]) -> Command {
        let mut command = Command::new(BIN);
        command.args(args).env("HOME", self.path("home"));
        command
    }

    fn run(&self, args: &[&str]) -> Output {
        self.command(args).output().unwrap()
    }
}

impl Drop for Scratch {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

fn rand_suffix() -> u64 {
    use std::sync::atomic::{AtomicU64, Ordering};
    static NEXT: AtomicU64 = AtomicU64::new(0);
    NEXT.fetch_add(1, Ordering::SeqCst)
}

fn script(path: &Path, body: &str) {
    fs::create_dir_all(path.parent().unwrap()).unwrap();
    fs::write(path, format!("#!/bin/sh\n{body}\n")).unwrap();
    fs::set_permissions(path, fs::Permissions::from_mode(0o755)).unwrap();
}

fn stderr(output: &Output) -> String {
    String::from_utf8_lossy(&output.stderr).into_owned()
}

fn csv_with(rows: usize) -> String {
    let mut text = format!("{CSV_HEADER}\n");
    for index in 0..rows {
        text.push_str(&format!("w{index},,,释义{index},,,,,,,,,\n"));
    }
    text
}

fn file_url(path: &Path) -> String {
    format!("file://{}", path.display())
}

// ---- 命令行 ----

#[test]
fn without_a_command_it_prints_usage_and_fails() {
    let output = Scratch::new().run(&[]);
    assert_eq!(output.status.code(), Some(2));
    assert!(stderr(&output).contains("Usage"), "{}", stderr(&output));
}

#[test]
fn help_lists_the_three_commands() {
    let output = Scratch::new().run(&["--help"]);
    assert!(output.status.success());
    let text = String::from_utf8_lossy(&output.stdout).into_owned();
    for command in ["serve", "setup", "setup-dict"] {
        assert!(text.contains(command), "{text}");
    }
}

// ---- setup-dict ----

#[test]
fn setup_dict_installs_the_dictionary_and_its_license() {
    let scratch = Scratch::new();
    let source = scratch.path("ecdict.csv");
    fs::write(&source, csv_with(1000)).unwrap();
    let output = scratch.command(&["setup-dict"]).env("FENGSONG_ECDICT_URL", file_url(&source)).output().unwrap();
    assert!(output.status.success(), "{}", stderr(&output));
    assert!(stderr(&output).contains("已导入 1000 条词条"), "{}", stderr(&output));
    let conn = rusqlite::Connection::open(scratch.app_dir().join("cards.sqlite")).unwrap();
    let words: i64 = conn.query_row("SELECT count(*) FROM dictionary", [], |r| r.get(0)).unwrap();
    assert_eq!(words, 1000);
    assert!(fs::read_to_string(scratch.app_dir().join("ECDICT-LICENSE.txt")).unwrap().starts_with("MIT License"));
    assert!(!scratch.app_dir().join("ecdict-download.csv.part").exists());
}

#[test]
fn setup_dict_reports_a_failed_download_and_leaves_no_partial_file() {
    let scratch = Scratch::new();
    let output = scratch
        .command(&["setup-dict"])
        .env("FENGSONG_ECDICT_URL", file_url(&scratch.path("missing.csv")))
        .output()
        .unwrap();
    assert!(!output.status.success());
    assert!(stderr(&output).contains("下载失败"), "{}", stderr(&output));
    assert!(!scratch.app_dir().join("ecdict-download.csv.part").exists());
}

#[test]
fn setup_dict_rejects_a_download_that_is_not_the_dictionary() {
    let scratch = Scratch::new();
    let source = scratch.path("small.csv");
    fs::write(&source, csv_with(5)).unwrap();
    let output = scratch.command(&["setup-dict"]).env("FENGSONG_ECDICT_URL", file_url(&source)).output().unwrap();
    assert!(!output.status.success());
    assert!(stderr(&output).contains("至少需要"), "{}", stderr(&output));
    assert!(!scratch.app_dir().join("ecdict-download.csv.part").exists());
    assert!(!scratch.app_dir().join("ECDICT-LICENSE.txt").exists());
}

#[test]
fn setup_dict_fails_when_curl_cannot_be_started() {
    let scratch = Scratch::new();
    let output = scratch.command(&["setup-dict"]).env("PATH", scratch.path("no-bin")).output().unwrap();
    assert!(!output.status.success());
}

// ---- setup ----

fn with_export_root(scratch: &Scratch, python: &str) -> PathBuf {
    let root = scratch.path("root");
    script(&root.join(".export-venv/bin/python"), python);
    root
}

#[test]
fn setup_does_nothing_when_the_model_is_already_there() {
    let scratch = Scratch::new();
    let model = scratch.app_dir().join("models/model.onnx");
    fs::create_dir_all(model.parent().unwrap()).unwrap();
    fs::write(&model, b"model").unwrap();
    let output = scratch.run(&["setup"]);
    assert!(output.status.success(), "{}", stderr(&output));
    assert!(stderr(&output).contains("模型已经在"), "{}", stderr(&output));
}

#[test]
fn setup_runs_the_export_script_into_the_models_directory() {
    let scratch = Scratch::new();
    let root = with_export_root(&scratch, "echo \"$@\" > \"$(dirname \"$0\")/args\"\nmkdir -p \"$3\" && echo m > \"$3/model.onnx\"");
    let output = scratch.command(&["setup"]).env("FENGSONG_ROOT", &root).output().unwrap();
    assert!(output.status.success(), "{}", stderr(&output));
    assert!(stderr(&output).contains("模型在"), "{}", stderr(&output));
    assert!(scratch.app_dir().join("models/model.onnx").is_file());
    let args = fs::read_to_string(root.join(".export-venv/bin/args")).unwrap();
    assert!(args.contains("tools/export_onnx.py") && args.contains("--out"), "{args}");
}

#[test]
fn setup_reports_an_export_that_fails_or_cannot_start() {
    let scratch = Scratch::new();
    let root = with_export_root(&scratch, "exit 3");
    let output = scratch.command(&["setup"]).env("FENGSONG_ROOT", &root).output().unwrap();
    assert!(!output.status.success());
    assert!(stderr(&output).contains("模型导出失败"), "{}", stderr(&output));

    let root = scratch.path("root");
    let python = root.join(".export-venv/bin/python");
    fs::remove_file(&python).unwrap();
    fs::write(&python, "").unwrap();
    let output = scratch.command(&["setup"]).env("FENGSONG_ROOT", &root).output().unwrap();
    assert!(!output.status.success());
}

/// A `uv` that records what it was asked and fails at the step named in
/// `FAKE_UV_FAIL`. `uv venv` leaves behind a working fake `python`.
fn fake_uv(scratch: &Scratch) -> PathBuf {
    let bin = scratch.path("bin");
    script(
        &bin.join("uv"),
        "echo \"$@\" >> \"$FAKE_UV_LOG\"\n\
         if [ \"$1\" = \"$FAKE_UV_FAIL\" ]; then exit 1; fi\n\
         if [ \"$1\" = venv ]; then\n\
           mkdir -p .export-venv/bin\n\
           printf '#!/bin/sh\\nmkdir -p \"$3\" && echo m > \"$3/model.onnx\"\\n' > .export-venv/bin/python\n\
           chmod 755 .export-venv/bin/python\n\
         fi",
    );
    bin
}

fn setup_with_uv(scratch: &Scratch, fail: &str) -> (Output, String) {
    let bin = fake_uv(scratch);
    let root = scratch.path("root");
    fs::create_dir_all(&root).unwrap();
    let log = scratch.path("uv.log");
    let path = format!("{}:{}", bin.display(), std::env::var("PATH").unwrap());
    let output = scratch
        .command(&["setup"])
        .env("FENGSONG_ROOT", &root)
        .env("PATH", path)
        .env("FAKE_UV_LOG", &log)
        .env("FAKE_UV_FAIL", fail)
        .output()
        .unwrap();
    (output, fs::read_to_string(&log).unwrap_or_default())
}

#[test]
fn setup_creates_the_export_environment_with_uv_when_it_is_missing() {
    let scratch = Scratch::new();
    let (output, log) = setup_with_uv(&scratch, "none");
    assert!(output.status.success(), "{}", stderr(&output));
    assert!(log.contains("venv --python 3.12 .export-venv"), "{log}");
    assert!(log.contains("pip install --python") && log.contains("torch transformers onnx"), "{log}");
    assert!(scratch.app_dir().join("models/model.onnx").is_file());
}

#[test]
fn setup_stops_with_a_clear_message_when_uv_fails() {
    let scratch = Scratch::new();
    let (output, _) = setup_with_uv(&scratch, "venv");
    assert!(!output.status.success());
    assert!(stderr(&output).contains("创建导出环境失败"), "{}", stderr(&output));

    let scratch = Scratch::new();
    let (output, _) = setup_with_uv(&scratch, "pip");
    assert!(!output.status.success());
    assert!(stderr(&output).contains("安装导出依赖失败"), "{}", stderr(&output));
}

#[test]
fn setup_fails_when_uv_is_not_installed() {
    let scratch = Scratch::new();
    let root = scratch.path("root");
    fs::create_dir_all(&root).unwrap();
    let output = scratch
        .command(&["setup"])
        .env("FENGSONG_ROOT", &root)
        .env("PATH", scratch.path("no-bin"))
        .output()
        .unwrap();
    assert!(!output.status.success());
}

// ---- serve ----

fn free_port() -> u16 {
    TcpListener::bind("127.0.0.1:0").unwrap().local_addr().unwrap().port()
}

fn http_get(port: u16, path: &str) -> Option<String> {
    let mut stream = TcpStream::connect(("127.0.0.1", port)).ok()?;
    stream.set_read_timeout(Some(Duration::from_secs(2))).ok()?;
    write!(stream, "GET {path} HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n").ok()?;
    let mut text = String::new();
    stream.read_to_string(&mut text).ok()?;
    Some(text)
}

fn wait_for(port: u16, child: &mut Child) -> String {
    let deadline = Instant::now() + Duration::from_secs(30);
    while Instant::now() < deadline {
        if let Some(text) = http_get(port, "/health") {
            return text;
        }
        assert!(child.try_wait().unwrap().is_none(), "serve exited early");
        std::thread::sleep(Duration::from_millis(50));
    }
    panic!("serve never answered");
}

#[test]
fn serve_answers_requests_and_stops_cleanly_on_interrupt() {
    let scratch = Scratch::new();
    let port = free_port();
    let mut child = scratch
        .command(&["serve"])
        .env("FENGSONG_PORT", port.to_string())
        .stderr(Stdio::null())
        .spawn()
        .unwrap();
    let health = wait_for(port, &mut child);
    assert!(health.starts_with("HTTP/1.1 200"), "{health}");
    assert!(health.contains("\"ok\":true"), "{health}");
    assert!(scratch.app_dir().join("cards.sqlite").is_file());

    let status = Command::new("kill").args(["-INT", &child.id().to_string()]).status().unwrap();
    assert!(status.success());
    let deadline = Instant::now() + Duration::from_secs(10);
    let exit = loop {
        if let Some(exit) = child.try_wait().unwrap() {
            break exit;
        }
        assert!(Instant::now() < deadline, "serve ignored the interrupt");
        std::thread::sleep(Duration::from_millis(50));
    };
    assert!(exit.success(), "{exit:?}");
}

#[test]
fn serve_fails_when_the_port_is_taken() {
    let scratch = Scratch::new();
    let taken = TcpListener::bind("127.0.0.1:0").unwrap();
    let port = taken.local_addr().unwrap().port();
    let output = scratch.command(&["serve"]).env("FENGSONG_PORT", port.to_string()).output().unwrap();
    assert!(!output.status.success());
}

#[test]
fn serve_fails_when_the_data_directory_cannot_be_created() {
    let scratch = Scratch::new();
    fs::write(scratch.path("home"), b"a file, not a directory").unwrap();
    let output = scratch.command(&["serve"]).env("FENGSONG_PORT", free_port().to_string()).output().unwrap();
    assert!(!output.status.success());
}
