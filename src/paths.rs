use std::ffi::OsString;
use std::path::PathBuf;

pub const PORT: u16 = 17321;

/// The port to listen on: `FENGSONG_PORT` when it holds a valid port, else `PORT`.
pub fn port() -> u16 {
    port_from(std::env::var("FENGSONG_PORT").ok().as_deref())
}

fn port_from(value: Option<&str>) -> u16 {
    value.and_then(|text| text.parse().ok()).unwrap_or(PORT)
}

pub fn app_dir() -> PathBuf {
    app_dir_from(std::env::var_os("HOME"))
}

fn app_dir_from(home: Option<OsString>) -> PathBuf {
    PathBuf::from(home.unwrap_or_else(|| ".".into()))
        .join("Library")
        .join("Application Support")
        .join("fengsong")
}

pub fn model_path() -> PathBuf {
    app_dir().join("models").join("model.onnx")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_app_directory_lives_under_the_home_directory() {
        assert_eq!(
            app_dir_from(Some("/Users/me".into())),
            PathBuf::from("/Users/me/Library/Application Support/fengsong")
        );
    }

    #[test]
    fn without_a_home_directory_the_current_directory_is_used() {
        assert_eq!(
            app_dir_from(None),
            PathBuf::from("./Library/Application Support/fengsong")
        );
    }

    #[test]
    fn the_real_app_directory_and_model_path_agree() {
        assert!(model_path().starts_with(app_dir()));
        assert!(model_path().ends_with("models/model.onnx"));
    }

    #[test]
    fn the_port_defaults_and_can_be_overridden_by_a_valid_number() {
        assert_eq!(port_from(None), PORT);
        assert_eq!(port_from(Some("0")), 0);
        assert_eq!(port_from(Some("18000")), 18000);
        assert_eq!(port_from(Some("nope")), PORT);
        assert_eq!(port_from(Some("70000")), PORT);
        assert_eq!(port_from(Some("")), PORT);
    }

    #[test]
    fn the_real_port_is_a_port() {
        let _ = port();
    }
}
