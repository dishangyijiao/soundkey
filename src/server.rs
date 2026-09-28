use crate::align::{fit_vocab, vocab_phones};
use crate::asr::{ModelSlot, PhonemeModel};
use crate::espeak::{self, expected_phones};
use crate::paths::{self, PORT};
use crate::store::{NewCard, Store};
use crate::wav::{decode_wav, resample};
use axum::extract::{Path, State};
use axum::http::{header, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, patch, post};
use axum::{Json, Router};
use serde::Deserialize;
use serde_json::json;
use std::collections::HashSet;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use tower_http::cors::CorsLayer;

pub struct App {
    store: Mutex<Store>,
    dir: PathBuf,
    model: Mutex<ModelSlot>,
    espeak: bool,
    vocab: HashSet<String>,
}

pub fn serve() -> anyhow::Result<()> {
    let dir = paths::app_dir();
    std::fs::create_dir_all(dir.join("audio"))?;
    std::fs::create_dir_all(dir.join("models"))?;
    let store = Store::open(&dir.join("cards.sqlite"))?;
    let espeak = espeak::available();
    let vocab = vocab_phones(include_str!("../assets/vocab.json"));
    let model = if paths::model_path().is_file() {
        match PhonemeModel::load(&paths::model_path()) {
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

    let app = Arc::new(App {
        store: Mutex::new(store),
        dir,
        model: Mutex::new(model),
        espeak,
        vocab,
    });
    let router = Router::new()
        .route("/health", get(health))
        .route("/cards", get(list_cards).post(create_card))
        .route("/cards/{id}", patch(update_card))
        .route("/cards/{id}/attempts", post(create_attempt))
        .route("/attempts/{id}/audio", get(attempt_audio))
        .layer(CorsLayer::permissive())
        .layer(axum::extract::DefaultBodyLimit::max(3 * 1024 * 1024))
        .with_state(app);

    eprintln!("讽诵听在 http://127.0.0.1:{PORT}");
    let runtime = tokio::runtime::Runtime::new()?;
    runtime.block_on(async {
        let listener = tokio::net::TcpListener::bind(("127.0.0.1", PORT)).await?;
        axum::serve(listener, router).await?;
        anyhow::Ok(())
    })
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
            let (Some(video_id), Some(start_ms), Some(end_ms)) = (video_id, body.start_ms, body.end_ms) else {
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

async fn create_attempt(
    State(app): State<Arc<App>>,
    Path(id): Path<String>,
    body: axum::body::Bytes,
) -> Result<Json<serde_json::Value>, ApiError> {
    if !app.espeak {
        return Err(ApiError::new(StatusCode::SERVICE_UNAVAILABLE, "需要先安装 espeak-ng"));
    }
    let text = {
        let store = app.store.lock().expect("db lock");
        store
            .card_text(&id)
            .map_err(|error| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?
            .ok_or_else(|| ApiError::new(StatusCode::NOT_FOUND, "没有这张卡片"))?
    };

    let (sample_rate, samples) = decode_wav(&body).map_err(|error| ApiError::new(StatusCode::BAD_REQUEST, error))?;
    let samples = resample(&samples, sample_rate, 16_000);
    if samples.len() < 3_200 {
        return Err(ApiError::new(StatusCode::BAD_REQUEST, "没有录到声音"));
    }
    if samples.len() > 16_000 * 30 {
        return Err(ApiError::new(StatusCode::BAD_REQUEST, "这一句太长了"));
    }

    let expected = expected_phones(&text).map_err(|error| ApiError::new(StatusCode::BAD_REQUEST, error))?;
    let expected = fit_vocab(&expected, &app.vocab);
    let heard = {
        let app = Arc::clone(&app);
        let samples = samples.clone();
        tokio::task::spawn_blocking(move || recognize(&app, &samples))
            .await
            .map_err(|error| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?
            .map_err(|error| ApiError::new(StatusCode::SERVICE_UNAVAILABLE, error))?
    };
    let scored = crate::align::score(&expected, &heard);

    let attempt_id = uuid::Uuid::new_v4().to_string();
    let relative = format!("audio/{attempt_id}.wav");
    let audio_path = app.dir.join(&relative);
    std::fs::write(&audio_path, &body).map_err(|error| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?;
    app.store
        .lock()
        .expect("db lock")
        .insert_attempt(&attempt_id, &id, &text, &relative, &scored)
        .map_err(|error| {
            let _ = std::fs::remove_file(&audio_path);
            ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error.to_string())
        })?;

    Ok(Json(json!({
        "attempt_id": attempt_id,
        "score": scored
    })))
}

fn recognize(app: &App, samples: &[f32]) -> Result<Vec<String>, String> {
    let mut slot = app.model.lock().expect("model lock");
    match &mut *slot {
        ModelSlot::Ready(model) => model.recognize(samples),
        ModelSlot::Missing => Err("音素模型还没准备好".to_string()),
        ModelSlot::Failed(error) => Err(error.clone()),
    }
}

async fn attempt_audio(State(app): State<Arc<App>>, Path(id): Path<String>) -> Result<Response, ApiError> {
    let relative = app
        .store
        .lock()
        .expect("db lock")
        .attempt_audio(&id)
        .map_err(|error| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?
        .ok_or_else(|| ApiError::new(StatusCode::NOT_FOUND, "没有这段录音"))?;
    let path = app.dir.join(relative);
    let bytes = std::fs::read(&path).map_err(|_| ApiError::new(StatusCode::NOT_FOUND, "没有这段录音"))?;
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
