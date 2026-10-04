//! `contracts/openapi/openapi.json` is the single source of the API shape. These tests
//! hold the server to it in both directions: the routes must match, and every response
//! the server really sends must fit its schema, field for field.

use crate::server::tests::{fixture, fixture_with, manifest, recording, Fixture};
use crate::store::DICTIONARY_SCHEMA;
use axum::http::{Method, StatusCode};
use serde_json::{json, Value};
use std::collections::BTreeSet;

const CONTRACT: &str = include_str!("../contracts/openapi/openapi.json");

fn spec() -> Value {
    serde_json::from_str(CONTRACT).unwrap()
}

/// Checks `value` against the part of JSON Schema the contract uses: `$ref`, `oneOf`,
/// `type` (also a list of types), `enum`, `properties` with `required`, and `items`.
/// An object may not carry a key the schema does not list, so a field added to the
/// server without a contract change is caught.
fn check(spec: &Value, schema: &Value, value: &Value, at: &str) -> Result<(), String> {
    if let Some(target) = schema.get("$ref").and_then(Value::as_str) {
        let Some(name) = target.strip_prefix("#/components/schemas/") else {
            return Err(format!("{at}: unsupported $ref {target}"));
        };
        return check(spec, &spec["components"]["schemas"][name], value, at);
    }
    if let Some(options) = schema.get("oneOf").and_then(Value::as_array) {
        let matched = options.iter().filter(|option| check(spec, option, value, at).is_ok()).count();
        return match matched {
            1 => Ok(()),
            _ => Err(format!("{at}: matches {matched} of the oneOf options")),
        };
    }
    if let Some(types) = schema.get("type") {
        let allowed: Vec<&str> = match types {
            Value::Array(list) => list.iter().filter_map(Value::as_str).collect(),
            single => single.as_str().into_iter().collect(),
        };
        if !allowed.iter().any(|name| is_type(name, value)) {
            return Err(format!("{at}: expected {allowed:?}, got {value}"));
        }
    }
    if let Some(values) = schema.get("enum").and_then(Value::as_array) {
        if !values.contains(value) {
            return Err(format!("{at}: {value} is not one of {values:?}"));
        }
    }
    if let (Some(properties), Some(object)) = (schema.get("properties").and_then(Value::as_object), value.as_object()) {
        for key in schema["required"].as_array().into_iter().flatten().filter_map(Value::as_str) {
            if !object.contains_key(key) {
                return Err(format!("{at}: missing required key {key}"));
            }
        }
        for (key, item) in object {
            let Some(property) = properties.get(key) else {
                return Err(format!("{at}.{key}: not in the contract"));
            };
            check(spec, property, item, &format!("{at}.{key}"))?;
        }
    }
    if let (Some(items), Some(array)) = (schema.get("items"), value.as_array()) {
        for (index, item) in array.iter().enumerate() {
            check(spec, items, item, &format!("{at}[{index}]"))?;
        }
    }
    Ok(())
}

fn is_type(name: &str, value: &Value) -> bool {
    match name {
        "string" => value.is_string(),
        "integer" => value.is_i64() || value.is_u64(),
        "boolean" => value.is_boolean(),
        "array" => value.is_array(),
        "object" => value.is_object(),
        "null" => value.is_null(),
        _ => false,
    }
}

// ---- the checker itself ----

fn tiny() -> Value {
    json!({"components": {"schemas": {"Phone": {"type": "object", "required": ["phone"], "properties": {"phone": {"type": "string"}}}}}})
}

#[test]
fn the_checker_accepts_a_value_that_fits() {
    let schema = json!({"type": "object", "required": ["a", "b"], "properties": {
        "a": {"type": ["string", "null"]},
        "b": {"type": "array", "items": {"$ref": "#/components/schemas/Phone"}},
        "c": {"type": "string", "enum": ["x", "y"]},
    }});
    let value = json!({"a": null, "b": [{"phone": "t"}], "c": "x"});
    assert_eq!(check(&tiny(), &schema, &value, "$"), Ok(()));
}

#[test]
fn the_checker_names_the_place_of_each_kind_of_mismatch() {
    let spec = tiny();
    let object = json!({"type": "object", "required": ["a"], "properties": {"a": {"type": "string"}}});
    let cases: Vec<(Value, Value, &str)> = vec![
        (json!({"type": "string"}), json!(1), "$: expected [\"string\"]"),
        (json!({"type": ["string", "null"]}), json!(1), "$: expected [\"string\", \"null\"]"),
        (json!({"type": "integer"}), json!(1.5), "$: expected [\"integer\"]"),
        (json!({"type": "number"}), json!(1), "$: expected [\"number\"]"),
        (json!({"type": "boolean"}), json!("yes"), "$: expected [\"boolean\"]"),
        (json!({"type": "array"}), json!({}), "$: expected [\"array\"]"),
        (json!({"type": "object"}), json!([]), "$: expected [\"object\"]"),
        (json!({"type": "null"}), json!(0), "$: expected [\"null\"]"),
        (json!({"enum": ["x", "y"]}), json!("z"), "$: \"z\" is not one of"),
        (object.clone(), json!({}), "$: missing required key a"),
        (object.clone(), json!({"a": "s", "b": 1}), "$.b: not in the contract"),
        (object.clone(), json!({"a": 1}), "$.a: expected [\"string\"]"),
        (json!({"type": "array", "items": {"type": "integer"}}), json!([1, "x"]), "$[1]: expected [\"integer\"]"),
        (json!({"oneOf": [{"type": "string"}, {"type": "null"}]}), json!(1), "$: matches 0 of the oneOf options"),
        (json!({"oneOf": [{"type": "integer"}, {"type": "number"}, {"type": "integer"}]}), json!(1), "$: matches 2 of the oneOf options"),
        (json!({"$ref": "#/components/schemas/Phone"}), json!({}), "$: missing required key phone"),
        (json!({"$ref": "http://elsewhere/x"}), json!({}), "$: unsupported $ref http://elsewhere/x"),
    ];
    for (schema, value, expected) in cases {
        let error = check(&spec, &schema, &value, "$").unwrap_err();
        assert!(error.starts_with(expected), "{schema} vs {value}: {error}");
    }
}

#[test]
fn the_checker_accepts_one_matching_option_and_an_unconstrained_schema() {
    let spec = tiny();
    assert_eq!(check(&spec, &json!({"oneOf": [{"type": "string"}, {"type": "null"}]}), &json!(null), "$"), Ok(()));
    assert_eq!(check(&spec, &json!({}), &json!({"anything": [1, "x"]}), "$"), Ok(()));
    assert_eq!(check(&spec, &json!({"type": "integer"}), &json!(7), "$"), Ok(()));
    assert!(is_type("integer", &json!(u64::MAX)));
}

#[test]
#[should_panic(expected = "has unsupported contract media type application/xml")]
fn the_response_checker_rejects_unsupported_media_types() {
    decode_response_value("application/xml", vec![], &Method::GET, "/health");
}

fn decode_response_value(kind: &str, bytes: Vec<u8>, method: &Method, template: &str) -> Value {
    if kind == "application/json" {
        serde_json::from_slice(&bytes).unwrap()
    } else if kind == "text/plain" {
        Value::String(String::from_utf8(bytes).unwrap())
    } else {
        panic!("{method} {template} has unsupported contract media type {kind}");
    }
}

// ---- the server against the contract ----

fn operations(spec: &Value) -> BTreeSet<String> {
    let mut ids = BTreeSet::new();
    for item in spec["paths"].as_object().unwrap().values() {
        for operation in item.as_object().unwrap().values() {
            ids.insert(operation["operationId"].as_str().unwrap().to_string());
        }
    }
    ids
}

#[tokio::test]
async fn the_routes_are_exactly_the_ones_the_contract_lists() {
    let (spec, app) = (spec(), fixture());
    for (path, item) in spec["paths"].as_object().unwrap() {
        let uri = path.replace("{id}", "x");
        for method in [Method::GET, Method::POST, Method::PUT, Method::PATCH, Method::DELETE] {
            let documented = item.get(method.as_str().to_lowercase()).is_some();
            let (status, _, body) = app.send(method.clone(), &uri, "text/plain", vec![]).await;
            if documented {
                let missing = status == StatusCode::NOT_FOUND && body.is_empty();
                assert!(status != StatusCode::METHOD_NOT_ALLOWED && !missing, "{method} {path} is in the contract but the server has no such route");
            } else {
                assert_eq!(status, StatusCode::METHOD_NOT_ALLOWED, "{method} {path} is served but not in the contract");
            }
        }
    }
}

#[test]
fn every_route_declared_by_the_server_has_a_contract_path() {
    let contract_paths: BTreeSet<String> = spec()["paths"].as_object().unwrap().keys().cloned().collect();
    let declared_paths = server_route_paths(include_str!("server.rs"));
    let undocumented: Vec<_> = declared_paths.difference(&contract_paths).collect();
    assert!(undocumented.is_empty(), "server routes are missing from OpenAPI: {undocumented:?}");
}

fn server_route_paths(source: &str) -> BTreeSet<String> {
    source
        .match_indices(".route(")
        .filter_map(|(index, _)| {
            source[index + ".route(".len()..]
                .trim_start()
                .strip_prefix('"')?
                .split_once('"')
                .map(|(path, _)| path.to_string())
        })
        .collect()
}

/// Sends requests to the server and checks every answer against the contract, remembering
/// which operations it has seen.
struct Run {
    spec: Value,
    seen: BTreeSet<String>,
}

impl Run {
    async fn call(&mut self, app: &Fixture, method: Method, template: &str, uri: &str, content_type: &str, body: Vec<u8>) -> (StatusCode, Value) {
        let (status, headers, bytes) = app.send(method.clone(), uri, content_type, body).await;
        let operation = &self.spec["paths"][template][method.as_str().to_lowercase()];
        let id = operation["operationId"].as_str();
        assert!(id.is_some(), "{method} {template} is not in the contract");
        self.seen.insert(id.unwrap().to_string());
        let response = &operation["responses"][status.as_u16().to_string()];
        assert!(response.is_object(), "{method} {template} answered {status}, which the contract does not list");
        let Some(media) = response.get("content").and_then(Value::as_object) else {
            assert!(bytes.is_empty(), "{method} {template} answered {status} with a body, the contract lists none");
            return (status, Value::Null);
        };
        let kind = headers["content-type"].to_str().unwrap().split(';').next().unwrap().to_string();
        let media_type = media.get(&kind);
        assert!(media_type.is_some(), "{method} {template} answered with {kind}, the contract lists {:?}", media.keys().collect::<Vec<_>>());
        let media_type = media_type.unwrap();
        if kind == "audio/wav" {
            assert!(bytes.starts_with(b"RIFF"), "{method} {template}: {kind} body is not a WAV file");
            return (status, Value::Null);
        }
        let value = decode_response_value(&kind, bytes, &method, template);
        let verdict = check(&self.spec, &media_type["schema"], &value, "$");
        assert!(verdict.is_ok(), "{method} {template} {status}: {}", verdict.unwrap_err());
        (status, value)
    }

    async fn get(&mut self, app: &Fixture, template: &str, uri: &str) -> (StatusCode, Value) {
        self.call(app, Method::GET, template, uri, "text/plain", vec![]).await
    }

    async fn json(&mut self, app: &Fixture, method: Method, template: &str, uri: &str, body: Value) -> (StatusCode, Value) {
        self.call(app, method, template, uri, "application/json", serde_json::to_vec(&body).unwrap()).await
    }

    async fn wav(&mut self, app: &Fixture, template: &str, uri: &str, wav: Vec<u8>) -> (StatusCode, Value) {
        self.call(app, Method::POST, template, uri, "audio/wav", wav).await
    }
}

fn id_of(body: &Value, key: &str) -> String {
    body[key]["id"].as_str().unwrap().to_string()
}

/// The entry of `list[key]` with this id; lists are ordered newest first, so position says nothing.
fn entry<'a>(list: &'a Value, key: &str, id: &str) -> &'a Value {
    list[key].as_array().unwrap().iter().find(|item| item["id"] == id).unwrap()
}

fn unknown_id() -> String {
    uuid::Uuid::new_v4().to_string()
}

#[tokio::test]
async fn every_response_the_server_sends_fits_the_contract() {
    let app = fixture();
    app.sql(DICTIONARY_SCHEMA);
    app.sql("INSERT INTO dictionary VALUES('think','θɪŋk','v. 想');");
    let mut run = Run { spec: spec(), seen: BTreeSet::new() };
    let ok = StatusCode::OK;
    let bad = StatusCode::BAD_REQUEST;
    let missing = StatusCode::NOT_FOUND;

    assert_eq!(run.get(&app, "/health", "/health").await.0, ok);
    assert_eq!(run.get(&app, "/speak", "/speak?text=hi").await.0, ok);
    assert_eq!(run.get(&app, "/speak", "/speak").await.0, bad);
    assert_eq!(run.get(&app, "/lookup", "/lookup?word=think").await.0, ok);
    assert_eq!(run.get(&app, "/lookup", "/lookup?word=zzz").await.1["definition"], Value::Null);
    assert_eq!(run.get(&app, "/lookup", "/lookup?word=%20").await.0, bad);
    assert_eq!(run.get(&app, "/phones", "/phones?text=think").await.0, ok);
    assert_eq!(run.get(&app, "/phones", "/phones?text=%20").await.0, bad);

    // Cards: pasted and from YouTube, edited, then scored.
    let pasted = run.json(&app, Method::POST, "/cards", "/cards", json!({"text": "think", "source": "paste"})).await;
    assert_eq!(pasted.0, ok);
    let card = id_of(&pasted.1, "card");
    let youtube = json!({"text": "hello there", "source": "youtube", "video_id": "abc", "start_ms": 0, "end_ms": 1500});
    assert_eq!(run.json(&app, Method::POST, "/cards", "/cards", youtube).await.0, ok);
    assert_eq!(run.json(&app, Method::POST, "/cards", "/cards", json!({"text": " ", "source": "paste"})).await.0, bad);
    let cards = run.get(&app, "/cards", "/cards").await.1;
    assert_eq!(entry(&cards, "cards", &card)["score"], Value::Null);
    let edit = |text: &str| json!({ "text": text });
    assert_eq!(run.json(&app, Method::PATCH, "/cards/{id}", &format!("/cards/{card}"), edit("think again")).await.0, ok);
    assert_eq!(run.json(&app, Method::PATCH, "/cards/{id}", &format!("/cards/{}", unknown_id()), edit("x")).await.0, missing);
    assert_eq!(run.json(&app, Method::PATCH, "/cards/{id}", &format!("/cards/{card}"), edit(" ")).await.0, bad);

    let attempt = run.wav(&app, "/cards/{id}/attempts", &format!("/cards/{card}/attempts"), recording(4000, 4000)).await;
    assert_eq!(attempt.0, ok);
    let attempt_id = attempt.1["attempt_id"].as_str().unwrap().to_string();
    let too_large = run.wav(&app, "/cards/{id}/attempts", &format!("/cards/{card}/attempts"), vec![0; 3 * 1024 * 1024 + 1]).await;
    assert_eq!(too_large.0, StatusCode::PAYLOAD_TOO_LARGE);
    assert_eq!(run.wav(&app, "/cards/{id}/attempts", &format!("/cards/{}/attempts", unknown_id()), recording(4000, 0)).await.0, missing);
    assert_eq!(run.wav(&app, "/cards/{id}/attempts", &format!("/cards/{card}/attempts"), recording(10, 0)).await.0, bad);
    let cards = run.get(&app, "/cards", "/cards").await.1;
    assert_eq!(entry(&cards, "cards", &card)["latest_attempt_id"], attempt_id);
    assert_ne!(entry(&cards, "cards", &card)["score"], Value::Null);

    // Words: saved in full and with the word only, scored, played back and deleted.
    let full = json!({"word": "think", "ipa": "θɪŋk", "definition": "v. 想", "source_sentence": "I think so", "video_id": "abc", "start_ms": 1000, "end_ms": 2000});
    let word = run.json(&app, Method::POST, "/words", "/words", full).await;
    assert_eq!(word.0, ok);
    let word = id_of(&word.1, "word");
    assert_eq!(run.json(&app, Method::POST, "/words", "/words", json!({"word": "go"})).await.0, ok);
    assert_eq!(run.json(&app, Method::POST, "/words", "/words", json!({"word": " "})).await.0, bad);
    let words = run.get(&app, "/words", "/words").await.1;
    assert_eq!(entry(&words, "words", &word)["score"], Value::Null);
    assert_eq!(run.wav(&app, "/words/{id}/attempts", &format!("/words/{word}/attempts"), recording(4000, 4000)).await.0, ok);
    assert_eq!(run.wav(&app, "/words/{id}/attempts", &format!("/words/{word}/attempts"), vec![0; 3 * 1024 * 1024 + 1]).await.0, StatusCode::PAYLOAD_TOO_LARGE);
    assert_eq!(run.wav(&app, "/words/{id}/attempts", &format!("/words/{}/attempts", unknown_id()), recording(4000, 0)).await.0, missing);
    let words = run.get(&app, "/words", "/words").await.1;
    assert_ne!(entry(&words, "words", &word)["score"], Value::Null);
    assert_eq!(run.get(&app, "/attempts/{id}/audio", &format!("/attempts/{attempt_id}/audio")).await.0, ok);
    assert_eq!(run.get(&app, "/attempts/{id}/audio", &format!("/attempts/{}/audio", unknown_id())).await.0, missing);
    let delete = |id: String| (Method::DELETE, "/words/{id}".to_string(), format!("/words/{id}"));
    let (method, template, uri) = delete(word.clone());
    assert_eq!(run.call(&app, method, &template, &uri, "text/plain", vec![]).await.0, StatusCode::NO_CONTENT);
    let (method, template, uri) = delete(word);
    assert_eq!(run.call(&app, method, &template, &uri, "text/plain", vec![]).await.0, missing);

    // Without the phoneme model, scoring says so with 503.
    let no_model = fixture_with(&manifest("tests/fixtures/none.onnx"), |_| {});
    let card = id_of(&run.json(&no_model, Method::POST, "/cards", "/cards", json!({"text": "think", "source": "paste"})).await.1, "card");
    let uri = format!("/cards/{card}/attempts");
    assert_eq!(run.wav(&no_model, "/cards/{id}/attempts", &uri, recording(4000, 0)).await.0, StatusCode::SERVICE_UNAVAILABLE);
    let word = id_of(&run.json(&no_model, Method::POST, "/words", "/words", json!({"word": "think"})).await.1, "word");
    let uri = format!("/words/{word}/attempts");
    assert_eq!(run.wav(&no_model, "/words/{id}/attempts", &uri, recording(4000, 0)).await.0, StatusCode::SERVICE_UNAVAILABLE);

    // Every operation in the contract was exercised, so none is documented without being tested.
    assert_eq!(run.seen, operations(&run.spec));
}
