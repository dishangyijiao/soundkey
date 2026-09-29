(() => {
  function cleanCue(value) {
    return String(value ?? "")
      .replace(/\[\s*(?:music|applause|laughter|inaudible|音樂|音乐)[^\]]*\]/gi, " ")
      .replace(/>>+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  // Input is the parallel score sequences returned by the API. Missing phones
  // are represented as empty cells, so both rows always share column indexes.
  function scoreColumns(score) {
    if (Array.isArray(score?.columns)) return score.columns;
    const expected = score?.expected || [];
    const heard = score?.heard || [];
    const out = [];
    for (let i = 0; i < Math.max(expected.length, heard.length); i++) {
      out.push({ expected: expected[i] || null, heard: heard[i] || null,
        status: expected[i] && heard[i] ? (expected[i].phone === heard[i].phone ? "match" : "sub") : expected[i] ? "del" : "ins" });
    }
    return out;
  }

  function selectedWord(text, start, end) {
    const value = String(text ?? "");
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end > value.length) return null;
    const raw = value.slice(start, end).trim();
    const match = raw.match(/^[A-Za-z]+(?:['’-][A-Za-z]+)*$/);
    return match ? match[0].replace(/[’]/g, "'") : null;
  }

  const VOWEL_START = /^[aeiouyæɑɒɔəɛɜɪʊʌøœɨɯɤɐʏɚɝᵻʉɵä]/u;

  function isVowel(phone) {
    return VOWEL_START.test(String(phone ?? ""));
  }

  // Which state the single read button is in. It always belongs to the selected
  // sentence: a playing video must not take it over (that made reading impossible).
  function readButton({ connected, hasCard, recording, hasScore }) {
    if (recording === "uploading") return { label: "正在听", disabled: true };
    if (recording) return { label: "停止", disabled: false };
    return { label: hasScore ? "再读一次" : "朗读", disabled: !connected || !hasCard };
  }

  // The request body for adding a word. The sentence and cue are captured when the
  // word is selected, not when the button is clicked: the video keeps playing.
  function wordPayload({ word, result, sentence, cue }) {
    return {
      word: result?.word || word,
      ipa: result?.ipa ?? null,
      definition: result?.definition ?? null,
      source_sentence: cleanCue(sentence) || null,
      video_id: cue?.videoId || null,
      start_ms: cue?.startMs ?? null,
      end_ms: cue?.endMs ?? null,
    };
  }

  const api = { cleanCue, scoreColumns, selectedWord, isVowel, readButton, wordPayload };
  // Stryker disable next-line all: 浏览器与 node 的环境探测，没有可断言的业务行为
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else globalThis.FengsongCues = api;
})();
