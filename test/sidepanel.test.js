const test = require("node:test");
const assert = require("node:assert/strict");
const { createPanel, json, deferred, networkError, card, word, ph, EXTENSION_ID } = require("./helpers/panel.js");

const API = "http://127.0.0.1:17321";
const MIC_PROMPT = "需要麦克风权限";

const cue = (text = "Hello world", extra = {}) => ({ videoId: "vid1", startMs: 5000, endMs: 8000, text, ...extra });

const lookupRoute = (overrides = {}) => (call) =>
  json({ word: call.query.get("word"), ipa: "həˈləʊ", definition: "你好", ...overrides });

// The three words of "Hello there world.": the first one was not read correctly.
const scoredCard = (overrides = {}) =>
  card({
    score: {
      match_count: 3,
      expected_count: 4,
      expected: [ph("h"), ph("ə"), ph("ð"), ph("w")],
      heard: [ph("h"), ph("ɛ", true), ph("ð"), null],
      words: [
        { bad: true, first_column: 0, column_count: 2 },
        { bad: false, first_column: 2, column_count: 1 },
        { bad: false, first_column: 3, column_count: 1 },
      ],
    },
    ...overrides,
  });

const texts = (nodes) => nodes.map((node) => node.textContent);

// Clicking a button: a disabled button cannot be clicked in jsdom, so release it first to reach the guard branch.
async function forceClick(p, selector) {
  p.$(selector).disabled = false;
  await p.click(selector);
}

// ---- status polling ----

test("the fetch test double rejects a request path absent from OpenAPI", async (t) => {
  const p = await createPanel(t);
  await assert.rejects(p.window.fetch(`${API}/not-a-real-operation`), /not declared by OpenAPI/);
});

test("startup: when the local program is online, shows connected and fetches the picked sentences and words", async (t) => {
  const p = await createPanel(t, { cards: [card()], words: [word()] });
  assert.equal(p.text("#status-text"), "本机已连接");
  assert.ok(p.$("#dot").classList.contains("on"));
  assert.equal(p.$$("#list li").length, 1);
  assert.equal(p.$$("#word-list li").length, 1);
});

test("startup: when the local program is off, shows that it is off, cannot add, and gets no data", async (t) => {
  const p = await createPanel(t, { server: { up: false }, cards: [card()] });
  assert.equal(p.text("#status-text"), "本机程序没开");
  assert.ok(!p.$("#dot").classList.contains("on"));
  assert.equal(p.$("#add").disabled, true);
  assert.equal(p.$$("#list li.empty").length, 1);
});

test("health polling: going from disconnected to connected fetches sentences and words again, and an unchanged connection state does not fetch again", async (t) => {
  const p = await createPanel(t, { server: { up: false }, cards: [card()], words: [word()] });
  const cardFetches = p.callsTo("GET /cards").length;
  const wordFetches = p.callsTo("GET /words").length;
  p.server.up = true;
  await p.pollHealth();
  assert.equal(p.text("#status-text"), "本机已连接");
  assert.equal(p.callsTo("GET /cards").length, cardFetches + 1);
  assert.equal(p.callsTo("GET /words").length, wordFetches + 1);
  assert.equal(p.$$("#list li").length, 1);

  await p.pollHealth();
  assert.equal(p.callsTo("GET /cards").length, cardFetches + 1);
  assert.equal(p.callsTo("GET /words").length, wordFetches + 1);
});

test("health polling: a connection that drops midway shows off, and a health check returning non-2xx also counts as not connected", async (t) => {
  const p = await createPanel(t);
  p.server.up = false;
  await p.pollHealth();
  assert.equal(p.text("#status-text"), "本机程序没开");
  assert.ok(!p.$("#dot").classList.contains("on"));

  p.route("GET /health", json({}, 503));
  await p.pollHealth();
  assert.equal(p.text("#status-text"), "本机程序没开");
});

test("fetch failure: when the sentence and word lists cannot be fetched it does not throw and the interface stays as it was", async (t) => {
  const failing = () => {
    throw networkError();
  };
  const p = await createPanel(t, { routes: { "GET /cards": failing, "GET /words": failing } });
  assert.equal(p.text("#status-text"), "本机已连接");
  assert.equal(p.$$("#list li.empty").length, 1);
  assert.equal(p.$$("#word-list li.empty").length, 1);

  p.server.up = false;
  await p.pollHealth();
  p.server.up = true;
  await p.pollHealth();
  await p.click("#words-tab");
  assert.equal(p.text("#status-text"), "本机已连接");
  assert.equal(p.$$("#word-list li.empty").length, 1);
});

// ---- current sentence: caption polling ----

test("caption polling: with no video it shows only the hint and every button is disabled", async (t) => {
  const p = await createPanel(t);
  await p.pollCue();
  assert.equal(p.$("#live-text").dataset.placeholder, "打开一个 YouTube 视频");
  assert.equal(p.text("#live-meta"), "");
  assert.equal(p.$("#clip").disabled, true);
  assert.equal(p.$("#live-play").disabled, true);
  assert.equal(p.hidden("#adjust"), true);
  assert.equal(p.$$("#live-text .tok").length, 0);
});

test("caption polling: with a video but no caption for this sentence it says so, and the original audio can still be played", async (t) => {
  const p = await createPanel(t);
  await p.cue(cue(""), "no-caption");
  assert.equal(p.$("#live-text").dataset.placeholder, "这一句没有字幕");
  assert.equal(p.text("#live-meta"), "0:05");
  assert.equal(p.$("#clip").disabled, true);
  assert.equal(p.$("#live-play").disabled, false);
  assert.equal(p.hidden("#adjust"), false);
  assert.equal(p.$$("#live-text .tok").length, 0);
});

test("caption polling: with a caption it cleans the tags, renders word by word and shows the start time", async (t) => {
  const p = await createPanel(t);
  await p.cue(cue(">> Hello [Music]  big, world", { startMs: 3_661_000 }));
  assert.deepEqual(texts(p.$$("#live-text .tok")), ["Hello", "big", "world"]);
  assert.equal(p.$("#live-text").textContent, "Hello big, world");
  assert.equal(p.text("#live-meta"), "1:01:01");
  assert.equal(p.$("#clip").disabled, false);
  assert.equal(p.$("#live-play").disabled, false);
});

test("caption polling: a start time under an hour shows minutes and seconds, and a negative one counts as zero", async (t) => {
  const p = await createPanel(t);
  await p.cue(cue("Hi", { startMs: 65_000 }));
  assert.equal(p.text("#live-meta"), "1:05");
  await p.cue(cue("Hi", { startMs: -4000 }));
  assert.equal(p.text("#live-meta"), "0:00");
});

test("caption polling: an empty message is treated as no video", async (t) => {
  const p = await createPanel(t);
  p.replies["get-cue"] = undefined;
  await p.pollCue();
  assert.equal(p.$("#live-text").dataset.placeholder, "打开一个 YouTube 视频");
  assert.equal(p.$("#clip").disabled, true);
});

test("caption polling: an unchanged caption does not redraw the sentence; a change in any field does", async (t) => {
  const p = await createPanel(t);
  await p.cue(cue());
  const first = p.$("#live-text .tok");
  await p.cue(cue());
  assert.equal(p.$("#live-text .tok"), first);

  for (const change of [{ startMs: 5001 }, { endMs: 8001 }, { videoId: "vid2" }, { text: "Hello again" }]) {
    const before = p.$("#live-text .tok");
    await p.cue(cue(change.text ?? "Hello world", change));
    assert.notEqual(p.$("#live-text .tok"), before, JSON.stringify(change));
    await p.cue(cue());
  }
});

test("caption polling: when fetching the caption fails it does not throw and keeps the previous sentence", async (t) => {
  const p = await createPanel(t);
  await p.cue(cue());
  p.replies["get-cue"] = new Error("扩展断开了");
  await p.pollCue();
  assert.equal(p.$("#live-text").textContent, "Hello world");
});

test("caption polling: when the caption changes, closes the popup that points at an old word; a popup pointing elsewhere is not affected", async (t) => {
  const p = await createPanel(t, { cards: [card()], routes: { "GET /lookup": lookupRoute() } });
  await p.cue(cue());
  await p.click(p.$("#live-text .tok"));
  assert.equal(p.hidden("#word-popover"), false);
  await p.cue(cue("Something else"));
  assert.equal(p.hidden("#word-popover"), true);

  await p.click(p.$("#card-sentence .tok"));
  assert.equal(p.hidden("#word-popover"), false);
  await p.cue(cue("Another line"));
  assert.equal(p.hidden("#word-popover"), false);
});

test("adjust caption: the four plus/minus buttons and the reset button each send the matching message", async (t) => {
  const p = await createPanel(t);
  await p.cue(cue());
  await p.click("#start-more");
  await p.click("#start-less");
  await p.click("#end-less");
  await p.click("#end-more");
  await p.click("#reset-cue");
  assert.deepEqual(
    p.messages.filter((m) => m.type !== "get-cue"),
    [
      { type: "adjust-cue", edge: "start", delta: -1 },
      { type: "adjust-cue", edge: "start", delta: 1 },
      { type: "adjust-cue", edge: "end", delta: -1 },
      { type: "adjust-cue", edge: "end", delta: 1 },
      { type: "reset-cue" },
    ],
  );
});

// ---- picking this sentence, pasting a sentence ----

test("pick this sentence: sends the current caption and time to the local program and selects the new card", async (t) => {
  const created = card({ id: "c9", text: "Hello world", source: "youtube", video_id: "vid1", start_ms: 5000, end_ms: 8000 });
  const p = await createPanel(t, {
    cards: [card()],
    routes: {
      "POST /cards": (call) => {
        p.data.cards.unshift(created);
        return json({ card: created }, 201);
      },
    },
  });
  await p.cue(cue());
  p.replies["play-range"] = { ok: false, error: "视频没打开" };
  await p.click("#live-play");
  assert.equal(p.text("#live-hint"), "视频没打开");
  await p.click("#clip");
  const [post] = p.callsTo("POST /cards");
  assert.deepEqual(post.body, { text: "Hello world", source: "youtube", video_id: "vid1", start_ms: 5000, end_ms: 8000 });
  assert.equal(post.headers["Content-Type"], "application/json");
  assert.equal(p.text("#card-sentence"), "Hello world");
  assert.equal(p.$("#list li.selected").textContent, "Hello world");
  await p.pollCue();
  assert.equal(p.text("#live-hint"), "");
});

test("pick this sentence: when the local program refuses, shows its reason, or a default message when there is none, and the next click clears the old hint first", async (t) => {
  const p = await createPanel(t, { routes: { "POST /cards": json({ error: "太长了" }, 400) } });
  await p.cue(cue());
  const cardFetches = p.callsTo("GET /cards").length;
  await p.click("#clip");
  assert.equal(p.text("#live-hint"), "太长了");
  assert.equal(p.callsTo("GET /cards").length, cardFetches);

  p.route("POST /cards", json({}, 500));
  await p.click("#clip");
  assert.equal(p.text("#live-hint"), "没有摘下来");
});

test("pick this sentence: does nothing when there is no caption text", async (t) => {
  const p = await createPanel(t);
  await forceClick(p, "#clip");
  await p.cue(cue(""), "no-caption");
  await forceClick(p, "#clip");
  assert.equal(p.callsTo("POST /cards").length, 0);
});

test("paste a sentence: adds it after trimming whitespace, clears the input and selects the new card", async (t) => {
  const created = card({ id: "c5", text: "Pasted line" });
  const p = await createPanel(t, {
    cards: [card()],
    routes: {
      "POST /cards": () => {
        p.data.cards.push(created);
        return json({ card: created }, 201);
      },
    },
  });
  p.$("#paste").value = "  Pasted line \n";
  await p.click("#add");
  assert.deepEqual(p.callsTo("POST /cards")[0].body, { text: "Pasted line", source: "paste" });
  assert.equal(p.$("#paste").value, "");
  assert.equal(p.text("#card-sentence"), "Pasted line");
});

test("paste a sentence: Enter in the input also adds it, other keys do not", async (t) => {
  const created = card({ id: "c5", text: "Typed" });
  const p = await createPanel(t, { routes: { "POST /cards": json({ card: created }, 201) } });
  p.$("#paste").value = "Typed";
  await p.press("#paste", "a");
  assert.equal(p.callsTo("POST /cards").length, 0);
  await p.press("#paste", "Enter");
  assert.equal(p.callsTo("POST /cards").length, 1);
});

test("paste a sentence: when the local program refuses, shows the reason or a default message and keeps the input", async (t) => {
  const p = await createPanel(t, { routes: { "POST /cards": json({ error: "已经有了" }, 409) } });
  p.$("#paste").value = "Dup";
  await p.click("#add");
  assert.equal(p.text("#read-hint"), "已经有了");
  assert.equal(p.$("#paste").value, "Dup");

  p.route("POST /cards", json({}, 500));
  await p.click("#add");
  assert.equal(p.text("#read-hint"), "没有加入");
});

test("paste a sentence: sends no request when there is only whitespace", async (t) => {
  const p = await createPanel(t);
  p.$("#paste").value = "   ";
  await p.click("#add");
  assert.equal(p.callsTo("POST /cards").length, 0);
});

// ---- picked list and this sentence ----

test("picked list: with no sentences it shows the empty state, nothing is selected, and the edit and reference-audio buttons are hidden", async (t) => {
  const p = await createPanel(t);
  assert.equal(p.text("#list li.empty"), "还没有摘过句子");
  assert.equal(p.hidden("#edit"), true);
  assert.equal(p.hidden("#card-play"), true);
  assert.equal(p.hidden("#mine"), true);
  assert.equal(p.$$("#card-sentence .tok").length, 0);
  assert.equal(p.text("#read"), "朗读");
  assert.equal(p.$("#read").disabled, true);
});

test("picked list: selects the first one by default, clicking another switches, clears the hint and leaves edit mode", async (t) => {
  const p = await createPanel(t, { cards: [card({ id: "a", text: "First one" }), card({ id: "b", text: "Second one" })] });
  assert.equal(p.text("#card-sentence"), "First one");
  assert.equal(p.$("#list li.selected").textContent, "First one");

  await p.click("#edit");
  assert.equal(p.hidden("#card-text"), false);
  await p.click(p.$$("#list li")[1]);
  assert.equal(p.text("#card-sentence"), "Second one");
  assert.equal(p.$("#list li.selected").textContent, "Second one");
  assert.equal(p.hidden("#card-text"), true);
  assert.equal(p.text("#edit"), "编辑");
});

test("picked list: after the selected sentence is deleted it goes back to the first one, and clears when none is left", async (t) => {
  const p = await createPanel(t, { cards: [card({ id: "a", text: "First one" }), card({ id: "b", text: "Second one" })] });
  await p.click(p.$$("#list li")[1]);

  const reconnect = async () => {
    p.server.up = false;
    await p.pollHealth();
    p.server.up = true;
    await p.pollHealth();
  };
  p.data.cards = [card({ id: "a", text: "First one" })];
  await reconnect();
  assert.equal(p.text("#card-sentence"), "First one");

  p.data.cards = [];
  await reconnect();
  assert.equal(p.$$("#card-sentence .tok").length, 0);
  assert.equal(p.$$("#list li.empty").length, 1);
  assert.equal(p.hidden("#edit"), true);
});

test("picked list: when the server returns no cards or words field, treats it as an empty list", async (t) => {
  const p = await createPanel(t, { routes: { "GET /cards": json({}), "GET /words": json({}) } });
  assert.equal(p.$$("#list li.empty").length, 1);
  assert.equal(p.$$("#word-list li.empty").length, 1);
});

test("this sentence: repeated rendering does not rebuild it while the sentence is unchanged; a change of sentence or score rebuilds it", async (t) => {
  const p = await createPanel(t, { cards: [card()] });
  const first = p.$("#card-sentence .tok");
  await p.pollHealth();
  assert.equal(p.$("#card-sentence .tok"), first);

  p.data.cards = [card({ latest_attempt_id: "a1" })];
  p.server.up = false;
  await p.pollHealth();
  p.server.up = true;
  await p.pollHealth();
  assert.notEqual(p.$("#card-sentence .tok"), first);
  assert.equal(p.hidden("#mine"), false);
});

test("this sentence: rebuilding the sentence closes a popup pointing at a word in it, while an ordinary refresh keeps it", async (t) => {
  const p = await createPanel(t, { cards: [card()], routes: { "GET /lookup": lookupRoute() } });
  await p.click(p.$("#card-sentence .tok"));
  await p.pollHealth();
  assert.equal(p.hidden("#word-popover"), false);

  p.data.cards = [card({ text: "Brand new sentence" })];
  p.server.up = false;
  await p.pollHealth();
  p.server.up = true;
  await p.pollHealth();
  assert.equal(p.hidden("#word-popover"), true);
  assert.equal(p.text("#card-sentence"), "Brand new sentence");
});

// ---- scoring ----

test("scoring: shows it word by word, gives the count when some words were wrong, and marks the bad words red", async (t) => {
  const p = await createPanel(t, { cards: [scoredCard()] });
  assert.equal(p.text("#score .ratio"), "3/4");
  assert.equal(p.text("#score .hit span"), "命中 3/4");
  assert.equal(p.text("#score .legend"), "1 个词没读准，点红色的词看看");
  assert.equal(p.$$("#score .pcol").length, 0);
  assert.deepEqual(
    p.$$("#card-sentence .tok").map((tok) => tok.classList.contains("bad")),
    [true, false, false],
  );
  assert.equal(p.text("#read"), "再读一次");
});

test("scoring: says so when every word was read correctly", async (t) => {
  const good = scoredCard();
  good.score.words.forEach((w) => (w.bad = false));
  const p = await createPanel(t, { cards: [good] });
  assert.equal(p.text("#score .legend"), "每个词都读准了");
  assert.equal(p.$$("#card-sentence .tok.bad").length, 0);
});

test("scoring: without per-word results falls back to the phoneme comparison table, reference on top and yours below, with missing cells left empty", async (t) => {
  const noWords = scoredCard();
  delete noWords.score.words;
  const p = await createPanel(t, { cards: [noWords] });
  assert.equal(p.text("#score .legend"), "上 标准 · 下 你的");
  const columns = p.$$("#score .pcol");
  assert.equal(columns.length, 4);
  assert.deepEqual(texts([...columns[1].children]), ["ə", "ɛ"]);
  assert.equal(columns[3].children[1].disabled, true);
  assert.equal(columns[3].children[1].textContent, "");
  assert.ok(columns[1].children[1].classList.contains("bad"));
  assert.ok(columns[0].children[0].classList.contains("vowel") === false);
  assert.ok(columns[1].children[0].classList.contains("vowel"));
});

test("scoring: an empty per-word array also uses the phoneme comparison table", async (t) => {
  const empty = scoredCard();
  empty.score.words = [];
  const p = await createPanel(t, { cards: [empty] });
  assert.equal(p.$$("#score .pcol").length, 4);
});

test("scoring: when the per-word results do not match the sentence's word count, marks nothing red and clicking a word goes to the phoneme lookup", async (t) => {
  const mismatch = scoredCard();
  mismatch.score.words.pop();
  const p = await createPanel(t, {
    cards: [mismatch],
    routes: { "GET /lookup": lookupRoute(), "GET /phones": json({ phones: ["h", "ə"] }) },
  });
  assert.equal(p.$$("#card-sentence .tok.bad").length, 0);
  await p.click(p.$("#card-sentence .tok"));
  assert.equal(p.callsTo("GET /phones").length, 1);
});

test("scoring: clicking a phoneme cell in the score plays that phoneme, and a failure is shown under this sentence", async (t) => {
  const noWords = scoredCard();
  delete noWords.score.words;
  const p = await createPanel(t, { cards: [noWords] });
  await p.click(p.$$("#score .pcol")[1].children[0]);
  assert.equal(p.sound().url, `${API}/speak?ipa=${encodeURIComponent("ə")}`);

  p.sounds.behaviour = () => Promise.reject(new Error("blocked"));
  await p.click(p.$$("#score .pcol")[1].children[1]);
  assert.equal(p.text("#read-hint"), "暂时无法播放音素 ɛ");
});

// ---- word popup ----

test("popup: after clicking a word it first shows looking up, then the phonetic and definition once found, the word is highlighted and the popup is open", async (t) => {
  const pending = deferred();
  const p = await createPanel(t, { routes: { "GET /lookup": () => pending.promise } });
  await p.cue(cue());
  const token = p.$("#live-text .tok");
  await p.click(token);
  assert.equal(p.hidden("#word-popover"), false);
  assert.ok(token.classList.contains("active"));
  assert.equal(p.text("#word-popover strong"), "Hello");
  assert.equal(p.text("#word-popover .definition"), "查询中…");
  assert.equal(p.$("#word-popover .secondary").disabled, true);

  pending.resolve(json({ word: "Hello", ipa: "həˈləʊ", definition: "你好" }));
  await p.flush();
  assert.equal(p.text("#word-popover .ipa"), "/həˈləʊ/");
  assert.equal(p.text("#word-popover .definition"), "你好");
  assert.equal(p.text("#word-popover .secondary"), "收藏");
  assert.equal(p.$("#word-popover .secondary").disabled, false);
  assert.equal(p.callsTo("GET /lookup")[0].query.get("word"), "Hello");
});

test("popup: a phonetic that already has slashes or brackets is shown as it is, and no phonetic leaves it empty", async (t) => {
  const p = await createPanel(t, { routes: { "GET /lookup": lookupRoute({ ipa: "[həˈləʊ]" }) } });
  await p.cue(cue());
  await p.click(p.$("#live-text .tok"));
  assert.equal(p.text("#word-popover .ipa"), "[həˈləʊ]");

  p.route("GET /lookup", lookupRoute({ ipa: "/həˈləʊ/" }));
  await p.click(p.$("#live-text .tok"));
  assert.equal(p.text("#word-popover .ipa"), "/həˈləʊ/");

  p.route("GET /lookup", lookupRoute({ ipa: null }));
  await p.click(p.$("#live-text .tok"));
  assert.equal(p.text("#word-popover .ipa"), "");
});

test("popup: when the dictionary returns an error it shows the reason, or a default message when there is none", async (t) => {
  const p = await createPanel(t, { routes: { "GET /lookup": json({ error: "词典坏了" }, 500) } });
  await p.cue(cue());
  await p.click(p.$("#live-text .tok"));
  assert.equal(p.text("#word-popover .definition"), "词典坏了");
  assert.equal(p.text("#word-popover .ipa"), "");

  p.route("GET /lookup", json({}, 500));
  await p.click(p.$("#live-text .tok"));
  assert.equal(p.text("#word-popover .definition"), "查询失败");
});

test("popup: when the local program is off (the request fails) it says so, and the save button can still be clicked", async (t) => {
  const p = await createPanel(t);
  await p.cue(cue());
  await p.click(p.$("#live-text .tok"));
  assert.equal(p.text("#word-popover .definition"), "本机程序没开");
  assert.equal(p.$("#word-popover .secondary").disabled, false);
});

test("popup: when the dictionary has no definition it says there is no dictionary definition", async (t) => {
  const p = await createPanel(t, { routes: { "GET /lookup": lookupRoute({ definition: null }) } });
  await p.cue(cue());
  await p.click(p.$("#live-text .tok"));
  assert.equal(p.text("#word-popover .definition"), "没有词典释义");
});

test("popup: a curly apostrophe is looked up as a straight one", async (t) => {
  const p = await createPanel(t, { routes: { "GET /lookup": lookupRoute() } });
  await p.cue(cue("don’t"));
  await p.click(p.$("#live-text .tok"));
  assert.equal(p.callsTo("GET /lookup")[0].query.get("word"), "don't");
  assert.equal(p.text("#word-popover strong"), "don’t");
});

test("popup: clicking the speaker in the popup reads the word aloud", async (t) => {
  const p = await createPanel(t, { routes: { "GET /lookup": lookupRoute() } });
  await p.cue(cue());
  await p.click(p.$("#live-text .tok"));
  await p.click(p.$("#word-popover .icon-button"));
  assert.equal(p.sound().url, `${API}/speak?text=Hello`);
  assert.equal(p.hidden("#word-popover"), false);
});

test("popup: a word that is already saved shows saved, clicking it opens the word detail, matched by the word itself", async (t) => {
  const p = await createPanel(t, { words: [word({ id: "w7", word: "hello" })], routes: { "GET /lookup": lookupRoute() } });
  await p.cue(cue());
  await p.click(p.$("#live-text .tok"));
  const button = p.$("#word-popover .secondary");
  assert.equal(button.textContent, "已收藏 · 查看");
  await p.click(button);
  assert.equal(p.hidden("#word-popover"), true);
  assert.equal(p.hidden("#word-view"), false);
  assert.equal(p.hidden("#main"), true);
  assert.equal(p.text("#wv-word"), "hello");
});

test("popup: when the lemma returned by the dictionary is already saved, it matches the saved word by the lemma", async (t) => {
  const p = await createPanel(t, { words: [word({ id: "w8", word: "run" })], routes: { "GET /lookup": lookupRoute({ word: "Run" }) } });
  await p.cue(cue("running"));
  await p.click(p.$("#live-text .tok"));
  assert.equal(p.text("#word-popover .secondary"), "已收藏 · 查看");
});

test("popup: a word that was not found and was never saved has a save button", async (t) => {
  const p = await createPanel(t, { words: [word({ id: "w8", word: "run" })] });
  await p.cue(cue("walking"));
  await p.click(p.$("#live-text .tok"));
  assert.equal(p.text("#word-popover .secondary"), "收藏");
});

test("popup: saving carries the sentence and the video time, then the button becomes saved", async (t) => {
  const p = await createPanel(t, {
    routes: {
      "GET /lookup": lookupRoute(),
      "POST /words": (call) => {
        p.data.words.push(word({ id: "w2", word: call.body.word.toLowerCase() }));
        return json({ word: call.body }, 201);
      },
    },
  });
  await p.cue(cue("Hello [Music] world"));
  await p.click(p.$("#live-text .tok"));
  const button = p.$("#word-popover .secondary");
  const pending = deferred();
  p.route("POST /words", (call) => pending.promise.then(() => {
    p.data.words.push(word({ id: "w2", word: call.body.word.toLowerCase() }));
    return json({}, 201);
  }));
  button.click();
  await p.flush();
  assert.equal(button.disabled, true);
  pending.resolve();
  await p.flush();
  assert.deepEqual(p.callsTo("POST /words")[0].body, {
    word: "Hello",
    ipa: "həˈləʊ",
    definition: "你好",
    source_sentence: "Hello world",
    video_id: "vid1",
    start_ms: 5000,
    end_ms: 8000,
  });
  assert.equal(button.textContent, "已收藏 · 查看");
  assert.equal(button.disabled, false);
  assert.equal(p.$$("#word-list li").length, 1);
});

test("popup: when the local program fails or is off while saving, the button says try again and becomes clickable again", async (t) => {
  const p = await createPanel(t, { routes: { "GET /lookup": lookupRoute(), "POST /words": json({}, 500) } });
  await p.cue(cue());
  await p.click(p.$("#live-text .tok"));
  const button = p.$("#word-popover .secondary");
  await p.click(button);
  assert.equal(button.textContent, "没有收藏上，再试一次");
  assert.equal(button.disabled, false);

  p.routes.delete("POST /words");
  await p.click(button);
  assert.equal(button.textContent, "没有收藏上，再试一次");
  assert.equal(button.disabled, false);
});

test("popup: saving a word from a picked sentence leaves the video time fields empty, while a YouTube sentence carries the time", async (t) => {
  const yt = card({ source: "youtube", video_id: "vid9", start_ms: 1000, end_ms: 2000, text: "Hi there" });
  const p = await createPanel(t, {
    cards: [yt],
    routes: { "GET /lookup": lookupRoute(), "POST /words": json({}, 201) },
  });
  await p.click(p.$("#card-sentence .tok"));
  await p.click("#word-popover .secondary");
  assert.deepEqual(
    [p.callsTo("POST /words")[0].body.video_id, p.callsTo("POST /words")[0].body.start_ms, p.callsTo("POST /words")[0].body.end_ms],
    ["vid9", 1000, 2000],
  );

  const pasted = card({ id: "c2", text: "Plain one" });
  const q = await createPanel(t, { cards: [pasted], routes: { "GET /lookup": lookupRoute(), "POST /words": json({}, 201) } });
  await q.click(q.$("#card-sentence .tok"));
  await q.click("#word-popover .secondary");
  const body = q.callsTo("POST /words")[0].body;
  assert.deepEqual([body.video_id, body.start_ms, body.end_ms, body.source_sentence], [null, null, null, "Plain one"]);
});

test("popup: Esc closes it, and Esc with no popup, or other keys, have no effect", async (t) => {
  const p = await createPanel(t, { routes: { "GET /lookup": lookupRoute() } });
  await p.cue(cue());
  const token = p.$("#live-text .tok");
  await p.press(p.document, "Escape");
  await p.click(token);
  await p.press(p.document, "a");
  assert.equal(p.hidden("#word-popover"), false);
  await p.press(p.document, "Escape");
  assert.equal(p.hidden("#word-popover"), true);
  assert.ok(!token.classList.contains("active"));
});

test("popup: clicking outside the popup closes it, clicking inside it or on another word does not close it for that reason", async (t) => {
  const p = await createPanel(t, { routes: { "GET /lookup": lookupRoute() } });
  await p.cue(cue());
  await p.pointerDown(p.$("#live-text"));
  await p.click(p.$("#live-text .tok"));
  await p.pointerDown(p.$("#word-popover strong"));
  assert.equal(p.hidden("#word-popover"), false);
  await p.pointerDown(p.$$("#live-text .tok")[1]);
  assert.equal(p.hidden("#word-popover"), false);
  await p.pointerDown(p.$("#status-text"));
  assert.equal(p.hidden("#word-popover"), true);
});

test("popup: an event whose target is the document itself also counts as a click outside", async (t) => {
  const p = await createPanel(t, { routes: { "GET /lookup": lookupRoute() } });
  await p.cue(cue());
  await p.click(p.$("#live-text .tok"));
  await p.pointerDown(p.document);
  assert.equal(p.hidden("#word-popover"), true);
});

test("popup: Enter or space on the keyboard also opens it, other keys do not", async (t) => {
  const p = await createPanel(t, { routes: { "GET /lookup": lookupRoute() } });
  await p.cue(cue());
  const token = p.$("#live-text .tok");
  assert.equal(token.tabIndex, 0);
  assert.equal(token.getAttribute("role"), "button");

  const other = await p.press(token, "a");
  assert.equal(p.hidden("#word-popover"), true);
  assert.equal(other.defaultPrevented, false);

  const enter = await p.press(token, "Enter");
  assert.equal(p.hidden("#word-popover"), false);
  assert.equal(enter.defaultPrevented, true);

  await p.press(p.document, "Escape");
  const space = await p.press(token, " ");
  assert.equal(p.hidden("#word-popover"), false);
  assert.equal(space.defaultPrevented, true);
});

test("popup position: sticks to the edge on the right, is not less than 8 on the left, and flips above the word when there is no room below", async (t) => {
  const p = await createPanel(t, { routes: { "GET /lookup": lookupRoute() } });
  const popover = p.$("#word-popover");
  let rect = { left: 500, top: 100, bottom: 120 };
  p.layout.rectFor = (node) => (node.classList.contains("tok") ? rect : {});
  p.layout.sizeFor = (node) => (node === popover ? { width: 300, height: 200 } : {});
  await p.cue(cue());
  const token = p.$("#live-text .tok");

  await p.click(token);
  assert.deepEqual([popover.style.left, popover.style.top], ["488px", "126px"]);

  rect = { left: 2000, top: 100, bottom: 120 };
  await p.click(token);
  assert.equal(popover.style.left, `${p.window.innerWidth - 300 - 8}px`);

  rect = { left: 0, top: 100, bottom: 120 };
  await p.click(token);
  assert.equal(popover.style.left, "8px");

  rect = { left: 500, top: 700, bottom: 720 };
  await p.click(token);
  assert.equal(popover.style.top, "494px");

  rect = { left: 500, top: 50, bottom: 720 };
  await p.click(token);
  assert.equal(popover.style.top, "8px");
});

test("popup: after clicking two words in a row, a lookup sent earlier that comes back later does not overwrite the later popup", async (t) => {
  const first = deferred();
  const second = deferred();
  const queue = [first, second];
  const p = await createPanel(t, { routes: { "GET /lookup": () => queue.shift().promise } });
  await p.cue(cue());
  const [one, two] = p.$$("#live-text .tok");
  await p.click(one);
  await p.click(two);
  assert.ok(!one.classList.contains("active"));
  assert.ok(two.classList.contains("active"));

  first.resolve(json({ word: "Hello", ipa: "a", definition: "第一个" }));
  await p.flush();
  assert.equal(p.text("#word-popover strong"), "world");
  assert.equal(p.text("#word-popover .definition"), "查询中…");

  second.resolve(json({ word: "world", ipa: "b", definition: "第二个" }));
  await p.flush();
  assert.equal(p.text("#word-popover .definition"), "第二个");
});

test("popup: closing the popup before the lookup returns means it does not fill the popup in afterwards", async (t) => {
  const pending = deferred();
  const p = await createPanel(t, { routes: { "GET /lookup": () => pending.promise } });
  await p.cue(cue());
  await p.click(p.$("#live-text .tok"));
  await p.press(p.document, "Escape");
  pending.resolve(json({ word: "Hello", definition: "你好" }));
  await p.flush();
  assert.equal(p.hidden("#word-popover"), true);
  assert.equal(p.text("#word-popover .definition"), "查询中…");
});

// ---- phonemes in the popup ----

test("popup phonemes: without a score, gets the phonemes by word and shows them as clickable vowel/consonant chips, and a cache hit does not request again", async (t) => {
  const p = await createPanel(t, {
    routes: { "GET /lookup": lookupRoute(), "GET /phones": json({ phones: ["h", "ə", "l"] }) },
  });
  await p.cue(cue());
  await p.click(p.$("#live-text .tok"));
  const chips = p.$$("#word-popover .chip");
  assert.deepEqual(texts(chips), ["h", "ə", "l"]);
  assert.deepEqual(chips.map((chip) => chip.className), ["chip consonant", "chip vowel", "chip consonant"]);
  assert.equal(p.callsTo("GET /phones")[0].query.get("text"), "Hello");

  await p.click(chips[1]);
  assert.equal(p.sound().url, `${API}/speak?ipa=${encodeURIComponent("ə")}`);

  await p.click(p.$("#live-text .tok"));
  assert.equal(p.$$("#word-popover .chip").length, 3);
  assert.equal(p.callsTo("GET /phones").length, 1);
});

test("popup phonemes: when getting the phonemes fails, is rejected or returns an empty result, no chips are shown", async (t) => {
  const p = await createPanel(t, { routes: { "GET /lookup": lookupRoute() } });
  await p.cue(cue("alpha beta gamma delta"));
  const [alpha, beta, gamma] = p.$$("#live-text .tok");

  await p.click(alpha);
  assert.equal(p.$$("#word-popover .chip").length, 0);

  p.route("GET /phones", json({}, 500));
  await p.click(beta);
  assert.equal(p.$$("#word-popover .chip").length, 0);

  p.route("GET /phones", json({ phones: [] }));
  await p.click(gamma);
  assert.equal(p.$$("#word-popover .chip").length, 0);
});

test("popup phonemes: when the phonemes come back after the popup has changed to another word, they are not shown", async (t) => {
  const pending = deferred();
  const p = await createPanel(t, {
    routes: {
      "GET /lookup": lookupRoute(),
      "GET /phones": (call) => (call.query.get("text") === "Hello" ? pending.promise : json({ phones: ["w"] })),
    },
  });
  await p.cue(cue());
  p.layout.rectFor = (node) => (node.textContent === "Hello" ? { left: 100, bottom: 10 } : node.textContent === "world" ? { left: 300, bottom: 10 } : {});
  const [one, two] = p.$$("#live-text .tok");
  await p.click(one);
  await p.click(two);
  assert.equal(p.$("#word-popover").style.left, "288px");
  pending.resolve(json({ phones: ["h", "ə"] }));
  await p.flush();
  assert.deepEqual(texts(p.$$("#word-popover .chip")), ["w"]);
  assert.equal(p.$("#word-popover").style.left, "288px");
});

test("popup phonemes: a scored word shows the top-and-bottom comparison, with different notes for a correct word and a wrong word", async (t) => {
  const p = await createPanel(t, { cards: [scoredCard()], routes: { "GET /lookup": lookupRoute() } });
  const [bad, good] = p.$$("#card-sentence .tok");

  await p.click(bad);
  assert.equal(p.text("#word-popover .legend"), "上 标准 · 下 你的　红色没读准，点音素听");
  assert.equal(p.$$("#word-popover .pcol").length, 2);
  assert.equal(p.callsTo("GET /phones").length, 0);

  await p.click(good);
  assert.equal(p.text("#word-popover .legend"), "上 标准 · 下 你的　这个词读准了");
  assert.equal(p.$$("#word-popover .pcol").length, 1);

  await p.click(p.$("#word-popover .pcol button"));
  assert.equal(p.sound().url, `${API}/speak?ipa=${encodeURIComponent("ð")}`);
});

// ---- playback ----

test("playback: a new sound first stops the previous one", async (t) => {
  const p = await createPanel(t, { cards: [card({ latest_attempt_id: "a1" })] });
  await p.click("#card-play");
  const first = p.sound();
  assert.equal(first.pauses, 0);
  await p.click("#mine");
  assert.equal(first.pauses, 1);
  assert.equal(p.sound().url, `${API}/attempts/a1/audio`);
  assert.equal(p.sound().plays, 1);
});

test("playback: reference audio for a pasted sentence reads the whole sentence, and a failure is shown under this sentence", async (t) => {
  const p = await createPanel(t, { cards: [card({ text: "Hello there" })] });
  await p.click("#card-play");
  assert.equal(p.sound().url, `${API}/speak?text=Hello%20there`);
  assert.equal(p.text("#read-hint"), "");

  p.sounds.behaviour = () => Promise.reject(new Error("blocked"));
  await p.click("#card-play");
  assert.equal(p.text("#read-hint"), "标准音暂时无法播放");
});

test("playback: reference audio for a YouTube sentence asks to play the original video clip, and the result is shown in the hint", async (t) => {
  const yt = card({ source: "youtube", video_id: "vid3", start_ms: 1000, end_ms: 4000 });
  const p = await createPanel(t, { cards: [yt] });
  p.replies["play-range"] = { ok: true };
  await p.click("#card-play");
  assert.deepEqual(p.messages.find((m) => m.type === "play-range"), { type: "play-range", videoId: "vid3", startMs: 1000, endMs: 4000 });
  assert.equal(p.text("#read-hint"), "");
  assert.equal(p.sounds.instances.length, 0);

  p.replies["play-range"] = { ok: false, error: "视频没打开" };
  await p.click("#card-play");
  assert.equal(p.text("#read-hint"), "视频没打开");

  p.replies["play-range"] = { ok: false };
  await p.click("#card-play");
  assert.equal(p.text("#read-hint"), "打开原来的视频才能听原声");

  p.replies["play-range"] = undefined;
  await p.click("#card-play");
  assert.equal(p.text("#read-hint"), "打开原来的视频才能听原声");
});

test("playback: original audio uses the time of the current caption, and an error is shown under the current sentence", async (t) => {
  const p = await createPanel(t);
  await forceClick(p, "#live-play");
  assert.equal(p.messages.filter((m) => m.type === "play-range").length, 0);

  await p.cue(cue());
  p.replies["play-range"] = { ok: false, error: "视频没打开" };
  await p.click("#live-play");
  assert.deepEqual(p.messages.find((m) => m.type === "play-range"), { type: "play-range", videoId: "vid1", startMs: 5000, endMs: 8000 });
  assert.equal(p.text("#live-hint"), "视频没打开");

  p.replies["play-range"] = { ok: true };
  await p.click("#live-play");
  assert.equal(p.text("#live-hint"), "");
});

test("playback: reference audio does nothing when no sentence is selected", async (t) => {
  const p = await createPanel(t);
  await p.click("#card-play");
  assert.equal(p.sounds.instances.length, 0);
  assert.equal(p.messages.filter((m) => m.type === "play-range").length, 0);
});

test("playback: my recording plays only when there is a recording, and a failed playback does not report an error", async (t) => {
  const p = await createPanel(t, { cards: [card()] });
  await p.click("#mine");
  assert.equal(p.sounds.instances.length, 0);

  p.data.cards = [card({ latest_attempt_id: "a7" })];
  p.server.up = false;
  await p.pollHealth();
  p.server.up = true;
  await p.pollHealth();
  p.sounds.behaviour = () => Promise.reject(new Error("blocked"));
  await p.click("#mine");
  assert.equal(p.sound().url, `${API}/attempts/a7/audio`);
  assert.equal(p.text("#read-hint"), "");

  const q = await createPanel(t);
  await q.click("#mine");
  assert.equal(q.sounds.instances.length, 0);
});

// ---- editing and autosave ----

test("editing: clicking edit shows the text box and focuses it, the button becomes done, and clicking again returns to the sentence", async (t) => {
  const p = await createPanel(t, { cards: [card()] });
  const textarea = p.$("#card-text");
  p.layout.sizeFor = (node) => (node === textarea ? { scrollHeight: 84 } : {});
  await p.click("#edit");
  assert.equal(textarea.hidden, false);
  assert.equal(p.hidden("#card-sentence"), true);
  assert.equal(p.text("#edit"), "完成");
  assert.equal(textarea.value, "Hello there world.");
  assert.equal(textarea.style.height, "84px");
  assert.equal(p.document.activeElement, textarea);

  await p.click("#edit");
  assert.equal(textarea.hidden, true);
  assert.equal(p.hidden("#card-sentence"), false);
  assert.equal(p.text("#edit"), "编辑");
});

test("editing: clicking edit closes an open popup", async (t) => {
  const p = await createPanel(t, { cards: [card()], routes: { "GET /lookup": lookupRoute() } });
  await p.click(p.$("#card-sentence .tok"));
  await p.click("#edit");
  assert.equal(p.hidden("#word-popover"), true);
});

test("editing: clicking edit with no sentence shows no text box", async (t) => {
  const p = await createPanel(t);
  await p.click("#edit");
  assert.equal(p.hidden("#card-text"), true);
  assert.equal(p.hidden("#card-sentence"), false);
});

test("autosave: 400 milliseconds after typing stops, saves the trimmed new text and refreshes, and repeated typing keeps only the last one", async (t) => {
  const p = await createPanel(t, {
    cards: [card()],
    routes: {
      "PATCH /cards/c1": (call) => {
        p.data.cards = [card({ text: call.body.text })];
        return json({ ok: true });
      },
    },
  });
  await p.click("#edit");
  await p.type("#card-text", "Hello");
  await p.type("#card-text", "  Hello again  ");
  assert.equal(p.pendingTimeouts().length, 1);
  assert.equal(p.pendingTimeouts()[0].ms, 400);
  assert.equal(p.callsTo("PATCH /cards/c1").length, 0);

  await p.runTimeouts();
  const [patch] = p.callsTo("PATCH /cards/c1");
  assert.deepEqual(patch.body, { text: "Hello again" });
  assert.equal(patch.headers["Content-Type"], "application/json");
  assert.equal(p.text("#list li"), "Hello again");

  await p.click("#edit");
  assert.equal(p.text("#card-sentence"), "Hello again");
});

test("autosave: does not save when the text is empty or unchanged, and typing clears the old hint", async (t) => {
  const p = await createPanel(t, { cards: [card()] });
  await p.click("#edit");
  await p.type("#card-text", "   ");
  await p.runTimeouts();
  await p.type("#card-text", " Hello there world. ");
  await p.runTimeouts();
  assert.equal(p.callsTo("PATCH /cards/c1").length, 0);
});

test("autosave: typing first clears the previous hint", async (t) => {
  const p = await createPanel(t, { cards: [card()], routes: { "POST /cards": json({ error: "已经有了" }, 409) } });
  p.$("#paste").value = "Dup";
  await p.click("#add");
  assert.equal(p.text("#read-hint"), "已经有了");
  await p.click("#edit");
  await p.type("#card-text", "Hello");
  assert.equal(p.text("#read-hint"), "");
});

test("autosave: typing with no sentence selected does not schedule a save", async (t) => {
  const p = await createPanel(t);
  await p.type("#card-text", "Hello");
  assert.equal(p.pendingTimeouts().length, 0);
});

test("editing: while editing, a background refresh does not overwrite what is being typed in the text box", async (t) => {
  const p = await createPanel(t, { cards: [card()] });
  await p.click("#edit");
  await p.type("#card-text", "Half typed");
  await p.pollHealth();
  assert.equal(p.$("#card-text").value, "Half typed");
  assert.equal(p.text("#read"), "朗读");
});

test("editing: after a scored sentence is changed the read button goes back to read", async (t) => {
  const p = await createPanel(t, { cards: [scoredCard()] });
  assert.equal(p.text("#read"), "再读一次");
  await p.click("#edit");
  await p.type("#card-text", "Different");
  assert.equal(p.text("#read"), "朗读");
});

// ---- tabs and the word list ----

test("tabs: switching to words hides the picked list and the paste box and refreshes the words; switching back restores them", async (t) => {
  const p = await createPanel(t);
  p.data.words = [word()];
  await p.click("#words-tab");
  assert.equal(p.hidden("#list"), true);
  assert.equal(p.hidden("#word-list"), false);
  assert.equal(p.hidden("#paste"), true);
  assert.equal(p.hidden("#add"), true);
  assert.ok(p.$("#words-tab").classList.contains("active"));
  assert.ok(!p.$("#cards-tab").classList.contains("active"));
  assert.equal(p.$$("#word-list li.word-item").length, 1);

  await p.click("#cards-tab");
  assert.equal(p.hidden("#list"), false);
  assert.equal(p.hidden("#word-list"), true);
  assert.equal(p.hidden("#paste"), false);
  assert.ok(p.$("#cards-tab").classList.contains("active"));
});

test("word list: with no words it shows the empty state", async (t) => {
  const p = await createPanel(t);
  assert.equal(p.text("#word-list li.empty"), "还没有生词。点句子里的词，就能收藏。");
});

test("word list: each row shows the word, the phonetic, the first line of the definition and the badge of the last read-aloud score", async (t) => {
  const p = await createPanel(t, {
    words: [
      word({ id: "a", word: "alpha", score: { match_count: 3, expected_count: 3 } }),
      word({ id: "b", word: "beta", ipa: "[bɛtə]", definition: "第一行\n第二行", score: { match_count: 1, expected_count: 4 } }),
      word({ id: "c", word: "gamma", ipa: null, definition: null }),
      word({ id: "d", word: "delta", ipa: null, definition: "" }),
    ],
  });
  const rows = p.$$("#word-list li.word-item");
  assert.equal(rows.length, 4);
  assert.equal(rows[0].querySelector(".ipa").textContent, "/həˈləʊ/");
  assert.equal(rows[0].querySelector(".word-def").textContent, "你好");
  assert.equal(rows[1].querySelector(".ipa").textContent, "[bɛtə]");
  assert.equal(rows[1].querySelector(".word-def").textContent, "第一行");
  assert.equal(rows[0].querySelector(".badge").textContent, "3/3");
  assert.ok(rows[0].querySelector(".badge").classList.contains("good"));
  assert.equal(rows[1].querySelector(".badge").textContent, "1/4");
  assert.ok(rows[1].querySelector(".badge").classList.contains("bad"));
  assert.equal(rows[2].querySelector(".badge"), null);
  assert.equal(rows[2].querySelector(".ipa"), null);
  assert.equal(rows[2].querySelector(".word-def"), null);
  assert.equal(rows[3].querySelector(".word-def"), null);
  assert.equal(rows[0].title, "打开这个词");
});

test("word list: clicking the speaker in a row only reads aloud and does not open the detail; clicking the row itself opens the detail", async (t) => {
  const p = await createPanel(t, { words: [word({ id: "a", word: "alpha" })] });
  await p.click("#word-list .icon-button");
  assert.equal(p.sound().url, `${API}/speak?text=alpha`);
  assert.equal(p.hidden("#word-view"), true);
  await p.click("#word-list li.word-item");
  assert.equal(p.hidden("#word-view"), false);
  assert.equal(p.text("#wv-word"), "alpha");
});

test("word list: when reading aloud fails, the hint goes into the open word detail, and onto this sentence when no detail is open", async (t) => {
  const p = await createPanel(t, { words: [word({ id: "a", word: "alpha" })] });
  p.sounds.behaviour = () => Promise.reject(new Error("blocked"));
  await p.click("#word-list .icon-button");
  assert.equal(p.text("#read-hint"), "标准音暂时无法播放");
  assert.equal(p.text("#wv-hint"), "");
});

// ---- word detail ----

test("word detail: shows the word, the phonetic and the definition, splits out the phonemes, and hides the source and recording that are missing", async (t) => {
  const p = await createPanel(t, {
    words: [word({ id: "a", word: "alpha" })],
    routes: { "GET /phones": json({ phones: ["æ", "l"] }) },
  });
  await p.click("#word-list li.word-item");
  assert.equal(p.hidden("#main"), true);
  assert.equal(p.text("#wv-word"), "alpha");
  assert.equal(p.text("#wv-ipa"), "/həˈləʊ/");
  assert.equal(p.text("#wv-def"), "你好\n第二行");
  assert.deepEqual(texts(p.$$("#wv-phones .chip")), ["æ", "l"]);
  assert.equal(p.hidden("#wv-mine"), true);
  assert.equal(p.hidden("#wv-actions"), true);
  assert.equal(p.hidden("#wv-source"), true);
  assert.equal(p.hidden("#wv-source-play"), true);
  assert.equal(p.text("#wv-read"), "跟读");
  assert.equal(p.text("#wv-hint"), "");
});

test("word detail: leaves the phonetic and definition empty when there are none", async (t) => {
  const p = await createPanel(t, { words: [word({ ipa: null, definition: null })] });
  await p.click("#word-list li.word-item");
  assert.equal(p.text("#wv-ipa"), "");
  assert.equal(p.text("#wv-def"), "");
});

test("word detail: with a source sentence and a video time, shows the source and the play-original-sentence button", async (t) => {
  const p = await createPanel(t, {
    words: [word({ source_sentence: "Say hello.", video_id: "vid5", start_ms: 0, end_ms: 900, latest_attempt_id: "a2" })],
  });
  await p.click("#word-list li.word-item");
  assert.equal(p.hidden("#wv-source"), false);
  assert.equal(p.text("#wv-sentence"), "Say hello.");
  assert.equal(p.hidden("#wv-source-play"), false);
  assert.equal(p.hidden("#wv-mine"), false);
  assert.equal(p.hidden("#wv-actions"), false);
});

test("word detail: when the source lacks the video or the start time, does not show play original sentence", async (t) => {
  const p = await createPanel(t, { words: [word({ source_sentence: "Say hello.", video_id: "vid5", start_ms: null })] });
  await p.click("#word-list li.word-item");
  assert.equal(p.hidden("#wv-source-play"), true);

  const q = await createPanel(t, { words: [word({ source_sentence: "Say hello.", video_id: null, start_ms: 100 })] });
  await q.click("#word-list li.word-item");
  assert.equal(q.hidden("#wv-source-play"), true);
});

test("word detail: when the phonemes cannot be fetched, says so and retries on the next render", async (t) => {
  const p = await createPanel(t, { words: [word({ id: "a", word: "alpha" })] });
  await p.click("#word-list li.word-item");
  assert.equal(p.text("#wv-phones"), "暂时拿不到音素，本机程序开了吗？");
  assert.equal(p.callsTo("GET /phones").length, 1);

  p.route("GET /phones", json({ phones: ["æ"] }));
  await p.pollHealth();
  assert.deepEqual(texts(p.$$("#wv-phones .chip")), ["æ"]);
  assert.equal(p.callsTo("GET /phones").length, 2);

  await p.pollHealth();
  assert.equal(p.callsTo("GET /phones").length, 2);
});

test("word detail: an empty phoneme array also says they cannot be fetched", async (t) => {
  const p = await createPanel(t, { words: [word()], routes: { "GET /phones": json({ phones: [] }) } });
  await p.click("#word-list li.word-item");
  assert.equal(p.text("#wv-phones"), "暂时拿不到音素，本机程序开了吗？");
});

test("word detail: when the phonemes come back after the detail was closed, they are not written", async (t) => {
  const pending = deferred();
  const p = await createPanel(t, { words: [word()], routes: { "GET /phones": () => pending.promise } });
  await p.click("#word-list li.word-item");
  assert.equal(p.text("#wv-phones"), "正在拆音素…");
  await p.click("#word-back");
  pending.resolve(json({ phones: ["h"] }));
  await p.flush();
  assert.equal(p.text("#wv-phones"), "正在拆音素…");
});

test("word detail: going back to the notebook switches to the words tab and shows the main interface", async (t) => {
  const p = await createPanel(t, { words: [word()] });
  await p.click("#word-list li.word-item");
  await p.click("#word-back");
  assert.equal(p.hidden("#word-view"), true);
  assert.equal(p.hidden("#main"), false);
  assert.ok(p.$("#words-tab").classList.contains("active"));
  assert.equal(p.hidden("#word-list"), false);
});

test("word detail: scoring uses the comparison table, not a per-word summary", async (t) => {
  const scored = word({
    score: {
      match_count: 1,
      expected_count: 2,
      columns: [
        { expected: ph("h"), heard: ph("h"), status: "match" },
        { expected: ph("ə"), heard: ph("ɛ", true), status: "sub" },
      ],
      words: [{ bad: true, first_column: 0, column_count: 2 }],
    },
  });
  const p = await createPanel(t, { words: [scored] });
  await p.click("#word-list li.word-item");
  assert.equal(p.text("#wv-score .ratio"), "1/2");
  assert.equal(p.text("#wv-score .legend"), "上 标准 · 下 你的");
  assert.equal(p.$$("#wv-score .pcol").length, 2);
  assert.equal(p.text("#wv-read"), "再读一次");
});

test("word detail: clicking a phoneme cell plays the phoneme, and a failure is shown in the word detail", async (t) => {
  const scored = word({
    score: { match_count: 1, expected_count: 1, expected: [ph("h")], heard: [ph("h")] },
  });
  const p = await createPanel(t, { words: [scored] });
  await p.click("#word-list li.word-item");
  p.sounds.behaviour = () => Promise.reject(new Error("blocked"));
  await p.click("#wv-score .pcol button");
  assert.equal(p.text("#wv-hint"), "暂时无法播放音素 h");
  assert.equal(p.text("#read-hint"), "");
});

test("word detail: the speaker reads the word aloud, a failure is shown in the detail; my recording plays the last recording", async (t) => {
  const p = await createPanel(t, { words: [word({ word: "alpha", latest_attempt_id: "a9" })] });
  await p.click("#word-list li.word-item");
  await p.click("#wv-play");
  assert.equal(p.sound().url, `${API}/speak?text=alpha`);
  p.sounds.behaviour = () => Promise.reject(new Error("blocked"));
  await p.click("#wv-play");
  assert.equal(p.text("#wv-hint"), "标准音暂时无法播放");

  await p.click("#wv-mine");
  assert.equal(p.sound().url, `${API}/attempts/a9/audio`);
});

test("word detail: with no word open, the speaker, my recording, the original sentence and delete all do nothing", async (t) => {
  const p = await createPanel(t, { words: [word({ latest_attempt_id: "a9" })] });
  await p.click("#wv-play");
  await p.click("#wv-mine");
  await p.click("#wv-source-play");
  await p.click("#word-delete");
  assert.equal(p.sounds.instances.length, 0);
  assert.equal(p.messages.filter((m) => m.type === "play-range").length, 0);
  assert.equal(p.callsTo("DELETE /words/w1").length, 0);
});

test("word detail: my recording does not play when there is no recording, and a failure does not report an error", async (t) => {
  const p = await createPanel(t, { words: [word()] });
  await p.click("#word-list li.word-item");
  await p.click("#wv-mine");
  assert.equal(p.sounds.instances.length, 0);

  p.data.words = [word({ latest_attempt_id: "a3" })];
  p.server.up = false;
  await p.pollHealth();
  p.server.up = true;
  await p.pollHealth();
  p.sounds.behaviour = () => Promise.reject(new Error("blocked"));
  await p.click("#wv-mine");
  assert.equal(p.sound().url, `${API}/attempts/a3/audio`);
});

test("word detail: play original sentence asks to play the video clip, and the hint is shown in the detail", async (t) => {
  const p = await createPanel(t, {
    words: [word({ source_sentence: "Say hi", video_id: "vid5", start_ms: 100, end_ms: 900 })],
  });
  await p.click("#word-list li.word-item");
  p.replies["play-range"] = { ok: false, error: "视频没打开" };
  await p.click("#wv-source-play");
  assert.deepEqual(p.messages.find((m) => m.type === "play-range"), { type: "play-range", videoId: "vid5", startMs: 100, endMs: 900 });
  assert.equal(p.text("#wv-hint"), "视频没打开");
  p.replies["play-range"] = { ok: true };
  await p.click("#wv-source-play");
  assert.equal(p.text("#wv-hint"), "");
});

test("word detail: delete requests the deletion, goes back to the notebook and refreshes the list", async (t) => {
  const p = await createPanel(t, {
    words: [word()],
    routes: {
      "DELETE /words/w1": () => {
        p.data.words = [];
        return json({ ok: true });
      },
    },
  });
  await p.click("#word-list li.word-item");
  await p.click("#word-delete");
  assert.equal(p.callsTo("DELETE /words/w1").length, 1);
  assert.equal(p.hidden("#word-view"), true);
  assert.equal(p.hidden("#main"), false);
  assert.equal(p.$$("#word-list li.empty").length, 1);
});

test("word detail: when the local program is off during delete, it still goes back to the notebook", async (t) => {
  const p = await createPanel(t, { words: [word()] });
  await p.click("#word-list li.word-item");
  await p.click("#word-delete");
  assert.equal(p.hidden("#word-view"), true);
  assert.equal(p.hidden("#main"), false);
  assert.equal(p.$$("#word-list li.word-item").length, 1);
});

test("word detail: a refresh failure after delete does not throw", async (t) => {
  const p = await createPanel(t, { words: [word()], routes: { "DELETE /words/w1": json({}) } });
  await p.click("#word-list li.word-item");
  p.route("GET /words", () => {
    throw networkError();
  });
  await p.click("#word-delete");
  assert.equal(p.hidden("#word-view"), true);
});

test("word detail: when the open word is deleted on the server, the next refresh goes back to the notebook automatically", async (t) => {
  const p = await createPanel(t, { words: [word()] });
  await p.click("#word-list li.word-item");
  p.data.words = [];
  p.server.up = false;
  await p.pollHealth();
  p.server.up = true;
  await p.pollHealth();
  assert.equal(p.hidden("#word-view"), true);
  assert.equal(p.hidden("#main"), false);
  assert.equal(p.$$("#word-list li.empty").length, 1);
});

test("word detail: after saving from the sentence popup and clicking saved again, opens the detail and closes the popup", async (t) => {
  const p = await createPanel(t, {
    routes: {
      "GET /lookup": lookupRoute(),
      "POST /words": (call) => {
        p.data.words.push(word({ id: "w3", word: call.body.word.toLowerCase() }));
        return json({}, 201);
      },
    },
  });
  await p.cue(cue());
  await p.click(p.$("#live-text .tok"));
  await p.click("#word-popover .secondary");
  assert.equal(p.text("#word-popover .secondary"), "已收藏 · 查看");
  await p.click("#word-popover .secondary");
  assert.equal(p.text("#wv-word"), "hello");
  assert.equal(p.hidden("#word-popover"), true);
});

// ---- microphone and recording ----

test("recording permission: when already allowed, starts recording at once and the read button becomes stop", async (t) => {
  const p = await createPanel(t, { cards: [card()] });
  await p.click("#read");
  assert.equal(p.text("#read"), "停止");
  assert.ok(p.$("#read").classList.contains("recording"));
  assert.deepEqual(p.mic.requests, [{ audio: true }]);
  assert.deepEqual(p.graph.modules, [`chrome-extension://${EXTENSION_ID}/recorder-worklet.js`]);
  assert.equal(p.graph.nodes[0].name, "soundkey-recorder");
  assert.deepEqual(p.graph.nodes[0].options, { numberOfOutputs: 0 });
  assert.equal(p.graph.contexts[0].sources[0].connected, p.graph.nodes[0]);
  assert.equal(p.tabsCreated.length, 0);
});

test("recording permission: when it needs asking, opens the microphone page, checks again after that tab is closed, and keeps recording if it passes", async (t) => {
  const p = await createPanel(t, { cards: [card()], mic: { state: "prompt" } });
  p.$("#read").click();
  await p.flush();
  assert.deepEqual(p.tabsCreated, [{ url: `chrome-extension://${EXTENSION_ID}/mic.html`, active: true }]);
  assert.equal(p.removedListeners.length, 1);
  assert.equal(p.graph.contexts.length, 0);

  p.closeTab(9999);
  await p.flush();
  assert.equal(p.removedListeners.length, 1);
  assert.equal(p.graph.contexts.length, 0);

  p.mic.state = "granted";
  p.closeTab(100);
  await p.flush();
  assert.equal(p.removedListeners.length, 0);
  assert.equal(p.graph.contexts.length, 1);
  assert.equal(p.text("#read"), "停止");
});

test("recording permission: when still not allowed after the microphone page closes, says permission is needed and shows the allow button", async (t) => {
  const p = await createPanel(t, { cards: [card()], mic: { state: "prompt" } });
  p.$("#read").click();
  await p.flush();
  p.closeTab(100);
  await p.flush();
  assert.equal(p.text("#read-hint"), MIC_PROMPT);
  assert.equal(p.hidden("#allow-mic"), false);
  assert.equal(p.graph.contexts.length, 0);
});

test("recording permission: when the tab cannot be opened (no tab id), decides at once that it was not allowed", async (t) => {
  const p = await createPanel(t, { cards: [card()], mic: { state: "prompt" } });
  p.tabs.factory = () => undefined;
  await p.click("#read");
  assert.equal(p.text("#read-hint"), MIC_PROMPT);
  assert.equal(p.removedListeners.length, 0);

  p.tabs.factory = () => ({});
  await p.click("#read");
  assert.equal(p.text("#read-hint"), MIC_PROMPT);
});

test("recording permission: when denied, opens the browser's site settings page and says permission is needed", async (t) => {
  const p = await createPanel(t, { cards: [card()], mic: { state: "denied" } });
  await p.click("#read");
  assert.equal(p.tabsCreated.length, 1);
  assert.equal(
    p.tabsCreated[0].url,
    `chrome://settings/content/siteDetails?site=${encodeURIComponent(`chrome-extension://${EXTENSION_ID}/`)}`,
  );
  assert.equal(p.text("#read-hint"), MIC_PROMPT);
  assert.equal(p.graph.contexts.length, 0);
});

test("recording permission: when the permission query itself fails, treats it as needing to ask", async (t) => {
  const p = await createPanel(t, { cards: [card()], mic: { queryError: new Error("unsupported") } });
  p.tabs.factory = () => undefined;
  await p.click("#read");
  assert.equal(p.tabsCreated.length, 1);
  assert.equal(p.tabsCreated[0].url, `chrome-extension://${EXTENSION_ID}/mic.html`);
  assert.equal(p.text("#read-hint"), MIC_PROMPT);
});

test("recording permission: the allow-microphone button keeps recording after a grant, and keeps the hint when nothing was granted", async (t) => {
  const p = await createPanel(t, { cards: [card()], mic: { state: "denied" } });
  await p.click("#read");
  assert.equal(p.hidden("#allow-mic"), false);

  await p.click("#allow-mic");
  assert.equal(p.text("#read-hint"), MIC_PROMPT);
  assert.equal(p.graph.contexts.length, 0);

  p.mic.state = "granted";
  await p.click("#allow-mic");
  assert.equal(p.graph.contexts.length, 1);
  assert.equal(p.text("#read"), "停止");
  assert.equal(p.hidden("#allow-mic"), true);
});

test("recording permission: clicking allow microphone while it is already asking does not ask twice", async (t) => {
  const p = await createPanel(t, { cards: [card()], mic: { state: "prompt" } });
  await p.click("#allow-mic");
  assert.equal(p.tabsCreated.length, 1);
  await p.click("#allow-mic");
  assert.equal(p.tabsCreated.length, 1);
  assert.equal(p.text("#read-hint"), MIC_PROMPT);

  p.closeTab(100);
  await p.flush();
  p.mic.state = "granted";
  await p.click("#allow-mic");
  assert.equal(p.graph.contexts.length, 1);
});

test("recording failure: when no microphone stream can be obtained, says permission is needed and creates no audio context", async (t) => {
  const p = await createPanel(t, { cards: [card()], mic: { streamError: new Error("NotAllowed") } });
  await p.click("#read");
  assert.equal(p.text("#read-hint"), MIC_PROMPT);
  assert.equal(p.graph.contexts.length, 0);
  assert.equal(p.text("#read"), "朗读");
});

test("recording failure: when the recorder component cannot be loaded, releases the microphone and the audio context and says so", async (t) => {
  const p = await createPanel(t, { cards: [card()] });
  p.graph.moduleError = new Error("no module");
  await p.click("#read");
  assert.equal(p.text("#read-hint"), "录音组件没有加载出来");
  assert.equal(p.mic.streams[0].stopped, 2);
  assert.equal(p.graph.contexts[0].closed, true);
  assert.equal(p.text("#read"), "朗读");

  p.graph.moduleError = null;
  p.graph.nodeError = new Error("no node");
  await p.click("#read");
  assert.equal(p.text("#read-hint"), "录音组件没有加载出来");
  assert.equal(p.mic.streams[1].stopped, 2);
  assert.equal(p.graph.contexts[1].closed, true);

  p.graph.nodeError = null;
  p.graph.sourceError = new Error("no source");
  await p.click("#read");
  assert.equal(p.text("#read-hint"), "录音组件没有加载出来");
});

test("recording: on start, clears the earlier hint, and the read button is disabled and does not record when no sentence is selected or not connected", async (t) => {
  const p = await createPanel(t);
  assert.equal(p.$("#read").disabled, true);
  await forceClick(p, "#read");
  assert.equal(p.mic.queries.length, 0);

  const q = await createPanel(t, { cards: [card()], server: { up: false } });
  assert.equal(q.$("#read").disabled, true);
});

test("recording: after stopping, uploads a WAV resampled to 16k, shows listening while uploading, and refreshes the sentence on success", async (t) => {
  const upload = deferred();
  const p = await createPanel(t, {
    cards: [card()],
    routes: { "POST /cards/c1/attempts": () => upload.promise },
  });
  await p.click("#read");
  p.push(new Array(480).fill(0.5));
  p.push(new Array(480).fill(-0.5));
  await p.click("#read");

  const context = p.graph.contexts[0];
  const node = p.graph.nodes[0];
  assert.equal(context.sources[0].disconnected, true);
  assert.equal(node.port.closed, true);
  assert.equal(p.mic.streams[0].stopped, 2);
  assert.equal(context.closed, true);
  assert.equal(p.text("#read"), "正在听");
  assert.equal(p.$("#read").disabled, true);
  assert.ok(!p.$("#read").classList.contains("recording"));

  p.data.cards = [card({ latest_attempt_id: "a1" })];
  upload.resolve(json({ ok: true }));
  await p.flush();
  const [post] = p.callsTo("POST /cards/c1/attempts");
  assert.equal(post.headers["Content-Type"], "audio/wav");
  assert.equal(post.body.byteLength, 44 + 320 * 2);
  assert.equal(String.fromCharCode(...new Uint8Array(post.body, 0, 4)), "RIFF");
  assert.equal(new DataView(post.body).getUint32(24, true), 16000);
  assert.equal(p.text("#read"), "朗读");
  assert.equal(p.hidden("#mine"), false);
  assert.equal(p.text("#read-hint"), "");
});

test("recording: clicking the read button again while uploading is ignored", async (t) => {
  const upload = deferred();
  const p = await createPanel(t, { cards: [card()], routes: { "POST /cards/c1/attempts": () => upload.promise } });
  await p.click("#read");
  await p.click("#read");
  assert.equal(p.text("#read"), "正在听");
  await forceClick(p, "#read");
  assert.equal(p.graph.contexts.length, 1);
  assert.equal(p.callsTo("POST /cards/c1/attempts").length, 1);
  upload.resolve(json({ ok: true }));
  await p.flush();
  assert.equal(p.mic.streams.length, 1);
});

test("recording: when the local program returns an error it shows its explanation, or a default message when there is none", async (t) => {
  const p = await createPanel(t, { cards: [card()], routes: { "POST /cards/c1/attempts": json({ error: "声音太短" }, 422) } });
  await p.click("#read");
  await p.click("#read");
  assert.equal(p.text("#read-hint"), "声音太短");
  assert.equal(p.text("#read"), "朗读");

  p.route("POST /cards/c1/attempts", json({}, 500));
  await p.click("#read");
  await p.click("#read");
  assert.equal(p.text("#read-hint"), "没有评出来");
});

test("recording: when the local program is off during upload, says it is off and restores the read button", async (t) => {
  const p = await createPanel(t, { cards: [card()] });
  await p.click("#read");
  await p.click("#read");
  assert.equal(p.text("#read-hint"), "本机程序没开");
  assert.equal(p.text("#read"), "朗读");
  assert.equal(p.$("#read").disabled, false);
});

test("recording: it also recovers when refreshing the sentence fails after the upload", async (t) => {
  const p = await createPanel(t, { cards: [card()], routes: { "POST /cards/c1/attempts": json({ ok: true }) } });
  await p.click("#read");
  p.route("GET /cards", () => {
    throw networkError();
  });
  await p.click("#read");
  assert.equal(p.text("#read"), "朗读");
});

test("recording: a word's read-aloud uploads to the word's endpoint, refreshes the words afterwards, and the error hint is in the detail", async (t) => {
  const p = await createPanel(t, {
    words: [word()],
    routes: { "POST /words/w1/attempts": json({ error: "声音太短" }, 422) },
  });
  await p.click("#word-list li.word-item");
  await p.click("#wv-read");
  assert.equal(p.text("#wv-read"), "停止");
  assert.ok(p.$("#wv-read").classList.contains("recording"));
  assert.equal(p.callsTo("POST /words/w1/attempts").length, 0);
  p.push([0.1, 0.2]);
  const wordFetches = p.callsTo("GET /words").length;
  await p.click("#wv-read");
  assert.equal(p.callsTo("POST /words/w1/attempts").length, 1);
  assert.equal(p.callsTo("GET /words").length, wordFetches + 1);
  assert.equal(p.text("#wv-hint"), "声音太短");
  assert.equal(p.text("#wv-read"), "跟读");
});

test("recording: it also recovers when refreshing the words fails after the upload", async (t) => {
  const p = await createPanel(t, { words: [word()], routes: { "POST /words/w1/attempts": json({ ok: true }) } });
  await p.click("#word-list li.word-item");
  await p.click("#wv-read");
  p.route("GET /words", () => {
    throw networkError();
  });
  await p.click("#wv-read");
  assert.equal(p.text("#wv-read"), "跟读");
  assert.equal(p.text("#wv-hint"), "");
});

test("recording: after a word recording succeeds, updates the score and the text of the read-aloud button", async (t) => {
  const p = await createPanel(t, { words: [word()], routes: { "POST /words/w1/attempts": json({ ok: true }) } });
  await p.click("#word-list li.word-item");
  await p.click("#wv-read");
  p.data.words = [word({ score: { match_count: 2, expected_count: 2, expected: [ph("h")], heard: [ph("h")] }, latest_attempt_id: "a5" })];
  await p.click("#wv-read");
  assert.equal(p.text("#wv-read"), "再读一次");
  assert.equal(p.hidden("#wv-mine"), false);
  assert.equal(p.text("#wv-score .ratio"), "2/2");
});

test("recording: while a card is recording, the word's read button is disabled, and clicking it does not stop the card's recording", async (t) => {
  const p = await createPanel(t, { cards: [card()], words: [word()] });
  await p.click("#read");
  await p.click("#word-list li.word-item");
  assert.equal(p.$("#wv-read").disabled, true);
  assert.equal(p.text("#wv-read"), "跟读");
  assert.ok(!p.$("#wv-read").classList.contains("recording"));

  await forceClick(p, "#wv-read");
  assert.equal(p.text("#read"), "停止");
  assert.equal(p.graph.contexts[0].closed, false);
});

test("recording: while a word is recording, the card's read button is disabled", async (t) => {
  const p = await createPanel(t, { cards: [card()], words: [word()] });
  await p.click("#word-list li.word-item");
  await p.click("#wv-read");
  await p.click("#word-back");
  assert.equal(p.$("#read").disabled, true);
  assert.ok(!p.$("#read").classList.contains("recording"));
  await forceClick(p, "#read");
  assert.equal(p.graph.contexts[0].closed, false);
});

test("recording: clicking read aloud when no word detail is open does not record", async (t) => {
  const p = await createPanel(t, { words: [word()] });
  await p.click("#wv-read");
  assert.equal(p.mic.queries.length, 0);
});

test("recording: a word's permission failure hint lands in the word detail", async (t) => {
  const p = await createPanel(t, { words: [word()], mic: { streamError: new Error("NotAllowed") } });
  await p.click("#word-list li.word-item");
  await p.click("#wv-read");
  assert.equal(p.text("#wv-hint"), MIC_PROMPT);
});

test("recording: where the hint goes when a word recording starts: when permission is denied it opens the settings page", async (t) => {
  const p = await createPanel(t, { words: [word()], mic: { state: "denied" } });
  await p.click("#word-list li.word-item");
  await p.click("#wv-read");
  assert.equal(p.tabsCreated.length, 1);
  assert.equal(p.text("#wv-hint"), MIC_PROMPT);
});
