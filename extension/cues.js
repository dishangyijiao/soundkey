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

  // Same rule as `words` in src/espeak.rs: letters and digits, joined by ' ’ - .
  // when a letter or digit follows. The server's per-word score lines up with
  // the word segments by position, so the two must split identically.
  const WORD_CHAR = /[\p{L}\p{N}]/u;

  function tokenize(text) {
    const chars = Array.from(String(text ?? ""));
    const segments = [];
    let current = "";
    let gap = "";
    const flush = () => {
      if (gap) segments.push({ text: gap, word: false });
      if (current) segments.push({ text: current, word: true });
      gap = "";
      current = "";
    };
    chars.forEach((ch, index) => {
      const joins = "'’-.".includes(ch) && current && WORD_CHAR.test(chars[index + 1] ?? "");
      if (WORD_CHAR.test(ch) || joins) {
        if (gap) {
          segments.push({ text: gap, word: false });
          gap = "";
        }
        current += ch;
      } else {
        if (current) {
          segments.push({ text: current, word: true });
          current = "";
        }
        gap += ch;
      }
    });
    flush();
    return segments;
  }

  // The word to look up in the dictionary for a sentence token.
  function lookupKey(token) {
    return String(token ?? "").replace(/’/g, "'");
  }

  // For each segment of `tokenize(text)`, the server's score for that word, or
  // null. Scores whose words do not line up with the text are not used at all.
  function wordScores(segments, score) {
    const words = score?.words || [];
    const count = segments.filter((segment) => segment.word).length;
    if (!words.length || words.length !== count) return segments.map(() => null);
    let index = 0;
    return segments.map((segment) => (segment.word ? words[index++] : null));
  }

  function wordColumns(score, scoredWord) {
    if (!scoredWord) return [];
    return scoreColumns(score).slice(scoredWord.first_column, scoredWord.first_column + scoredWord.column_count);
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

  const api = { cleanCue, scoreColumns, tokenize, lookupKey, wordScores, wordColumns, isVowel, readButton, wordPayload };
  // Stryker disable next-line all: 浏览器与 node 的环境探测，没有可断言的业务行为
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else globalThis.FengsongCues = api;
})();
