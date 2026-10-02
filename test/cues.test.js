const test = require("node:test");
const assert = require("node:assert/strict");
const fc = require("fast-check");
const { cleanCue, scoreColumns, tokenize, lookupKey, wordScores, wordColumns, isVowel, readButton, wordPayload } = require("../extension/cues.js");

// ---- cleanCue ----
test("cleanCue: 去掉换人说话的 >> 标记，不把相邻单词粘在一起", () => {
  assert.equal(cleanCue(">> Hello [Music] there >>"), "Hello there");
  assert.equal(cleanCue("a>>b"), "a b");
  assert.equal(cleanCue(">>>hi"), "hi");
  assert.equal(cleanCue(">> >>"), "");
});

test("cleanCue: 去掉环境声标记，大小写和空格不敏感，标记内可以有说明", () => {
  assert.equal(cleanCue("[Music]"), "");
  assert.equal(cleanCue("[ MUSIC ] go"), "go");
  assert.equal(cleanCue("Hi [Applause] there"), "Hi there");
  assert.equal(cleanCue("[laughter and cheering] ok"), "ok");
  assert.equal(cleanCue("[Inaudible] x [音乐] y [音樂]"), "x y");
});

test("cleanCue: 标记两边紧贴单词时也留一个空格", () => {
  assert.equal(cleanCue("Hi[Music]there"), "Hi there");
});

test("cleanCue: 不认识的方括号内容和没闭合的标记原样保留", () => {
  assert.equal(cleanCue("[Speaker 1] hi"), "[Speaker 1] hi");
  assert.equal(cleanCue("[Music hi"), "[Music hi");
});

test("cleanCue: 压缩空白，处理 null 和 undefined", () => {
  assert.equal(cleanCue("  a \n\t b  "), "a b");
  assert.equal(cleanCue(null), "");
  assert.equal(cleanCue(undefined), "");
  assert.equal(cleanCue(42), "42");
});

test("性质: cleanCue 幂等，结果不含 >>，不以空白开头结尾，没有连续空白", () => {
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

test("scoreColumns: 服务端给了 columns 就原样使用", () => {
  const columns = [{ expected: mark("θ", true), heard: mark("s", true), status: "sub" }];
  assert.equal(scoreColumns({ columns, expected: [], heard: [] }), columns);
});

test("scoreColumns: 空的 columns 也是服务端给的，不回退", () => {
  assert.deepEqual(scoreColumns({ columns: [], expected: [mark("a")], heard: [mark("a")] }), []);
});

test("scoreColumns: 旧数据没有 columns 时按位置配对，并给出状态", () => {
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

test("scoreColumns: 没有任何数据时返回空数组", () => {
  assert.deepEqual(scoreColumns(undefined), []);
  assert.deepEqual(scoreColumns({}), []);
});

// ---- tokenize ----
const words = (text) => tokenize(text).filter((s) => s.word).map((s) => s.text);

test("tokenize: 和服务端同样分词：缩写、连字符、缩略词连在一起，标点分开", () => {
  assert.deepEqual(
    words("It's 1990, well-known people don’t like the U.S. -- at all."),
    ["It's", "1990", "well-known", "people", "don’t", "like", "the", "U.S", "at", "all"],
  );
  assert.deepEqual(words(" -- ... "), []);
  assert.deepEqual(words("'quoted' -dash end-"), ["quoted", "dash", "end"]);
});

test("tokenize: 片段按原文顺序拼回去就是原文，单词与间隔交替", () => {
  assert.deepEqual(tokenize("Hi, you."), [
    { text: "Hi", word: true },
    { text: ", ", word: false },
    { text: "you", word: true },
    { text: ".", word: false },
  ]);
  assert.deepEqual(tokenize(""), []);
  assert.deepEqual(tokenize(null), []);
});

test("性质: tokenize 无损，相邻片段类型不同", () => {
  fc.assert(
    fc.property(fc.string(), (text) => {
      const segments = tokenize(text);
      const alternates = segments.every((s, i) => i === 0 || s.word !== segments[i - 1].word);
      return segments.map((s) => s.text).join("") === text && alternates && segments.every((s) => s.text);
    }),
  );
});

test("lookupKey: 弯撇号换成直撇号", () => {
  assert.equal(lookupKey("don’t"), "don't");
  assert.equal(lookupKey(undefined), "");
});

// ---- wordScores / wordColumns ----
const scoredWord = (text, first_column, column_count, bad = false) => ({ text, phones: 1, first_column, column_count, bad });

test("wordScores: 按位置把评分对到单词片段上，间隔是 null", () => {
  const score = { words: [scoredWord("I", 0, 1), scoredWord("go", 1, 2, true)] };
  const result = wordScores(tokenize("I go."), score);
  assert.deepEqual(result.map((w) => w?.text ?? null), ["I", null, "go", null]);
});

test("wordScores: 单词个数对不上或没有评分时全部是 null", () => {
  const segments = tokenize("I go now");
  assert.deepEqual(wordScores(segments, { words: [scoredWord("I", 0, 1)] }), [null, null, null, null, null]);
  assert.deepEqual(wordScores(segments, null), [null, null, null, null, null]);
  assert.deepEqual(wordScores(segments, { words: [] }), [null, null, null, null, null]);
});

test("wordColumns: 取出这个词自己的那几列", () => {
  const columns = ["a", "b", "c", "d"].map((p) => ({ expected: mark(p), heard: mark(p), status: "match" }));
  assert.deepEqual(wordColumns({ columns }, scoredWord("x", 1, 2)).map((c) => c.expected.phone), ["b", "c"]);
  assert.deepEqual(wordColumns({ columns }, scoredWord("x", 4, 0)), []);
  assert.deepEqual(wordColumns({ columns }, null), []);
});

// ---- isVowel ----
test("isVowel: 元音、双元音、长元音是元音；辅音、塞擦音不是", () => {
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

test("readButton: 有视频在播也能朗读（不再被「摘下这句」占用）", () => {
  assert.deepEqual(readButton(base), { label: "朗读", disabled: false });
});

test("readButton: 已有评分显示「再读一次」", () => {
  assert.deepEqual(readButton({ ...base, hasScore: true }), { label: "再读一次", disabled: false });
});

test("readButton: 录音中可以停止，上传中不可点", () => {
  assert.deepEqual(readButton({ ...base, recording: { stop() {} } }), { label: "停止", disabled: false });
  assert.deepEqual(readButton({ ...base, recording: "uploading" }), { label: "正在听", disabled: true });
});

test("readButton: 没连上本机程序或没有选中句子时不可点", () => {
  assert.equal(readButton({ ...base, connected: false }).disabled, true);
  assert.equal(readButton({ ...base, hasCard: false }).disabled, true);
});

test("readButton: 录音中即使断开连接也允许停止，避免录音停不下来", () => {
  assert.equal(readButton({ ...base, connected: false, recording: { stop() {} } }).disabled, false);
});

// ---- wordPayload ----
test("wordPayload: 生词带上选词时那一句的来源，起点 0 毫秒不能丢", () => {
  const cue = { videoId: "abc", startMs: 0, endMs: 3000 };
  assert.deepEqual(
    wordPayload({ word: "went", result: { word: "go", ipa: "ɡəʊ", definition: "去" }, sentence: ">> I went home", cue }),
    { word: "go", ipa: "ɡəʊ", definition: "去", source_sentence: "I went home", video_id: "abc", start_ms: 0, end_ms: 3000 },
  );
});

test("wordPayload: 词典没查到时用选中的词，其余字段为 null", () => {
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
