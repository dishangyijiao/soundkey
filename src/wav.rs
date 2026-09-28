pub fn decode_wav(bytes: &[u8]) -> Result<(u32, Vec<f32>), String> {
    if bytes.len() < 44 || &bytes[0..4] != b"RIFF" || &bytes[8..12] != b"WAVE" {
        return Err("录音不是 wav".to_string());
    }
    let mut offset = 12;
    let mut format = None;
    let mut data = None;
    while offset + 8 <= bytes.len() {
        let id = &bytes[offset..offset + 4];
        let size = u32::from_le_bytes(bytes[offset + 4..offset + 8].try_into().unwrap()) as usize;
        let start = offset + 8;
        let end = start + size;
        if end > bytes.len() {
            return Err("录音文件不完整".to_string());
        }
        if id == b"fmt " && size >= 16 {
            format = Some(Fmt {
                audio_format: u16::from_le_bytes(bytes[start..start + 2].try_into().unwrap()),
                channels: u16::from_le_bytes(bytes[start + 2..start + 4].try_into().unwrap()),
                sample_rate: u32::from_le_bytes(bytes[start + 4..start + 8].try_into().unwrap()),
                bits: u16::from_le_bytes(bytes[start + 14..start + 16].try_into().unwrap()),
            });
        } else if id == b"data" {
            data = Some(&bytes[start..end]);
        }
        offset = end + (size % 2);
    }
    let format = format.ok_or_else(|| "录音缺少格式".to_string())?;
    let data = data.ok_or_else(|| "录音没有数据".to_string())?;
    if format.channels == 0 || format.sample_rate == 0 {
        return Err("录音格式不对".to_string());
    }
    let samples = match (format.audio_format, format.bits) {
        (1, 16) => decode_pcm16(data, format.channels),
        (3, 32) => decode_f32(data, format.channels),
        _ => return Err("只接受 16 位或浮点 wav".to_string()),
    };
    Ok((format.sample_rate, samples))
}

pub fn resample(input: &[f32], from: u32, to: u32) -> Vec<f32> {
    if from == to || input.is_empty() {
        return input.to_vec();
    }
    let output_len = ((input.len() as f64) * (to as f64) / (from as f64)).round() as usize;
    if output_len == 0 {
        return Vec::new();
    }
    let mut output = Vec::with_capacity(output_len);
    for index in 0..output_len {
        let position = (index as f64) * (from as f64) / (to as f64);
        let left = position.floor() as usize;
        let right = (left + 1).min(input.len() - 1);
        let fraction = (position - left as f64) as f32;
        output.push(input[left] * (1.0 - fraction) + input[right] * fraction);
    }
    output
}

struct Fmt {
    audio_format: u16,
    channels: u16,
    sample_rate: u32,
    bits: u16,
}

fn decode_pcm16(data: &[u8], channels: u16) -> Vec<f32> {
    let channels = channels as usize;
    let frame_bytes = channels * 2;
    data.chunks(frame_bytes)
        .filter(|frame| frame.len() == frame_bytes)
        .map(|frame| {
            let mut sum = 0.0;
            for channel in 0..channels {
                let sample = i16::from_le_bytes(frame[channel * 2..channel * 2 + 2].try_into().unwrap());
                sum += sample as f32 / i16::MAX as f32;
            }
            sum / channels as f32
        })
        .collect()
}

fn decode_f32(data: &[u8], channels: u16) -> Vec<f32> {
    let channels = channels as usize;
    let frame_bytes = channels * 4;
    data.chunks(frame_bytes)
        .filter(|frame| frame.len() == frame_bytes)
        .map(|frame| {
            let mut sum = 0.0;
            for channel in 0..channels {
                sum += f32::from_le_bytes(frame[channel * 4..channel * 4 + 4].try_into().unwrap());
            }
            sum / channels as f32
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resamples_to_half() {
        let input = vec![0.0, 1.0, 0.0, 1.0];
        let output = resample(&input, 4, 2);
        assert_eq!(output.len(), 2);
    }
}
