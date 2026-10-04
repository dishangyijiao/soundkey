use crate::align::{fit_vocab, vocab_phones};
use crate::asr::{ModelSlot, PhonemeModel};
use crate::espeak::{self, expected_phones, expected_words};
use crate::paths;
use crate::store::{NewCard, Store};
use crate::wav::{decode_wav, resample};
use axum::extract::{Path, Query, State};
use axum::http::{header, HeaderMap, Request, StatusCode};
use axum::middleware::{self, Next};
use axum::response::{IntoResponse, Response};
use axum::routing::{delete, get, patch, post};
use axum::{Json, Router};
use serde::Deserialize;
use serde_json::json;
use std::collections::HashSet;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

pub struct App {
    store: Mutex<Store>,
    dir: PathBuf,
    model: Mutex<ModelSlot>,
    espeak: bool,
    vocab: HashSet<String>,
}

impl App {
    /// Open the data directory: database, vocabulary, and the phoneme model if it
    /// is there. A missing or broken model is reported, not fatal: the server
    /// still serves cards and words and says why scoring is unavailable.
    pub fn open(dir: PathBuf, model_path: &std::path::Path) -> anyhow::Result<App> {
        Self::open_with(dir, model_path, espeak::available())
    }

    fn open_with(
        dir: PathBuf,
        model_path: &std::path::Path,
        espeak: bool,
    ) -> anyhow::Result<App> {
        std::fs::create_dir_all(dir.join("audio"))?;
        std::fs::create_dir_all(dir.join("models"))?;
        let store = Store::open(&dir.join("cards.sqlite"))?;
        let vocab = vocab_phones(include_str!("../assets/vocab.json"));
        let model = if model_path.is_file() {
            match PhonemeModel::load(model_path) {
                Ok(model) => {
                    eprintln!("音素模型已载入");
                    ModelSlot::Ready(model)
                }
                Err(error) => {
                    eprintln!("音素模型载入失败：{error}");
                    ModelSlot::Failed(error)
                }
            }
        } else {
            eprintln!("音素模型还没准备好。在项目目录运行 cargo run --release -- setup");
            ModelSlot::Missing
        };
        if !espeak {
            eprintln!("需要先安装 espeak-ng");
        }
        Ok(App {
            store: Mutex::new(store),
            dir,
            model: Mutex::new(model),
            espeak,
            vocab,
        })
    }
}

pub fn router(app: Arc<App>) -> Router {
    Router::new()
        .route("/health", get(health))
        .route("/speak", get(speak))
        .route("/lookup", get(lookup))
        .route("/phones", get(phones))
        .route("/words", get(list_words).post(create_word))
        .route("/words/{id}", delete(delete_word))
        .route("/words/{id}/attempts", post(create_word_attempt))
        .route("/cards", get(list_cards).post(create_card))
        .route("/cards/{id}", patch(update_card))
        .route("/cards/{id}/attempts", post(create_attempt))
        .route("/attempts/{id}/audio", get(attempt_audio))
        .layer(axum::extract::DefaultBodyLimit::max(3 * 1024 * 1024))
        .layer(middleware::from_fn(guard_local_access))
        .with_state(app)
}

/// The API is for the extension only. Extension pages are exempt from CORS through
/// `host_permissions`, so no CORS headers are sent at all: a web page can neither read
/// a response nor, since a form post needs no preflight, change anything, because
/// requests from any other origin are refused here. A `Host` that is not loopback
/// means the name was rebound to this machine (DNS rebinding) and is refused too.
async fn guard_local_access(request: Request<axum::body::Body>, next: Next) -> Response {
    let headers = request.headers();
    if !origin_allowed(headers) || !host_allowed(headers) {
        return ApiError::new(StatusCode::FORBIDDEN, "只接受 SoundKey 扩展的请求").into_response();
    }
    next.run(request).await
}

/// No `Origin` means not a browser cross-origin request (the extension's own audio
/// elements, curl); with one, it has to be an extension page.
fn origin_allowed(headers: &HeaderMap) -> bool {
    headers
        .get(header::ORIGIN)
        .is_none_or(|origin| origin.as_bytes().starts_with(b"chrome-extension://"))
}

/// A request that carries no `Host` cannot have been rebound.
fn host_allowed(headers: &HeaderMap) -> bool {
    headers.get(header::HOST).is_none_or(|host| {
        host.to_str().is_ok_and(|host| {
            let name = match host.strip_prefix('[') {
                Some(rest) => rest.split(']').next().unwrap_or_default(),
                None => host.rsplit_once(':').map_or(host, |(name, _)| name),
            };
            ["127.0.0.1", "localhost", "::1"].iter().any(|loopback| name.eq_ignore_ascii_case(loopback))
        })
    })
}

pub fn serve() -> anyhow::Result<()> {
    let app = App::open(paths::app_dir(), &paths::model_path())?;
    let router = router(Arc::new(app));
    let port = paths::port();
    let runtime = tokio::runtime::Runtime::new()?;
    runtime.block_on(async {
        let listener = tokio::net::TcpListener::bind(("127.0.0.1", port)).await?;
        eprintln!("SoundKey 正在监听 http://127.0.0.1:{}", listener.local_addr()?.port());
        axum::serve(listener, router)
            .with_graceful_shutdown(async {
                let _ = tokio::signal::ctrl_c().await;
            })
            .await?;
        anyhow::Ok(())
    })
}

/// Run blocking work (espeak-ng, the model) off the async threads. A panic in
/// the job becomes a server error instead of taking the connection down.
async fn blocking<T: Send + 'static>(
    job: impl FnOnce() -> T + Send + 'static,
) -> Result<T, ApiError> {
    tokio::task::spawn_blocking(job)
        .await
        .map_err(|error| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))
}

#[derive(Deserialize)]
struct SpeakQuery {
    ipa: Option<String>,
    text: Option<String>,
}
async fn speak(
    Query(query): Query<SpeakQuery>,
    State(app): State<Arc<App>>,
) -> Result<Response, ApiError> {
    if !app.espeak {
        return Err(ApiError::new(
            StatusCode::SERVICE_UNAVAILABLE,
            "需要先安装 espeak-ng",
        ));
    }
    let (ipa, text) = (query.ipa, query.text);
    if ipa.is_some() == text.is_some() {
        return Err(ApiError::new(StatusCode::BAD_REQUEST, "请提供 ipa 或 text"));
    }
    let bytes = blocking(move || match (ipa, text) {
        (Some(ipa), _) => espeak::synthesize_phone(&ipa),
        (None, text) => espeak::synthesize_text(&text.unwrap_or_default()),
    })
    .await?
    .map_err(|e| ApiError::new(StatusCode::BAD_REQUEST, e))?;
    Ok((
        [
            (header::CONTENT_TYPE, "audio/wav"),
            (header::CACHE_CONTROL, "no-store"),
        ],
        bytes,
    )
        .into_response())
}

#[derive(Deserialize)]
struct LookupQuery {
    word: String,
}
async fn lookup(
    Query(query): Query<LookupQuery>,
    State(app): State<Arc<App>>,
) -> Result<Json<serde_json::Value>, ApiError> {
    if query.word.trim().is_empty() || query.word.chars().count() > 80 {
        return Err(ApiError::new(StatusCode::BAD_REQUEST, "单词长度不合适"));
    }
    let result = app
        .store
        .lock()
        .expect("db lock")
        .dictionary_lookup(&query.word)
        .map_err(|e| {
            ApiError::new(
                StatusCode::SERVICE_UNAVAILABLE,
                if e.to_string().contains("no such table") {
                    "请先运行 soundkey setup-dict".into()
                } else {
                    e.to_string()
                },
            )
        })?;
    Ok(Json(match result {
        Some((word, ipa, definition)) => json!({"word":word,"ipa":ipa,"definition":definition}),
        None => json!({"word":query.word,"ipa":null,"definition":null}),
    }))
}

async fn list_words(State(app): State<Arc<App>>) -> Result<Json<serde_json::Value>, ApiError> {
    let words = app
        .store
        .lock()
        .expect("db lock")
        .words()
        .map_err(|e| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    Ok(Json(json!({"words":words})))
}
async fn create_word(
    State(app): State<Arc<App>>,
    Json(body): Json<crate::store::NewWord>,
) -> Result<Json<serde_json::Value>, ApiError> {
    if body.word.trim().is_empty() || body.word.chars().count() > 80 {
        return Err(ApiError::new(StatusCode::BAD_REQUEST, "单词长度不合适"));
    }
    let word = app
        .store
        .lock()
        .expect("db lock")
        .add_word(body)
        .map_err(|e| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    Ok(Json(json!({"word":word})))
}
async fn delete_word(
    State(app): State<Arc<App>>,
    Path(id): Path<String>,
) -> Result<StatusCode, ApiError> {
    let found = app
        .store
        .lock()
        .expect("db lock")
        .delete_word(&id)
        .map_err(|e| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    if found {
        Ok(StatusCode::NO_CONTENT)
    } else {
        Err(ApiError::new(StatusCode::NOT_FOUND, "没有这个生词"))
    }
}

async fn health(State(app): State<Arc<App>>) -> Json<serde_json::Value> {
    let model = matches!(*app.model.lock().expect("model lock"), ModelSlot::Ready(_));
    Json(json!({ "ok": true, "espeak": app.espeak, "model": model }))
}

async fn list_cards(State(app): State<Arc<App>>) -> Result<Json<serde_json::Value>, ApiError> {
    let cards = app
        .store
        .lock()
        .expect("db lock")
        .list_cards()
        .map_err(|error| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?;
    Ok(Json(json!({ "cards": cards })))
}

#[derive(Deserialize)]
struct CreateCard {
    text: String,
    source: String,
    video_id: Option<String>,
    start_ms: Option<i64>,
    end_ms: Option<i64>,
}

async fn create_card(
    State(app): State<Arc<App>>,
    Json(body): Json<CreateCard>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let text = body.text.trim();
    if text.is_empty() || text.chars().count() > 1000 {
        return Err(ApiError::new(StatusCode::BAD_REQUEST, "这句话是空的"));
    }
    let new_card = match body.source.as_str() {
        "paste" => NewCard {
            text: text.to_string(),
            source: "paste".into(),
            video_id: None,
            start_ms: None,
            end_ms: None,
        },
        "youtube" => {
            let video_id = body.video_id.filter(|id| !id.is_empty());
            let (Some(video_id), Some(start_ms), Some(end_ms)) =
                (video_id, body.start_ms, body.end_ms)
            else {
                return Err(ApiError::new(StatusCode::BAD_REQUEST, "这一句没有时间点"));
            };
            NewCard {
                text: text.to_string(),
                source: "youtube".into(),
                video_id: Some(video_id),
                start_ms: Some(start_ms),
                end_ms: Some(end_ms),
            }
        }
        _ => return Err(ApiError::new(StatusCode::BAD_REQUEST, "来源不对")),
    };
    let card = app
        .store
        .lock()
        .expect("db lock")
        .create_card(new_card)
        .map_err(|error| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?;
    Ok(Json(json!({ "card": card })))
}

#[derive(Deserialize)]
struct UpdateCard {
    text: String,
}

async fn update_card(
    State(app): State<Arc<App>>,
    Path(id): Path<String>,
    Json(body): Json<UpdateCard>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let text = body.text.trim();
    if text.is_empty() || text.chars().count() > 1000 {
        return Err(ApiError::new(StatusCode::BAD_REQUEST, "这句话是空的"));
    }
    let card = app
        .store
        .lock()
        .expect("db lock")
        .update_text(&id, text)
        .map_err(|error| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?
        .ok_or_else(|| ApiError::new(StatusCode::NOT_FOUND, "没有这张卡片"))?;
    Ok(Json(json!({ "card": card })))
}

#[derive(Deserialize)]
struct PhonesQuery {
    text: String,
}
async fn phones(
    Query(query): Query<PhonesQuery>,
    State(app): State<Arc<App>>,
) -> Result<Json<serde_json::Value>, ApiError> {
    if !app.espeak {
        return Err(ApiError::new(
            StatusCode::SERVICE_UNAVAILABLE,
            "需要先安装 espeak-ng",
        ));
    }
    if query.text.trim().is_empty() || query.text.chars().count() > 80 {
        return Err(ApiError::new(StatusCode::BAD_REQUEST, "单词长度不合适"));
    }
    let phones = blocking(move || expected_phones(&query.text))
        .await?
        .map_err(|e| ApiError::new(StatusCode::BAD_REQUEST, e))?;
    Ok(Json(json!({ "phones": phones })))
}

async fn create_attempt(
    State(app): State<Arc<App>>,
    Path(id): Path<String>,
    body: axum::body::Bytes,
) -> Result<Json<serde_json::Value>, ApiError> {
    let text = {
        let store = app.store.lock().expect("db lock");
        store
            .card_text(&id)
            .map_err(|error| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?
            .ok_or_else(|| ApiError::new(StatusCode::NOT_FOUND, "没有这张卡片"))?
    };
    let (attempt_id, relative, scored) = score_recording(&app, &text, &body).await?;
    app.store
        .lock()
        .expect("db lock")
        .insert_attempt(&attempt_id, &id, &text, &relative, &scored)
        .map_err(|error| {
            let _ = std::fs::remove_file(app.dir.join(&relative));
            ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error.to_string())
        })?;
    Ok(Json(json!({
        "attempt_id": attempt_id,
        "score": scored
    })))
}

async fn create_word_attempt(
    State(app): State<Arc<App>>,
    Path(id): Path<String>,
    body: axum::body::Bytes,
) -> Result<Json<serde_json::Value>, ApiError> {
    let text = {
        let store = app.store.lock().expect("db lock");
        store
            .word_text(&id)
            .map_err(|error| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?
            .ok_or_else(|| ApiError::new(StatusCode::NOT_FOUND, "没有这个生词"))?
    };
    let (attempt_id, relative, scored) = score_recording(&app, &text, &body).await?;
    app.store
        .lock()
        .expect("db lock")
        .insert_word_attempt(&attempt_id, &id, &relative, &scored)
        .map_err(|error| {
            let _ = std::fs::remove_file(app.dir.join(&relative));
            ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error.to_string())
        })?;
    Ok(Json(json!({
        "attempt_id": attempt_id,
        "score": scored
    })))
}

/// Score a WAV recording of `text` and save the audio. Returns the new attempt
/// id, the audio path relative to the app directory, and the score.
async fn score_recording(
    app: &Arc<App>,
    text: &str,
    body: &[u8],
) -> Result<(String, String, crate::align::Score), ApiError> {
    if !app.espeak {
        return Err(ApiError::new(
            StatusCode::SERVICE_UNAVAILABLE,
            "需要先安装 espeak-ng",
        ));
    }
    let (sample_rate, samples) =
        decode_wav(body).map_err(|error| ApiError::new(StatusCode::BAD_REQUEST, error))?;
    let samples = resample(&samples, sample_rate, 16_000);
    if samples.len() < 3_200 {
        return Err(ApiError::new(StatusCode::BAD_REQUEST, "没有录到声音"));
    }
    if samples.len() > 16_000 * 30 {
        return Err(ApiError::new(StatusCode::BAD_REQUEST, "这一句太长了"));
    }

    let words = {
        let text = text.to_string();
        blocking(move || expected_words(&text))
            .await?
            .map_err(|error| ApiError::new(StatusCode::BAD_REQUEST, error))?
    };
    let words: Vec<(String, Vec<String>)> = words
        .into_iter()
        .map(|(word, phones)| (word, fit_vocab(&phones, &app.vocab)))
        .collect();
    let heard = {
        let app = Arc::clone(app);
        blocking(move || recognize(&app, &samples))
            .await?
            .map_err(|error| ApiError::new(StatusCode::SERVICE_UNAVAILABLE, error))?
    };
    let scored = crate::align::score_words(&words, &heard);

    let attempt_id = uuid::Uuid::new_v4().to_string();
    let relative = format!("audio/{attempt_id}.wav");
    std::fs::write(app.dir.join(&relative), body)
        .map_err(|error| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?;
    Ok((attempt_id, relative, scored))
}

fn recognize(app: &App, samples: &[f32]) -> Result<Vec<String>, String> {
    let mut slot = app.model.lock().expect("model lock");
    match &mut *slot {
        ModelSlot::Ready(model) => model.recognize(samples),
        ModelSlot::Missing => Err("音素模型还没准备好".to_string()),
        ModelSlot::Failed(error) => Err(error.clone()),
    }
}

async fn attempt_audio(
    State(app): State<Arc<App>>,
    Path(id): Path<String>,
) -> Result<Response, ApiError> {
    let relative = app
        .store
        .lock()
        .expect("db lock")
        .attempt_audio(&id)
        .map_err(|error| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?
        .ok_or_else(|| ApiError::new(StatusCode::NOT_FOUND, "没有这段录音"))?;
    let path = app.dir.join(relative);
    let bytes =
        std::fs::read(&path).map_err(|_| ApiError::new(StatusCode::NOT_FOUND, "没有这段录音"))?;
    Ok(([(header::CONTENT_TYPE, "audio/wav")], bytes).into_response())
}

struct ApiError {
    status: StatusCode,
    message: String,
}

impl ApiError {
    fn new(status: StatusCode, message: impl Into<String>) -> Self {
        Self {
            status,
            message: message.into(),
        }
    }
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        (self.status, Json(json!({ "error": self.message }))).into_response()
    }
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use std::path::Path;
    use crate::store::DICTIONARY_SCHEMA;
    use crate::wav::pcm16_wav;
    use axum::body::Body;
    use axum::http::{HeaderMap, Method, Request};
    use serde_json::Value;
    use tower::ServiceExt;

    pub(crate) struct Fixture {
        pub(crate) app: Arc<App>,
        dir: PathBuf,
    }

    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.dir);
        }
    }

    pub(crate) fn manifest(path: &str) -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join(path)
    }

    fn scratch_dir() -> PathBuf {
        std::env::temp_dir().join(format!("soundkey-{}", uuid::Uuid::new_v4()))
    }

    pub(crate) fn fixture_with(model: &Path, tweak: impl FnOnce(&mut App)) -> Fixture {
        assert!(espeak::available(), "these tests need espeak-ng (brew install espeak-ng)");
        let dir = scratch_dir();
        let mut app = App::open(dir.clone(), model).unwrap();
        tweak(&mut app);
        Fixture { app: Arc::new(app), dir }
    }

    pub(crate) fn fixture() -> Fixture {
        fixture_with(&manifest("tests/fixtures/tiny_phoneme.onnx"), |_| {})
    }

    impl Fixture {
        pub(crate) async fn send(
            &self,
            method: Method,
            uri: &str,
            content_type: &str,
            body: Vec<u8>,
        ) -> (StatusCode, HeaderMap, Vec<u8>) {
            let request = Request::builder()
                .method(method)
                .uri(uri)
                .header("content-type", content_type)
                .body(Body::from(body))
                .unwrap();
            let response = router(Arc::clone(&self.app)).oneshot(request).await.unwrap();
            let (parts, body) = response.into_parts();
            let bytes = axum::body::to_bytes(body, usize::MAX).await.unwrap();
            (parts.status, parts.headers, bytes.to_vec())
        }

        pub(crate) async fn with_headers(
            &self,
            method: Method,
            uri: &str,
            headers: &[(&str, &str)],
            body: &str,
        ) -> (StatusCode, HeaderMap) {
            let mut request = Request::builder().method(method).uri(uri);
            for (name, value) in headers {
                request = request.header(*name, *value);
            }
            let request = request.body(Body::from(body.to_string())).unwrap();
            let response = router(Arc::clone(&self.app)).oneshot(request).await.unwrap();
            (response.status(), response.headers().clone())
        }

        pub(crate) async fn get(&self, uri: &str) -> (StatusCode, Value) {
            let (status, _, body) = self.send(Method::GET, uri, "text/plain", vec![]).await;
            (status, serde_json::from_slice(&body).unwrap_or(Value::Null))
        }

        pub(crate) async fn json(&self, method: Method, uri: &str, value: Value) -> (StatusCode, Value) {
            let body = serde_json::to_vec(&value).unwrap();
            let (status, _, body) = self.send(method, uri, "application/json", body).await;
            (status, serde_json::from_slice(&body).unwrap_or(Value::Null))
        }

        pub(crate) async fn delete(&self, uri: &str) -> (StatusCode, Value) {
            let (status, _, body) = self.send(Method::DELETE, uri, "text/plain", vec![]).await;
            (status, serde_json::from_slice(&body).unwrap_or(Value::Null))
        }

        pub(crate) async fn record(&self, uri: &str, wav: Vec<u8>) -> (StatusCode, Value) {
            let (status, _, body) = self.send(Method::POST, uri, "audio/wav", wav).await;
            (status, serde_json::from_slice(&body).unwrap_or(Value::Null))
        }

        pub(crate) fn sql(&self, sql: &str) {
            self.app.store.lock().unwrap().execute_raw(sql);
        }

        pub(crate) async fn paste(&self, text: &str) -> String {
            let (status, body) = self
                .json(Method::POST, "/cards", json!({"text": text, "source": "paste"}))
                .await;
            assert_eq!(status, StatusCode::OK, "{body}");
            body["card"]["id"].as_str().unwrap().to_string()
        }

        pub(crate) async fn save_word(&self, word: &str) -> String {
            let (status, body) = self.json(Method::POST, "/words", json!({"word": word})).await;
            assert_eq!(status, StatusCode::OK, "{body}");
            body["word"]["id"].as_str().unwrap().to_string()
        }
    }

    fn message(body: &Value) -> &str {
        body["error"].as_str().unwrap_or_default()
    }

    /// Positive samples read as `θ` and negative ones as `ɪ` with the test model.
    pub(crate) fn recording(positive: usize, negative: usize) -> Vec<u8> {
        let mut samples = vec![10_000i16; positive];
        samples.extend(vec![-10_000i16; negative]);
        pcm16_wav(16_000, &samples)
    }

    fn unknown_id() -> String {
        uuid::Uuid::new_v4().to_string()
    }

    // ---- startup ----

    #[tokio::test]
    async fn the_extension_may_call_the_api_and_gets_no_cors_headers() {
        let fx = fixture();
        let (status, headers) = fx
            .with_headers(Method::GET, "/health", &[("origin", "chrome-extension://abcdef")], "")
            .await;
        assert_eq!(status, StatusCode::OK);
        // Extension pages are exempt from CORS through host_permissions, so no web page
        // is ever told it may read a response.
        assert!(headers.get("access-control-allow-origin").is_none());
    }

    #[tokio::test]
    async fn requests_without_an_origin_header_still_work() {
        let fx = fixture();
        assert_eq!(fx.get("/health").await.0, StatusCode::OK);
    }

    #[tokio::test]
    async fn web_pages_cannot_read_or_change_anything() {
        let fx = fixture();
        for origin in ["https://evil.example", "http://127.0.0.1:8000", "null", "https://chrome-extension://x"] {
            let (status, headers) = fx.with_headers(Method::GET, "/cards", &[("origin", origin)], "").await;
            assert_eq!(status, StatusCode::FORBIDDEN, "GET from {origin}");
            assert!(headers.get("access-control-allow-origin").is_none());
        }
        // A cross-site form post needs no preflight, so the server itself must refuse it.
        let (status, _) = fx
            .with_headers(
                Method::POST,
                "/cards",
                &[("origin", "https://evil.example"), ("content-type", "text/plain")],
                r#"{"text":"planted","source":"paste"}"#,
            )
            .await;
        assert_eq!(status, StatusCode::FORBIDDEN);
        assert_eq!(fx.get("/cards").await.1["cards"].as_array().unwrap().len(), 0);
    }

    #[tokio::test]
    async fn a_web_page_preflight_is_refused() {
        let fx = fixture();
        let (status, headers) = fx
            .with_headers(
                Method::OPTIONS,
                "/cards",
                &[("origin", "https://evil.example"), ("access-control-request-method", "POST")],
                "",
            )
            .await;
        assert_eq!(status, StatusCode::FORBIDDEN);
        assert!(headers.get("access-control-allow-origin").is_none());
    }

    #[tokio::test]
    async fn only_loopback_hosts_are_served_to_stop_dns_rebinding() {
        let fx = fixture();
        for host in ["127.0.0.1:17321", "localhost:17321", "LOCALHOST", "[::1]:17321", "127.0.0.1"] {
            let (status, _) = fx.with_headers(Method::GET, "/health", &[("host", host)], "").await;
            assert_eq!(status, StatusCode::OK, "host {host}");
        }
        for host in ["evil.example:17321", "127.0.0.1.evil.example", "localhost.evil.example:17321", "[::2]:17321", ""] {
            let (status, _) = fx.with_headers(Method::GET, "/health", &[("host", host)], "").await;
            assert_eq!(status, StatusCode::FORBIDDEN, "host {host:?}");
        }
    }

    #[tokio::test]
    async fn health_reports_which_parts_are_ready() {
        let ready = fixture();
        let (status, body) = ready.get("/health").await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(body, json!({"ok": true, "espeak": true, "model": true}));

        let missing = fixture_with(&manifest("tests/fixtures/none.onnx"), |_| {});
        assert_eq!(missing.get("/health").await.1["model"], false);
    }

    #[test]
    fn opening_the_app_reports_a_missing_or_broken_model_instead_of_failing() {
        let missing = fixture_with(&manifest("tests/fixtures/none.onnx"), |_| {});
        assert!(matches!(*missing.app.model.lock().unwrap(), ModelSlot::Missing));
        let dir = scratch_dir();
        std::fs::create_dir_all(&dir).unwrap();
        let junk = dir.join("junk.onnx");
        std::fs::write(&junk, b"not a model").unwrap();
        let broken = fixture_with(&junk, |_| {});
        assert!(matches!(*broken.app.model.lock().unwrap(), ModelSlot::Failed(_)));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn opening_the_app_without_espeak_still_works_and_says_speech_is_unavailable() {
        let dir = scratch_dir();
        let app = App::open_with(dir.clone(), &dir.join("none.onnx"), false).unwrap();
        assert!(!app.espeak);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn opening_the_app_fails_when_the_directory_or_database_is_unusable() {
        let dir = scratch_dir();
        std::fs::create_dir_all(&dir).unwrap();
        let file = dir.join("occupied");
        std::fs::write(&file, b"x").unwrap();
        assert!(App::open(file.join("inside"), &dir.join("none.onnx")).is_err());

        let newer = dir.join("newer");
        std::fs::create_dir_all(&newer).unwrap();
        rusqlite::Connection::open(newer.join("cards.sqlite"))
            .unwrap()
            .execute_batch("PRAGMA user_version = 99;")
            .unwrap();
        assert!(App::open(newer, &dir.join("none.onnx")).is_err());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[tokio::test]
    async fn a_panicking_background_job_becomes_a_server_error() {
        let error = blocking(|| -> u8 { panic!("boom") }).await.err().unwrap();
        assert_eq!(error.status, StatusCode::INTERNAL_SERVER_ERROR);
        assert_eq!(blocking(|| 7).await.ok(), Some(7));
    }

    // ---- reference speech ----

    #[tokio::test]
    async fn speak_returns_a_wav_for_a_phone_or_a_text_and_never_caches_it() {
        let app = fixture();
        for uri in ["/speak?ipa=%CE%B8", "/speak?text=hello%20there"] {
            let (status, headers, body) = app.send(Method::GET, uri, "text/plain", vec![]).await;
            assert_eq!(status, StatusCode::OK, "{uri}");
            assert_eq!(headers["content-type"], "audio/wav");
            assert_eq!(headers["cache-control"], "no-store");
            assert_eq!(&body[0..4], b"RIFF");
        }
    }

    #[tokio::test]
    async fn speak_needs_exactly_one_of_ipa_or_text_and_a_phone_it_knows() {
        let app = fixture();
        assert_eq!(app.get("/speak").await.0, StatusCode::BAD_REQUEST);
        assert_eq!(app.get("/speak?ipa=a&text=b").await.0, StatusCode::BAD_REQUEST);
        let (status, body) = app.get("/speak?ipa=%C9%A1%CA%B0").await;
        assert_eq!(status, StatusCode::BAD_REQUEST);
        assert!(message(&body).contains("暂不支持"), "{body}");
    }

    #[tokio::test]
    async fn without_espeak_the_speech_routes_say_so() {
        let app = fixture_with(&manifest("tests/fixtures/tiny_phoneme.onnx"), |app| app.espeak = false);
        for uri in ["/speak?text=hi", "/phones?text=hi"] {
            let (status, body) = app.get(uri).await;
            assert_eq!(status, StatusCode::SERVICE_UNAVAILABLE, "{uri}");
            assert!(message(&body).contains("espeak-ng"));
        }
        let card = app.paste("hello").await;
        let (status, _) = app.record(&format!("/cards/{card}/attempts"), recording(4000, 0)).await;
        assert_eq!(status, StatusCode::SERVICE_UNAVAILABLE);
    }

    // ---- phonemes ----

    #[tokio::test]
    async fn phones_splits_a_word_into_its_sounds() {
        let app = fixture();
        let (status, body) = app.get("/phones?text=think").await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(body["phones"], json!(["θ", "ɪ", "ŋ", "k"]));
    }

    #[tokio::test]
    async fn phones_rejects_blank_long_or_unreadable_text() {
        let app = fixture();
        for uri in ["/phones?text=%20%20".to_string(), format!("/phones?text={}", "a".repeat(81)), "/phones?text=--".to_string()] {
            assert_eq!(app.get(&uri).await.0, StatusCode::BAD_REQUEST, "{uri}");
        }
    }

    // ---- dictionary and words ----

    #[tokio::test]
    async fn lookup_validates_the_word_and_explains_a_missing_dictionary() {
        let app = fixture();
        assert_eq!(app.get("/lookup?word=%20").await.0, StatusCode::BAD_REQUEST);
        assert_eq!(app.get(&format!("/lookup?word={}", "a".repeat(81))).await.0, StatusCode::BAD_REQUEST);
        let (status, body) = app.get("/lookup?word=go").await;
        assert_eq!(status, StatusCode::SERVICE_UNAVAILABLE);
        assert!(message(&body).contains("setup-dict"), "{body}");
    }

    #[tokio::test]
    async fn lookup_returns_the_entry_or_nulls_for_an_unknown_word() {
        let app = fixture();
        app.sql(DICTIONARY_SCHEMA);
        app.sql("INSERT INTO dictionary VALUES('go','ɡəʊ','v. 去');");
        let (status, body) = app.get("/lookup?word=GO").await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(body, json!({"word": "go", "ipa": "ɡəʊ", "definition": "v. 去"}));
        let (_, body) = app.get("/lookup?word=zzz").await;
        assert_eq!(body, json!({"word": "zzz", "ipa": null, "definition": null}));
    }

    #[tokio::test]
    async fn lookup_passes_on_other_database_errors_as_they_are() {
        let app = fixture();
        app.sql("CREATE TABLE dictionary(word TEXT);");
        let (status, body) = app.get("/lookup?word=go").await;
        assert_eq!(status, StatusCode::SERVICE_UNAVAILABLE);
        assert!(!message(&body).contains("setup-dict") && !message(&body).is_empty(), "{body}");
    }

    #[tokio::test]
    async fn words_can_be_added_listed_and_deleted() {
        let app = fixture();
        let (status, body) = app
            .json(Method::POST, "/words", json!({"word": "Think", "ipa": "θɪŋk", "definition": "想"}))
            .await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(body["word"]["word"], "think");
        let id = body["word"]["id"].as_str().unwrap().to_string();
        let (_, listed) = app.get("/words").await;
        assert_eq!(listed["words"].as_array().unwrap().len(), 1);
        assert_eq!(app.delete(&format!("/words/{id}")).await.0, StatusCode::NO_CONTENT);
        let (status, body) = app.delete(&format!("/words/{id}")).await;
        assert_eq!(status, StatusCode::NOT_FOUND);
        assert!(message(&body).contains("没有这个生词"));
        assert!(app.get("/words").await.1["words"].as_array().unwrap().is_empty());
    }

    #[tokio::test]
    async fn a_word_must_be_one_to_eighty_characters() {
        let app = fixture();
        for word in [String::new(), "  ".into(), "a".repeat(81)] {
            let (status, _) = app.json(Method::POST, "/words", json!({"word": word})).await;
            assert_eq!(status, StatusCode::BAD_REQUEST);
        }
        assert_eq!(app.json(Method::POST, "/words", json!({"word": "a".repeat(80)})).await.0, StatusCode::OK);
    }

    #[tokio::test]
    async fn a_broken_word_table_is_a_server_error_not_a_crash() {
        let app = fixture();
        app.sql("DROP TABLE word_attempts; DROP TABLE words;");
        assert_eq!(app.get("/words").await.0, StatusCode::INTERNAL_SERVER_ERROR);
        assert_eq!(app.json(Method::POST, "/words", json!({"word": "x"})).await.0, StatusCode::INTERNAL_SERVER_ERROR);
        assert_eq!(app.delete(&format!("/words/{}", unknown_id())).await.0, StatusCode::INTERNAL_SERVER_ERROR);
    }

    // ---- cards ----

    #[tokio::test]
    async fn cards_start_empty_and_list_what_was_added() {
        let app = fixture();
        assert!(app.get("/cards").await.1["cards"].as_array().unwrap().is_empty());
        app.paste("I think so.").await;
        assert_eq!(app.get("/cards").await.1["cards"].as_array().unwrap().len(), 1);
    }

    #[tokio::test]
    async fn a_youtube_card_needs_its_times_and_the_same_clip_is_one_card() {
        let app = fixture();
        let clip = json!({"text": "Hello.", "source": "youtube", "video_id": "abc", "start_ms": 0, "end_ms": 900});
        let (status, first) = app.json(Method::POST, "/cards", clip.clone()).await;
        assert_eq!(status, StatusCode::OK);
        let (_, second) = app.json(Method::POST, "/cards", clip).await;
        assert_eq!(first["card"]["id"], second["card"]["id"]);
        for broken in [
            json!({"text": "Hi", "source": "youtube", "video_id": "abc", "start_ms": 1}),
            json!({"text": "Hi", "source": "youtube", "start_ms": 1, "end_ms": 2}),
            json!({"text": "Hi", "source": "youtube", "video_id": "", "start_ms": 1, "end_ms": 2}),
        ] {
            let (status, body) = app.json(Method::POST, "/cards", broken).await;
            assert_eq!(status, StatusCode::BAD_REQUEST);
            assert!(message(&body).contains("时间点"), "{body}");
        }
    }

    #[tokio::test]
    async fn a_card_needs_text_of_a_sensible_length_and_a_known_source() {
        let app = fixture();
        for text in [String::new(), "   ".into(), "a".repeat(1001)] {
            let (status, body) = app.json(Method::POST, "/cards", json!({"text": text, "source": "paste"})).await;
            assert_eq!(status, StatusCode::BAD_REQUEST);
            assert!(message(&body).contains("空"));
        }
        let (status, body) = app.json(Method::POST, "/cards", json!({"text": "Hi", "source": "tv"})).await;
        assert_eq!(status, StatusCode::BAD_REQUEST);
        assert!(message(&body).contains("来源"));
        assert_eq!(app.json(Method::POST, "/cards", json!({"text": "a".repeat(1000), "source": "paste"})).await.0, StatusCode::OK);
    }

    #[tokio::test]
    async fn editing_a_card_changes_its_text_and_rejects_bad_edits() {
        let app = fixture();
        let id = app.paste("Hello").await;
        let (status, body) = app.json(Method::PATCH, &format!("/cards/{id}"), json!({"text": " Hello there "})).await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(body["card"]["text"], "Hello there");
        for text in [String::new(), "a".repeat(1001)] {
            assert_eq!(app.json(Method::PATCH, &format!("/cards/{id}"), json!({"text": text})).await.0, StatusCode::BAD_REQUEST);
        }
        let (status, body) = app.json(Method::PATCH, &format!("/cards/{}", unknown_id()), json!({"text": "x"})).await;
        assert_eq!(status, StatusCode::NOT_FOUND);
        assert!(message(&body).contains("没有这张卡片"));
    }

    #[tokio::test]
    async fn a_broken_card_table_is_a_server_error_not_a_crash() {
        let app = fixture();
        let id = app.paste("Hello").await;
        app.sql("DROP TABLE attempts; DROP TABLE cards;");
        assert_eq!(app.get("/cards").await.0, StatusCode::INTERNAL_SERVER_ERROR);
        assert_eq!(app.json(Method::POST, "/cards", json!({"text": "x", "source": "paste"})).await.0, StatusCode::INTERNAL_SERVER_ERROR);
        assert_eq!(app.json(Method::PATCH, &format!("/cards/{id}"), json!({"text": "y"})).await.0, StatusCode::INTERNAL_SERVER_ERROR);
        let (status, _) = app.record(&format!("/cards/{id}/attempts"), recording(4000, 0)).await;
        assert_eq!(status, StatusCode::INTERNAL_SERVER_ERROR);
    }

    // ---- read-aloud scoring ----

    // REQ-005: the result has the counts and marked words; the recording is kept and playable.
    #[tokio::test]
    async fn a_recording_is_scored_stored_and_can_be_played_back() {
        let app = fixture();
        let id = app.paste("think").await;
        let wav = recording(4000, 4000);
        let (status, body) = app.record(&format!("/cards/{id}/attempts"), wav.clone()).await;
        assert_eq!(status, StatusCode::OK, "{body}");
        let score = &body["score"];
        assert_eq!(score["expected_count"], 4);
        assert_eq!(score["match_count"], 2);
        assert_eq!(score["words"][0]["text"], "think");
        assert_eq!(score["words"][0]["bad"], true);

        let (_, cards) = app.get("/cards").await;
        assert_eq!(cards["cards"][0]["latest_attempt_id"], body["attempt_id"]);
        assert_eq!(cards["cards"][0]["score"]["match_count"], 2);

        let uri = format!("/attempts/{}/audio", body["attempt_id"].as_str().unwrap());
        let (status, headers, bytes) = app.send(Method::GET, &uri, "text/plain", vec![]).await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(headers["content-type"], "audio/wav");
        assert_eq!(bytes, wav);
    }

    // REQ-005: a word can be read aloud and scored, not only a sentence.
    #[tokio::test]
    async fn a_word_recording_is_scored_against_the_word_and_shows_in_the_notebook() {
        let app = fixture();
        let id = app.save_word("think").await;
        let (status, body) = app.record(&format!("/words/{id}/attempts"), recording(4000, 4000)).await;
        assert_eq!(status, StatusCode::OK, "{body}");
        assert_eq!(body["score"]["match_count"], 2);
        let (_, words) = app.get("/words").await;
        assert_eq!(words["words"][0]["latest_attempt_id"], body["attempt_id"]);
        assert_eq!(words["words"][0]["score"]["expected_count"], 4);
        let uri = format!("/attempts/{}/audio", body["attempt_id"].as_str().unwrap());
        assert_eq!(app.send(Method::GET, &uri, "text/plain", vec![]).await.0, StatusCode::OK);
    }

    #[tokio::test]
    async fn attempts_on_something_that_does_not_exist_are_not_found() {
        let app = fixture();
        let (status, body) = app.record(&format!("/cards/{}/attempts", unknown_id()), recording(4000, 0)).await;
        assert_eq!(status, StatusCode::NOT_FOUND);
        assert!(message(&body).contains("没有这张卡片"));
        let (status, body) = app.record(&format!("/words/{}/attempts", unknown_id()), recording(4000, 0)).await;
        assert_eq!(status, StatusCode::NOT_FOUND);
        assert!(message(&body).contains("没有这个生词"));
    }

    // REQ-005: 0.2 to 30 seconds are accepted; shorter or longer is refused with a message.
    #[tokio::test]
    async fn unusable_recordings_are_rejected_with_a_reason() {
        let app = fixture();
        let id = app.paste("think").await;
        let uri = format!("/cards/{id}/attempts");
        let (status, body) = app.record(&uri, b"not audio at all, just some text".to_vec()).await;
        assert_eq!(status, StatusCode::BAD_REQUEST);
        assert!(message(&body).contains("wav"));
        let (status, body) = app.record(&uri, recording(3199, 0)).await;
        assert_eq!(status, StatusCode::BAD_REQUEST);
        assert!(message(&body).contains("没有录到声音"));
        let (status, body) = app.record(&uri, recording(16_000 * 30 + 1, 0)).await;
        assert_eq!(status, StatusCode::BAD_REQUEST);
        assert!(message(&body).contains("太长"));
        assert_eq!(app.record(&uri, recording(3200, 0)).await.0, StatusCode::OK);
        assert_eq!(app.record(&uri, recording(16_000 * 30, 0)).await.0, StatusCode::OK);
    }

    #[tokio::test]
    async fn a_body_over_three_megabytes_is_refused_before_it_is_read() {
        let app = fixture();
        let id = app.paste("think").await;
        let (status, _) = app.record(&format!("/cards/{id}/attempts"), vec![0; 3 * 1024 * 1024 + 1]).await;
        assert_eq!(status, StatusCode::PAYLOAD_TOO_LARGE);
    }

    #[tokio::test]
    async fn a_sentence_with_no_words_cannot_be_scored() {
        let app = fixture();
        let id = app.paste("--").await;
        let (status, body) = app.record(&format!("/cards/{id}/attempts"), recording(4000, 0)).await;
        assert_eq!(status, StatusCode::BAD_REQUEST);
        assert!(message(&body).contains("没有英文单词"), "{body}");
    }

    #[tokio::test]
    async fn scoring_says_when_the_phoneme_model_is_missing_or_broken() {
        let missing = fixture_with(&manifest("tests/fixtures/none.onnx"), |_| {});
        let id = missing.paste("think").await;
        let (status, body) = missing.record(&format!("/cards/{id}/attempts"), recording(4000, 0)).await;
        assert_eq!(status, StatusCode::SERVICE_UNAVAILABLE);
        assert!(message(&body).contains("音素模型还没准备好"));

        let failed = fixture_with(&manifest("tests/fixtures/none.onnx"), |app| {
            *app.model.lock().unwrap() = ModelSlot::Failed("broken".into());
        });
        let id = failed.paste("think").await;
        let (status, body) = failed.record(&format!("/cards/{id}/attempts"), recording(4000, 0)).await;
        assert_eq!(status, StatusCode::SERVICE_UNAVAILABLE);
        assert_eq!(message(&body), "broken");
    }

    #[tokio::test]
    async fn a_failed_save_leaves_no_audio_file_behind() {
        let app = fixture();
        let id = app.paste("think").await;
        let word = app.save_word("think").await;
        app.sql("DROP TABLE word_attempts; DROP TABLE attempts;");
        let (status, _) = app.record(&format!("/cards/{id}/attempts"), recording(4000, 0)).await;
        assert_eq!(status, StatusCode::INTERNAL_SERVER_ERROR);
        let (status, _) = app.record(&format!("/words/{word}/attempts"), recording(4000, 0)).await;
        assert_eq!(status, StatusCode::INTERNAL_SERVER_ERROR);
        assert_eq!(std::fs::read_dir(app.app.dir.join("audio")).unwrap().count(), 0);
    }

    #[tokio::test]
    async fn an_unwritable_audio_directory_is_a_server_error() {
        let app = fixture();
        let id = app.paste("think").await;
        std::fs::remove_dir_all(app.app.dir.join("audio")).unwrap();
        let (status, _) = app.record(&format!("/cards/{id}/attempts"), recording(4000, 0)).await;
        assert_eq!(status, StatusCode::INTERNAL_SERVER_ERROR);
    }

    #[tokio::test]
    async fn a_broken_word_table_stops_word_scoring_cleanly() {
        let app = fixture();
        let id = app.save_word("think").await;
        app.sql("DROP TABLE word_attempts; DROP TABLE words;");
        let (status, _) = app.record(&format!("/words/{id}/attempts"), recording(4000, 0)).await;
        assert_eq!(status, StatusCode::INTERNAL_SERVER_ERROR);
    }

    // ---- playing back your own recording ----

    #[tokio::test]
    async fn playing_an_unknown_or_vanished_recording_is_not_found() {
        let app = fixture();
        let (status, body) = app.get(&format!("/attempts/{}/audio", unknown_id())).await;
        assert_eq!(status, StatusCode::NOT_FOUND);
        assert!(message(&body).contains("没有这段录音"));

        let id = app.paste("think").await;
        let (_, scored) = app.record(&format!("/cards/{id}/attempts"), recording(4000, 0)).await;
        for entry in std::fs::read_dir(app.app.dir.join("audio")).unwrap() {
            std::fs::remove_file(entry.unwrap().path()).unwrap();
        }
        let uri = format!("/attempts/{}/audio", scored["attempt_id"].as_str().unwrap());
        assert_eq!(app.get(&uri).await.0, StatusCode::NOT_FOUND);
    }

    #[tokio::test]
    async fn a_broken_attempt_table_is_a_server_error_when_playing_audio() {
        let app = fixture();
        app.sql("DROP TABLE attempts;");
        assert_eq!(app.get(&format!("/attempts/{}/audio", unknown_id())).await.0, StatusCode::INTERNAL_SERVER_ERROR);
    }
}
