use crate::align::clean_phone;
use ort::session::Session;
use ort::value::TensorRef;
use std::path::Path;

pub enum ModelSlot {
    Missing,
    Ready(PhonemeModel),
    Failed(String),
}

pub struct PhonemeModel {
    session: Session,
    tokens: Vec<String>,
}

impl PhonemeModel {
    pub fn load(path: &Path) -> Result<Self, String> {
        let session = open_session(path).map_err(|error| error.to_string())?;
        Ok(Self {
            session,
            tokens: vocab_by_id(include_str!("../assets/vocab.json"))?,
        })
    }

    pub fn recognize(&mut self, samples: &[f32]) -> Result<Vec<String>, String> {
        let ids = self.best_ids(&normalize(samples)).map_err(|error| error.to_string())?;
        Ok(ctc_decode(&ids, &self.tokens))
    }

    fn best_ids(&mut self, normalized: &[f32]) -> ort::Result<Vec<usize>> {
        let shape = [1usize, normalized.len()];
        let outputs = self.session.run(ort::inputs![
            "input_values" => TensorRef::from_array_view((shape, normalized))?
        ])?;
        let (shape, logits) = outputs["logits"].try_extract_tensor::<f32>()?;
        Ok(argmax_ctc(shape, logits, self.tokens.len()))
    }
}

fn open_session(path: &Path) -> ort::Result<Session> {
    Ok(Session::builder()?.with_intra_threads(4)?.commit_from_file(path)?)
}

pub fn ctc_decode(ids: &[usize], tokens: &[String]) -> Vec<String> {
    let mut phones = Vec::new();
    let mut previous = usize::MAX;
    for &id in ids {
        if id != previous && id != 0 && id != 1 && id != 2 && id != 3 {
            if let Some(token) = tokens.get(id) {
                let phone = clean_phone(token);
                if !phone.is_empty() && !phone.starts_with('<') {
                    phones.push(phone);
                }
            }
        }
        previous = id;
    }
    phones
}

fn normalize(samples: &[f32]) -> Vec<f32> {
    let count = samples.len() as f32;
    if count == 0.0 {
        return Vec::new();
    }
    let mean = samples.iter().sum::<f32>() / count;
    let variance = samples.iter().map(|sample| (sample - mean).powi(2)).sum::<f32>() / count;
    let deviation = variance.sqrt().max(1.0e-7);
    samples.iter().map(|sample| (sample - mean) / deviation).collect()
}

fn vocab_by_id(vocab_json: &str) -> Result<Vec<String>, String> {
    let map: serde_json::Map<String, serde_json::Value> =
        serde_json::from_str(vocab_json).map_err(|error| error.to_string())?;
    let mut pairs = Vec::new();
    for (token, id) in map {
        let id = id.as_u64().ok_or("词表编号不对")? as usize;
        pairs.push((id, token));
    }
    pairs.sort_by_key(|(id, _)| *id);
    let Some((last, _)) = pairs.last() else {
        return Err("词表是空的".to_string());
    };
    let mut tokens = vec![String::new(); last + 1];
    for (id, token) in pairs {
        tokens[id] = token;
    }
    Ok(tokens)
}

fn argmax_ctc(shape: &[i64], logits: &[f32], vocab_len: usize) -> Vec<usize> {
    let time = if shape.len() >= 2 {
        shape[1] as usize
    } else {
        logits.len() / vocab_len.max(1)
    };
    let width = if shape.len() >= 3 {
        shape[2] as usize
    } else {
        vocab_len
    };
    let mut ids = Vec::with_capacity(time);
    for frame in 0..time {
        let start = frame * width;
        let end = (start + width).min(logits.len());
        let mut best_id = 0;
        let mut best_value = f32::MIN;
        for (offset, value) in logits[start..end].iter().enumerate() {
            if *value > best_value {
                best_value = *value;
                best_id = offset;
            }
        }
        ids.push(best_id);
    }
    ids
}

#[cfg(test)]
mod tests {
    use super::*;

    fn strings(items: &[&str]) -> Vec<String> {
        items.iter().map(|item| item.to_string()).collect()
    }

    fn fixture(name: &str) -> std::path::PathBuf {
        Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures").join(name)
    }

    #[test]
    fn collapses_repeats_and_skips_blank() {
        let tokens = vec!["<pad>".into(), "<s>".into(), "</s>".into(), "<unk>".into(), "θ".into(), "ɪ".into()];
        let phones = ctc_decode(&[0, 4, 4, 0, 5], &tokens);
        assert_eq!(phones, vec!["θ".to_string(), "ɪ".to_string()]);
    }

    #[test]
    fn a_repeat_separated_by_blank_is_a_new_phone_and_special_ids_never_show() {
        let tokens = strings(&["<pad>", "<s>", "</s>", "<unk>", "θ", "ˈ", "<x>"]);
        assert_eq!(ctc_decode(&[4, 0, 4], &tokens), ["θ", "θ"]);
        assert_eq!(ctc_decode(&[1, 2, 3], &tokens), Vec::<String>::new());
        assert_eq!(ctc_decode(&[4, 3, 4], &tokens), ["θ", "θ"]);
    }

    #[test]
    fn ids_without_a_token_and_tokens_that_clean_to_nothing_are_dropped() {
        let tokens = strings(&["<pad>", "<s>", "</s>", "<unk>", "θ", "ˈ", "<x>"]);
        assert_eq!(ctc_decode(&[99, 5, 6, 4], &tokens), ["θ"]);
    }

    #[test]
    fn the_model_reads_positive_samples_as_one_phone_and_negative_ones_as_another() {
        let mut model = PhonemeModel::load(&fixture("tiny_phoneme.onnx")).unwrap();
        assert_eq!(model.recognize(&[1.0, 1.0, -1.0, -1.0]).unwrap(), ["θ", "ɪ"]);
        assert_eq!(model.recognize(&[-1.0, 1.0]).unwrap(), ["ɪ", "θ"]);
    }

    #[test]
    fn silence_and_nothing_are_recognised_as_no_phones() {
        let mut model = PhonemeModel::load(&fixture("tiny_phoneme.onnx")).unwrap();
        assert!(model.recognize(&[0.0; 8]).unwrap().is_empty());
        assert!(model.recognize(&[]).unwrap().is_empty());
    }

    #[test]
    fn loading_a_missing_or_corrupt_model_reports_why() {
        assert!(PhonemeModel::load(&fixture("does-not-exist.onnx")).is_err());
        let dir = std::env::temp_dir().join(format!("soundkey-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let junk = dir.join("junk.onnx");
        std::fs::write(&junk, b"not a model").unwrap();
        assert!(PhonemeModel::load(&junk).is_err());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn an_inference_failure_is_an_error_not_a_panic() {
        let mut model = PhonemeModel::load(&fixture("fixed_phoneme.onnx")).unwrap();
        assert_eq!(model.recognize(&[1.0, 1.0, -1.0, -1.0]).unwrap(), ["θ", "ɪ"]);
        assert!(model.recognize(&[1.0; 5]).is_err());
    }

    #[test]
    fn normalizing_gives_zero_mean_unit_deviation_and_survives_silence() {
        assert!(normalize(&[]).is_empty());
        assert_eq!(normalize(&[3.0, 3.0, 3.0]), [0.0, 0.0, 0.0]);
        let out = normalize(&[1.0, 3.0]);
        assert!((out[0] + 1.0).abs() < 1e-5 && (out[1] - 1.0).abs() < 1e-5, "{out:?}");
    }

    #[test]
    fn the_vocabulary_is_ordered_by_id_and_gaps_stay_empty() {
        let tokens = vocab_by_id(r#"{"b":3,"a":0}"#).unwrap();
        assert_eq!(tokens, ["a", "", "", "b"]);
        assert_eq!(vocab_by_id(include_str!("../assets/vocab.json")).unwrap().len(), 392);
    }

    #[test]
    fn a_broken_vocabulary_is_rejected() {
        assert_eq!(vocab_by_id("{}").unwrap_err(), "词表是空的");
        assert_eq!(vocab_by_id(r#"{"a":"x"}"#).unwrap_err(), "词表编号不对");
        assert!(vocab_by_id("not json").is_err());
    }

    #[test]
    fn the_best_token_of_every_frame_is_taken_by_the_shape_it_came_with() {
        let logits = [0.1, 0.9, 0.0, 0.7, 0.2, 0.1];
        assert_eq!(argmax_ctc(&[1, 2, 3], &logits, 3), [1, 0]);
        // Without a full shape the vocabulary size decides the width.
        assert_eq!(argmax_ctc(&[1, 2], &logits, 3), [1, 0]);
        assert_eq!(argmax_ctc(&[], &logits, 3), [1, 0]);
        // A short buffer never reads past its end; ties keep the first token.
        assert_eq!(argmax_ctc(&[1, 2, 3], &[0.0, 0.0, 0.0, 5.0], 3), [0, 0]);
        assert_eq!(argmax_ctc(&[], &[], 0), Vec::<usize>::new());
    }
}
