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
        let session = Session::builder()
            .map_err(|error| error.to_string())?
            .with_intra_threads(4)
            .map_err(|error| error.to_string())?
            .commit_from_file(path)
            .map_err(|error| error.to_string())?;
        Ok(Self {
            session,
            tokens: vocab_by_id(include_str!("../assets/vocab.json"))?,
        })
    }

    pub fn recognize(&mut self, samples: &[f32]) -> Result<Vec<String>, String> {
        let normalized = normalize(samples);
        let shape = [1usize, normalized.len()];
        let outputs = self
            .session
            .run(ort::inputs![
                "input_values" => TensorRef::from_array_view((shape, normalized.as_slice())).map_err(|error| error.to_string())?
            ])
            .map_err(|error| error.to_string())?;
        let (shape, logits) = outputs["logits"]
            .try_extract_tensor::<f32>()
            .map_err(|error| error.to_string())?;
        let ids = argmax_ctc(shape, logits, self.tokens.len());
        Ok(ctc_decode(&ids, &self.tokens))
    }
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

    #[test]
    fn collapses_repeats_and_skips_blank() {
        let tokens = vec!["<pad>".into(), "<s>".into(), "</s>".into(), "<unk>".into(), "θ".into(), "ɪ".into()];
        let phones = ctc_decode(&[0, 4, 4, 0, 5], &tokens);
        assert_eq!(phones, vec!["θ".to_string(), "ɪ".to_string()]);
    }
}
