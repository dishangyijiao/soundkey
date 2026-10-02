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

/// A mono 16-bit WAV file, for tests in other modules.
#[cfg(test)]
pub(crate) fn pcm16_wav(rate: u32, samples: &[i16]) -> Vec<u8> {
    let data: Vec<u8> = samples.iter().flat_map(|s| s.to_le_bytes()).collect();
    let mut out = b"RIFF".to_vec();
    out.extend((36 + data.len() as u32).to_le_bytes());
    out.extend(b"WAVEfmt ");
    out.extend(16u32.to_le_bytes());
    out.extend(1u16.to_le_bytes());
    out.extend(1u16.to_le_bytes());
    out.extend(rate.to_le_bytes());
    out.extend((rate * 2).to_le_bytes());
    out.extend(2u16.to_le_bytes());
    out.extend(16u16.to_le_bytes());
    out.extend(b"data");
    out.extend((data.len() as u32).to_le_bytes());
    out.extend(data);
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_test_helper_writes_what_the_decoder_reads() {
        let (rate, samples) = decode_wav(&pcm16_wav(8_000, &[0, i16::MAX])).unwrap();
        assert_eq!((rate, samples), (8_000, vec![0.0, 1.0]));
    }

    fn chunk(id: &[u8; 4], body: &[u8]) -> Vec<u8> {
        let mut out = id.to_vec();
        out.extend((body.len() as u32).to_le_bytes());
        out.extend(body);
        if body.len() % 2 == 1 {
            out.push(0);
        }
        out
    }

    fn fmt_chunk(format: u16, channels: u16, rate: u32, bits: u16) -> Vec<u8> {
        let mut body = Vec::new();
        body.extend(format.to_le_bytes());
        body.extend(channels.to_le_bytes());
        body.extend(rate.to_le_bytes());
        body.extend((rate * channels as u32 * bits as u32 / 8).to_le_bytes());
        body.extend((channels * bits / 8).to_le_bytes());
        body.extend(bits.to_le_bytes());
        chunk(b"fmt ", &body)
    }

    fn wav(chunks: &[Vec<u8>]) -> Vec<u8> {
        let body: Vec<u8> = chunks.concat();
        let mut out = b"RIFF".to_vec();
        out.extend((4 + body.len() as u32).to_le_bytes());
        out.extend(b"WAVE");
        out.extend(body);
        // `decode_wav` refuses anything shorter than a canonical header.
        while out.len() < 44 {
            out.push(0);
        }
        out
    }

    fn pcm16(samples: &[i16]) -> Vec<u8> {
        chunk(b"data", &samples.iter().flat_map(|s| s.to_le_bytes()).collect::<Vec<_>>())
    }

    fn float32(samples: &[f32]) -> Vec<u8> {
        chunk(b"data", &samples.iter().flat_map(|s| s.to_le_bytes()).collect::<Vec<_>>())
    }

    fn error_of(bytes: &[u8]) -> String {
        decode_wav(bytes).unwrap_err()
    }

    #[test]
    fn decodes_mono_pcm16_to_floats_in_minus_one_to_one() {
        let bytes = wav(&[fmt_chunk(1, 1, 16_000, 16), pcm16(&[0, i16::MAX, -i16::MAX])]);
        let (rate, samples) = decode_wav(&bytes).unwrap();
        assert_eq!(rate, 16_000);
        assert_eq!(samples, [0.0, 1.0, -1.0]);
    }

    #[test]
    fn stereo_pcm16_is_averaged_and_a_trailing_partial_frame_is_dropped() {
        let mut body = pcm16(&[i16::MAX, -i16::MAX, i16::MAX, i16::MAX])[8..].to_vec();
        body.push(1);
        let bytes = wav(&[fmt_chunk(1, 2, 44_100, 16), chunk(b"data", &body)]);
        let (rate, samples) = decode_wav(&bytes).unwrap();
        assert_eq!(rate, 44_100);
        assert_eq!(samples, [0.0, 1.0]);
    }

    #[test]
    fn decodes_float32_and_averages_channels() {
        let bytes = wav(&[fmt_chunk(3, 2, 48_000, 32), float32(&[0.5, -0.5, 0.25, 0.75])]);
        let (rate, samples) = decode_wav(&bytes).unwrap();
        assert_eq!(rate, 48_000);
        assert_eq!(samples, [0.0, 0.5]);
        let mut odd = float32(&[0.5, -0.5, 0.25, 0.75])[8..].to_vec();
        odd.extend([0u8, 0]);
        let bytes = wav(&[fmt_chunk(3, 2, 48_000, 32), chunk(b"data", &odd)]);
        assert_eq!(decode_wav(&bytes).unwrap().1.len(), 2);
    }

    #[test]
    fn skips_unknown_chunks_and_pads_odd_sized_ones() {
        let bytes = wav(&[
            chunk(b"LIST", b"abc"),
            fmt_chunk(1, 1, 16_000, 16),
            chunk(b"junk", b"x"),
            pcm16(&[i16::MAX]),
        ]);
        assert_eq!(decode_wav(&bytes).unwrap().1, [1.0]);
    }

    #[test]
    fn a_short_fmt_chunk_is_not_a_format() {
        let bytes = wav(&[chunk(b"fmt ", &[1, 0, 1, 0]), pcm16(&[1, 2])]);
        assert_eq!(error_of(&bytes), "录音缺少格式");
    }

    #[test]
    fn rejects_files_that_are_not_wav() {
        assert_eq!(error_of(b"short"), "录音不是 wav");
        let mut not_riff = wav(&[fmt_chunk(1, 1, 16_000, 16), pcm16(&[1, 2, 3])]);
        not_riff[0] = b'X';
        assert_eq!(error_of(&not_riff), "录音不是 wav");
        let mut not_wave = wav(&[fmt_chunk(1, 1, 16_000, 16), pcm16(&[1, 2, 3])]);
        not_wave[8] = b'X';
        assert_eq!(error_of(&not_wave), "录音不是 wav");
    }

    #[test]
    fn rejects_a_chunk_that_runs_past_the_end_of_the_file() {
        let mut bytes = wav(&[fmt_chunk(1, 1, 16_000, 16), pcm16(&[1, 2, 3, 4])]);
        bytes.truncate(bytes.len() - 3);
        assert_eq!(error_of(&bytes), "录音文件不完整");
    }

    #[test]
    fn rejects_missing_format_or_data() {
        assert_eq!(error_of(&wav(&[pcm16(&[1, 2, 3])])), "录音缺少格式");
        assert_eq!(error_of(&wav(&[fmt_chunk(1, 1, 16_000, 16), chunk(b"junk", &[0; 40])])), "录音没有数据");
    }

    #[test]
    fn rejects_zero_channels_or_zero_sample_rate() {
        assert_eq!(error_of(&wav(&[fmt_chunk(1, 0, 16_000, 16), pcm16(&[1, 2])])), "录音格式不对");
        assert_eq!(error_of(&wav(&[fmt_chunk(1, 1, 0, 16), pcm16(&[1, 2])])), "录音格式不对");
    }

    #[test]
    fn only_16_bit_pcm_and_32_bit_float_are_accepted() {
        for (format, bits) in [(1, 8), (1, 24), (3, 16), (2, 16)] {
            let bytes = wav(&[fmt_chunk(format, 1, 16_000, bits), pcm16(&[1, 2, 3, 4])]);
            assert_eq!(error_of(&bytes), "只接受 16 位或浮点 wav", "{format}/{bits}");
        }
    }

    #[test]
    fn resampling_to_the_same_rate_or_from_nothing_returns_the_input() {
        assert_eq!(resample(&[0.5, 1.0], 16_000, 16_000), [0.5, 1.0]);
        assert!(resample(&[], 8_000, 16_000).is_empty());
    }

    #[test]
    fn resampling_that_would_leave_no_samples_returns_nothing() {
        assert!(resample(&[1.0], 48_000, 8_000).is_empty());
    }

    #[test]
    fn resampling_up_interpolates_between_neighbours_and_holds_the_last_sample() {
        let output = resample(&[0.0, 1.0], 1, 2);
        assert_eq!(output, [0.0, 0.5, 1.0, 1.0]);
    }

    #[test]
    fn resamples_to_half() {
        let input = vec![0.0, 1.0, 0.0, 1.0];
        let output = resample(&input, 4, 2);
        assert_eq!(output.len(), 2);
        assert_eq!(output, [0.0, 0.0]);
    }

    #[test]
    fn the_same_rate_returns_the_samples_untouched_without_interpolating() {
        // Interpolating would turn `inf * 0` into NaN.
        let input = [1.0, f32::INFINITY];
        assert_eq!(resample(&input, 16_000, 16_000), input);
    }
}
