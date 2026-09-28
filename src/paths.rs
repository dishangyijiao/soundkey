use std::path::PathBuf;

pub const PORT: u16 = 17321;

pub fn app_dir() -> PathBuf {
    let home = std::env::var("HOME").unwrap_or_else(|_| ".".into());
    PathBuf::from(home)
        .join("Library")
        .join("Application Support")
        .join("fengsong")
}

pub fn model_path() -> PathBuf {
    app_dir().join("models").join("model.onnx")
}
