const test = require("node:test");
const assert = require("node:assert/strict");
const fc = require("fast-check");
const { cleanCue, scoreColumns, tokenize, lookupKey, wordScores, wordColumns, isVowel, readButton, wordPayload } = require("../extension/cues.js");

// ---- cleanCue ----
test("cleanCue: removes the >> speaker-change marker without gluing neighboring words together", () => {
  assert.equal(cleanCue(">> Hello [Music] there >>"), "Hello there");
  assert.equal(cleanCue("a>>b"), "a b");
  assert.equal(cleanCue(">>>hi"), "hi");
  assert.equal(cleanCue(">> >>"), "");
});

test("cleanCue: removes sound-effect tags, case- and space-insensitively, with a description allowed inside the tag", () => {
  assert.equal(cleanCue("[Music]"), "");
  assert.equal(cleanCue("[ MUSIC ] go"), "go");
  assert.equal(cleanCue("Hi [Applause] there"), "Hi there");
  assert.equal(cleanCue("[laughter and cheering] ok"), "ok");
  assert.equal(cleanCue("[Inaudible] x [音乐] y [音樂]"), "x y");
});

test("cleanCue: keeps one space when a tag touches words on both sides", () => {
  assert.equal(cleanCue("Hi[Music]there"), "Hi there");
});

test("cleanCue: keeps unknown bracket content and unclosed tags as they are", () => {
  assert.equal(cleanCue("[Speaker 1] hi"), "[Speaker 1] hi");
  assert.equal(cleanCue("[Music hi"), "[Music hi");
});

test("cleanCue: collapses whitespace and handles null and undefined", () => {
  assert.equal(cleanCue("  a \n\t b  "), "a b");
  assert.equal(cleanCue(null), "");
  assert.equal(cleanCue(undefined), "");
  assert.equal(cleanCue(42), "42");
});

test("property: cleanCue is idempotent, the result has no >>, no leading or trailing whitespace and no repeated whitespace", () => {
  fc.assert(
    fc.property(fc.string(), (text) => {
      const once = cleanCue(text);
      return (
        cleanCue(once) === once && !once.includes(">>") && once === once.trim() && !/\s{2}/.test(once)
      );
    }),
  );
});

// ---- scoreColumns ----
const mark = (phone, bad = false) => ({ phone, bad });

test("scoreColumns: uses the server's columns as they are when it sends them", () => {
  const columns = [{ expected: mark("θ", true), heard: mark("s", true), status: "sub" }];
  assert.equal(scoreColumns({ columns, expected: [], heard: [] }), columns);
});

test("scoreColumns: an empty columns array is still the server's answer, with no fallback", () => {
  assert.deepEqual(scoreColumns({ columns: [], expected: [mark("a")], heard: [mark("a")] }), []);
});

test("scoreColumns: old data without columns is paired by position and given a status", () => {
  const columns = scoreColumns({
    expected: [mark("a"), mark("b", true), mark("c", true)],
    heard: [mark("a"), mark("x", true)],
  });
  assert.deepEqual(
    columns.map((c) => [c.expected?.phone ?? null, c.heard?.phone ?? null, c.status]),
    [
      ["a", "a", "match"],
      ["b", "x", "sub"],
      ["c", null, "del"],
    ],
  );
  const extra = scoreColumns({ expected: [], heard: [mark("z", true)] });
  assert.deepEqual([extra[0].expected, extra[0].heard.phone, extra[0].status], [null, "z", "ins"]);
});

test("scoreColumns: returns an empty array when there is no data at all", () => {
  assert.deepEqual(scoreColumns(undefined), []);
  assert.deepEqual(scoreColumns({}), []);
});

// ---- tokenize ----
const words = (text) => tokenize(text).filter((s) => s.word).map((s) => s.text);

test("tokenize: splits words like the server: contractions, hyphens and abbreviations stay together, punctuation is separate", () => {
  assert.deepEqual(
    words("It's 1990, well-known people don’t like the U.S. -- at all."),
    ["It's", "1990", "well-known", "people", "don’t", "like", "the", "U.S", "at", "all"],
  );
  assert.deepEqual(words(" -- ... "), []);
  assert.deepEqual(words("'quoted' -dash end-"), ["quoted", "dash", "end"]);
});

test("tokenize: putting the pieces back in order gives the original text, with words and gaps alternating", () => {
  assert.deepEqual(tokenize("Hi, you."), [
    { text: "Hi", word: true },
    { text: ", ", word: false },
    { text: "you", word: true },
    { text: ".", word: false },
  ]);
  assert.deepEqual(tokenize(""), []);
  assert.deepEqual(tokenize(null), []);
});

test("property: tokenize is lossless and adjacent pieces differ in kind", () => {
  fc.assert(
    fc.property(fc.string(), (text) => {
      const segments = tokenize(text);
      const alternates = segments.every((s, i) => i === 0 || s.word !== segments[i - 1].word);
      return segments.map((s) => s.text).join("") === text && alternates && segments.every((s) => s.text);
    }),
  );
});

test("lookupKey: turns a curly apostrophe into a straight one", () => {
  assert.equal(lookupKey("don’t"), "don't");
  assert.equal(lookupKey(undefined), "");
});

// ---- wordScores / wordColumns ----
const scoredWord = (text, first_column, column_count, bad = false) => ({ text, phones: 1, first_column, column_count, bad });

test("wordScores: matches scores to word pieces by position, with null for the gaps", () => {
  const score = { words: [scoredWord("I", 0, 1), scoredWord("go", 1, 2, true)] };
  const result = wordScores(tokenize("I go."), score);
  assert.deepEqual(result.map((w) => w?.text ?? null), ["I", null, "go", null]);
});

test("wordScores: every entry is null when the word count does not match or there are no scores", () => {
  const segments = tokenize("I go now");
  assert.deepEqual(wordScores(segments, { words: [scoredWord("I", 0, 1)] }), [null, null, null, null, null]);
  assert.deepEqual(wordScores(segments, null), [null, null, null, null, null]);
  assert.deepEqual(wordScores(segments, { words: [] }), [null, null, null, null, null]);
});

test("wordColumns: picks out the columns that belong to this word", () => {
  const columns = ["a", "b", "c", "d"].map((p) => ({ expected: mark(p), heard: mark(p), status: "match" }));
  assert.deepEqual(wordColumns({ columns }, scoredWord("x", 1, 2)).map((c) => c.expected.phone), ["b", "c"]);
  assert.deepEqual(wordColumns({ columns }, scoredWord("x", 4, 0)), []);
  assert.deepEqual(wordColumns({ columns }, null), []);
});

// ---- isVowel ----
test("isVowel: vowels, diphthongs and long vowels are vowels; consonants and affricates are not", () => {
  for (const phone of ["a", "æ", "ɑː", "ɔː", "ə", "ɜː", "ɪ", "ʊ", "ʌ", "ɚ", "ᵻ", "aɪ", "oʊ", "ɛɹ", "iː", "uː", "ɐ"]) {
    assert.equal(isVowel(phone), true, phone);
  }
  assert.equal(isVowel("ta"), false);
  assert.equal(isVowel("ɹɑ"), false);
  for (const phone of ["p", "θ", "ŋ", "tʃ", "dʒ", "ɹ", "ɾ", "w", "j", "əl".slice(1), "", null]) {
    assert.equal(isVowel(phone), false, String(phone));
  }
});

// ---- readButton ----
const base = { connected: true, hasCard: true, recording: false, hasScore: false };

test("readButton: can read aloud while a video plays (no longer taken over by \"摘下这句\", the pick-sentence button)", () => {
  assert.deepEqual(readButton(base), { label: "朗读", disabled: false });
});

test("readButton: shows \"再读一次\" (read again) once there is a score", () => {
  assert.deepEqual(readButton({ ...base, hasScore: true }), { label: "再读一次", disabled: false });
});

test("readButton: can be stopped while recording and cannot be clicked while uploading", () => {
  assert.deepEqual(readButton({ ...base, recording: { stop() {} } }), { label: "停止", disabled: false });
  assert.deepEqual(readButton({ ...base, recording: "uploading" }), { label: "正在听", disabled: true });
});

test("readButton: cannot be clicked when the local program is not connected or no sentence is selected", () => {
  assert.equal(readButton({ ...base, connected: false }).disabled, true);
  assert.equal(readButton({ ...base, hasCard: false }).disabled, true);
});

test("readButton: may still be stopped while recording even if the connection drops, so a recording can never get stuck", () => {
  assert.equal(readButton({ ...base, connected: false, recording: { stop() {} } }).disabled, false);
});

// ---- wordPayload ----
test("wordPayload: a saved word carries the source of the sentence it was picked from; a start of 0 ms must not be lost", () => {
  const cue = { videoId: "abc", startMs: 0, endMs: 3000 };
  assert.deepEqual(
    wordPayload({ word: "went", result: { word: "go", ipa: "ɡəʊ", definition: "去" }, sentence: ">> I went home", cue }),
    { word: "go", ipa: "ɡəʊ", definition: "去", source_sentence: "I went home", video_id: "abc", start_ms: 0, end_ms: 3000 },
  );
});

test("wordPayload: uses the selected word when the dictionary found nothing, and the other fields are null", () => {
  assert.deepEqual(wordPayload({ word: "zzz", result: { word: "zzz", ipa: null, definition: null }, sentence: "  ", cue: null }), {
    word: "zzz",
    ipa: null,
    definition: null,
    source_sentence: null,
    video_id: null,
    start_ms: null,
    end_ms: null,
  });
  assert.equal(wordPayload({ word: "zzz", result: null, sentence: "x", cue: {} }).word, "zzz");
});
