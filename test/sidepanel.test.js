const test = require("node:test");
const assert = require("node:assert/strict");
const { createPanel, json, deferred, networkError, card, word, ph, EXTENSION_ID } = require("./helpers/panel.js");

const API = "http://127.0.0.1:17321";
const MIC_PROMPT = "需要麦克风权限";

const cue = (text = "Hello world", extra = {}) => ({ videoId: "vid1", startMs: 5000, endMs: 8000, text, ...extra });

const lookupRoute = (overrides = {}) => (call) =>
  json({ word: call.query.get("word"), ipa: "həˈləʊ", definition: "你好", ...overrides });

// "Hello there world." 的三个词：第一个没读准。
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

// 点按钮：jsdom 里被 disabled 的按钮点不动，守卫分支要先放开它。
async function forceClick(p, selector) {
  p.$(selector).disabled = false;
  await p.click(selector);
}

// ---- 状态轮询 ----

test("启动：本机程序在线时显示已连接，并拉取已摘句子和生词", async (t) => {
  const p = await createPanel(t, { cards: [card()], words: [word()] });
  assert.equal(p.text("#status-text"), "本机已连接");
  assert.ok(p.$("#dot").classList.contains("on"));
  assert.equal(p.$$("#list li").length, 1);
  assert.equal(p.$$("#word-list li").length, 1);
});

test("启动：本机程序没开时显示没开，不能加入，也拿不到数据", async (t) => {
  const p = await createPanel(t, { server: { up: false }, cards: [card()] });
  assert.equal(p.text("#status-text"), "本机程序没开");
  assert.ok(!p.$("#dot").classList.contains("on"));
  assert.equal(p.$("#add").disabled, true);
  assert.equal(p.$$("#list li.empty").length, 1);
});

test("健康轮询：从断开到连接会重新拉取句子和生词，连接状态不变时不重复拉取", async (t) => {
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

test("健康轮询：连接中途断开会显示没开，健康检查返回非 2xx 也算没连上", async (t) => {
  const p = await createPanel(t);
  p.server.up = false;
  await p.pollHealth();
  assert.equal(p.text("#status-text"), "本机程序没开");
  assert.ok(!p.$("#dot").classList.contains("on"));

  p.route("GET /health", json({}, 503));
  await p.pollHealth();
  assert.equal(p.text("#status-text"), "本机程序没开");
});

test("拉取失败：句子和生词列表拉不到时不抛错，界面保持原样", async (t) => {
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

// ---- 当前句：字幕轮询 ----

test("字幕轮询：没有视频时只显示提示，按钮都不可用", async (t) => {
  const p = await createPanel(t);
  await p.pollCue();
  assert.equal(p.$("#live-text").dataset.placeholder, "打开一个 YouTube 视频");
  assert.equal(p.text("#live-meta"), "");
  assert.equal(p.$("#clip").disabled, true);
  assert.equal(p.$("#live-play").disabled, true);
  assert.equal(p.hidden("#adjust"), true);
  assert.equal(p.$$("#live-text .tok").length, 0);
});

test("字幕轮询：有视频但这一句没有字幕时提示没有字幕，仍可以听原声", async (t) => {
  const p = await createPanel(t);
  await p.cue(cue(""), "no-caption");
  assert.equal(p.$("#live-text").dataset.placeholder, "这一句没有字幕");
  assert.equal(p.text("#live-meta"), "0:05");
  assert.equal(p.$("#clip").disabled, true);
  assert.equal(p.$("#live-play").disabled, false);
  assert.equal(p.hidden("#adjust"), false);
  assert.equal(p.$$("#live-text .tok").length, 0);
});

test("字幕轮询：有字幕时清理标记后按词渲染，并显示开始时间", async (t) => {
  const p = await createPanel(t);
  await p.cue(cue(">> Hello [Music]  big, world", { startMs: 3_661_000 }));
  assert.deepEqual(texts(p.$$("#live-text .tok")), ["Hello", "big", "world"]);
  assert.equal(p.$("#live-text").textContent, "Hello big, world");
  assert.equal(p.text("#live-meta"), "1:01:01");
  assert.equal(p.$("#clip").disabled, false);
  assert.equal(p.$("#live-play").disabled, false);
});

test("字幕轮询：开始时间不足一小时显示分秒，负数按零算", async (t) => {
  const p = await createPanel(t);
  await p.cue(cue("Hi", { startMs: 65_000 }));
  assert.equal(p.text("#live-meta"), "1:05");
  await p.cue(cue("Hi", { startMs: -4000 }));
  assert.equal(p.text("#live-meta"), "0:00");
});

test("字幕轮询：返回空消息时当作没有视频", async (t) => {
  const p = await createPanel(t);
  p.replies["get-cue"] = undefined;
  await p.pollCue();
  assert.equal(p.$("#live-text").dataset.placeholder, "打开一个 YouTube 视频");
  assert.equal(p.$("#clip").disabled, true);
});

test("字幕轮询：字幕没变就不重画句子，任何一项变了才重画", async (t) => {
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

test("字幕轮询：取字幕失败时不抛错，保留上一句", async (t) => {
  const p = await createPanel(t);
  await p.cue(cue());
  p.replies["get-cue"] = new Error("扩展断开了");
  await p.pollCue();
  assert.equal(p.$("#live-text").textContent, "Hello world");
});

test("字幕轮询：字幕变化时关掉指着旧词的弹窗，指着别处的弹窗不受影响", async (t) => {
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

test("调整字幕：四个加减按钮和还原按钮各发出对应的消息", async (t) => {
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

// ---- 摘下这句、贴一句 ----

test("摘下这句：把当前字幕和时间发给本机程序，选中新卡片", async (t) => {
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

test("摘下这句：本机程序拒绝时显示它给的原因，没给原因就用默认说法，再次点击先清掉旧提示", async (t) => {
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

test("摘下这句：没有字幕文字时什么也不做", async (t) => {
  const p = await createPanel(t);
  await forceClick(p, "#clip");
  await p.cue(cue(""), "no-caption");
  await forceClick(p, "#clip");
  assert.equal(p.callsTo("POST /cards").length, 0);
});

test("贴一句：去掉首尾空白后加入，清空输入框并选中新卡片", async (t) => {
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

test("贴一句：在输入框里按回车也能加入，按别的键不会", async (t) => {
  const created = card({ id: "c5", text: "Typed" });
  const p = await createPanel(t, { routes: { "POST /cards": json({ card: created }, 201) } });
  p.$("#paste").value = "Typed";
  await p.press("#paste", "a");
  assert.equal(p.callsTo("POST /cards").length, 0);
  await p.press("#paste", "Enter");
  assert.equal(p.callsTo("POST /cards").length, 1);
});

test("贴一句：本机程序拒绝时显示原因或默认说法，并保留输入", async (t) => {
  const p = await createPanel(t, { routes: { "POST /cards": json({ error: "已经有了" }, 409) } });
  p.$("#paste").value = "Dup";
  await p.click("#add");
  assert.equal(p.text("#read-hint"), "已经有了");
  assert.equal(p.$("#paste").value, "Dup");

  p.route("POST /cards", json({}, 500));
  await p.click("#add");
  assert.equal(p.text("#read-hint"), "没有加入");
});

test("贴一句：只有空白时不发请求", async (t) => {
  const p = await createPanel(t);
  p.$("#paste").value = "   ";
  await p.click("#add");
  assert.equal(p.callsTo("POST /cards").length, 0);
});

// ---- 已摘列表与这一句 ----

test("已摘列表：没有句子时显示空状态，没有选中的句子，编辑和听标准音按钮隐藏", async (t) => {
  const p = await createPanel(t);
  assert.equal(p.text("#list li.empty"), "还没有摘过句子");
  assert.equal(p.hidden("#edit"), true);
  assert.equal(p.hidden("#card-play"), true);
  assert.equal(p.hidden("#mine"), true);
  assert.equal(p.$$("#card-sentence .tok").length, 0);
  assert.equal(p.text("#read"), "朗读");
  assert.equal(p.$("#read").disabled, true);
});

test("已摘列表：默认选中第一条，点击另一条会切换，并清掉提示、退出编辑", async (t) => {
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

test("已摘列表：选中的句子被删掉后回到第一条，一条都没有时清空", async (t) => {
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

test("已摘列表：服务器没有返回 cards 和 words 字段时当作空列表", async (t) => {
  const p = await createPanel(t, { routes: { "GET /cards": json({}), "GET /words": json({}) } });
  assert.equal(p.$$("#list li.empty").length, 1);
  assert.equal(p.$$("#word-list li.empty").length, 1);
});

test("这一句：没有换句子时重复渲染不会重建，句子或评分变了才重建", async (t) => {
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

test("这一句：重建句子时关掉指着句子里某个词的弹窗，普通刷新则保留", async (t) => {
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

// ---- 评分 ----

test("评分：按词显示，有没读准的词时给出个数，坏词标红", async (t) => {
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

test("评分：所有词都读准了就这么说", async (t) => {
  const good = scoredCard();
  good.score.words.forEach((w) => (w.bad = false));
  const p = await createPanel(t, { cards: [good] });
  assert.equal(p.text("#score .legend"), "每个词都读准了");
  assert.equal(p.$$("#card-sentence .tok.bad").length, 0);
});

test("评分：没有逐词结果时退回音素对照表，标准在上、你的在下，缺的格子留空", async (t) => {
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

test("评分：逐词结果为空数组时也用音素对照表", async (t) => {
  const empty = scoredCard();
  empty.score.words = [];
  const p = await createPanel(t, { cards: [empty] });
  assert.equal(p.$$("#score .pcol").length, 4);
});

test("评分：逐词结果和句子的词数对不上时不标红，点词走音素查询", async (t) => {
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

test("评分：点评分里的音素格子会播放那个音素，失败时在这一句下面提示", async (t) => {
  const noWords = scoredCard();
  delete noWords.score.words;
  const p = await createPanel(t, { cards: [noWords] });
  await p.click(p.$$("#score .pcol")[1].children[0]);
  assert.equal(p.sound().url, `${API}/speak?ipa=${encodeURIComponent("ə")}`);

  p.sounds.behaviour = () => Promise.reject(new Error("blocked"));
  await p.click(p.$$("#score .pcol")[1].children[1]);
  assert.equal(p.text("#read-hint"), "暂时无法播放音素 ɛ");
});

// ---- 单词弹窗 ----

test("弹窗：点词后先显示查询中，查到后显示音标和释义，词高亮，弹窗打开", async (t) => {
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

test("弹窗：音标已经带斜杠或方括号就原样显示，没有音标就留空", async (t) => {
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

test("弹窗：词典返回错误时显示错误原因，没有原因就用默认说法", async (t) => {
  const p = await createPanel(t, { routes: { "GET /lookup": json({ error: "词典坏了" }, 500) } });
  await p.cue(cue());
  await p.click(p.$("#live-text .tok"));
  assert.equal(p.text("#word-popover .definition"), "词典坏了");
  assert.equal(p.text("#word-popover .ipa"), "");

  p.route("GET /lookup", json({}, 500));
  await p.click(p.$("#live-text .tok"));
  assert.equal(p.text("#word-popover .definition"), "查询失败");
});

test("弹窗：本机程序没开（请求失败）时提示没开，收藏按钮仍可点", async (t) => {
  const p = await createPanel(t);
  await p.cue(cue());
  await p.click(p.$("#live-text .tok"));
  assert.equal(p.text("#word-popover .definition"), "本机程序没开");
  assert.equal(p.$("#word-popover .secondary").disabled, false);
});

test("弹窗：词典没有释义时提示没有词典释义", async (t) => {
  const p = await createPanel(t, { routes: { "GET /lookup": lookupRoute({ definition: null }) } });
  await p.cue(cue());
  await p.click(p.$("#live-text .tok"));
  assert.equal(p.text("#word-popover .definition"), "没有词典释义");
});

test("弹窗：弯引号撇号按直引号去查词", async (t) => {
  const p = await createPanel(t, { routes: { "GET /lookup": lookupRoute() } });
  await p.cue(cue("don’t"));
  await p.click(p.$("#live-text .tok"));
  assert.equal(p.callsTo("GET /lookup")[0].query.get("word"), "don't");
  assert.equal(p.text("#word-popover strong"), "don’t");
});

test("弹窗：点弹窗里的喇叭会朗读这个词", async (t) => {
  const p = await createPanel(t, { routes: { "GET /lookup": lookupRoute() } });
  await p.cue(cue());
  await p.click(p.$("#live-text .tok"));
  await p.click(p.$("#word-popover .icon-button"));
  assert.equal(p.sound().url, `${API}/speak?text=Hello`);
  assert.equal(p.hidden("#word-popover"), false);
});

test("弹窗：词已经收藏过就显示已收藏，点它打开单词详情，按单词本身匹配", async (t) => {
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

test("弹窗：词典返回的原形已收藏时，按原形匹配到收藏", async (t) => {
  const p = await createPanel(t, { words: [word({ id: "w8", word: "run" })], routes: { "GET /lookup": lookupRoute({ word: "Run" }) } });
  await p.cue(cue("running"));
  await p.click(p.$("#live-text .tok"));
  assert.equal(p.text("#word-popover .secondary"), "已收藏 · 查看");
});

test("弹窗：没有查到、也没收藏过的词，按钮是收藏", async (t) => {
  const p = await createPanel(t, { words: [word({ id: "w8", word: "run" })] });
  await p.cue(cue("walking"));
  await p.click(p.$("#live-text .tok"));
  assert.equal(p.text("#word-popover .secondary"), "收藏");
});

test("弹窗：收藏成功会带上句子和视频时间，然后按钮变成已收藏", async (t) => {
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

test("弹窗：收藏时本机程序出错或没开，按钮提示再试一次并恢复可点", async (t) => {
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

test("弹窗：已摘句子里的词收藏时没有视频时间的字段为空，YouTube 句子带上时间", async (t) => {
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

test("弹窗：按 Esc 关闭，没有弹窗时按 Esc 和别的键没有影响", async (t) => {
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

test("弹窗：点弹窗外面关闭，点弹窗里面或另一个词不会因此关闭", async (t) => {
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

test("弹窗：事件目标是 document 本身时也当作点在外面", async (t) => {
  const p = await createPanel(t, { routes: { "GET /lookup": lookupRoute() } });
  await p.cue(cue());
  await p.click(p.$("#live-text .tok"));
  await p.pointerDown(p.document);
  assert.equal(p.hidden("#word-popover"), true);
});

test("弹窗：用键盘的 Enter 或空格也能打开，别的键不行", async (t) => {
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

test("弹窗位置：靠右时贴边，靠左时不小于 8，下面放不下就翻到词的上面", async (t) => {
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

test("弹窗：连续点两个词，先发出的查询后回来时不会盖掉后一个弹窗", async (t) => {
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

test("弹窗：查询返回前关掉弹窗，返回后不会再把弹窗填上", async (t) => {
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

// ---- 弹窗里的音素 ----

test("弹窗音素：没有评分时按词取音素，显示成可点的元音/辅音小块，缓存命中不再请求", async (t) => {
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

test("弹窗音素：取音素失败、被拒绝或结果为空时不显示小块", async (t) => {
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

test("弹窗音素：音素回来时弹窗已经换成别的词，就不再显示", async (t) => {
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

test("弹窗音素：有评分的词显示上下对照，读准的词和没读准的词说明不同", async (t) => {
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

// ---- 播放 ----

test("播放：新的声音会先停掉前一个", async (t) => {
  const p = await createPanel(t, { cards: [card({ latest_attempt_id: "a1" })] });
  await p.click("#card-play");
  const first = p.sound();
  assert.equal(first.pauses, 0);
  await p.click("#mine");
  assert.equal(first.pauses, 1);
  assert.equal(p.sound().url, `${API}/attempts/a1/audio`);
  assert.equal(p.sound().plays, 1);
});

test("播放：听标准音对粘贴的句子读整句，失败时在这一句下面提示", async (t) => {
  const p = await createPanel(t, { cards: [card({ text: "Hello there" })] });
  await p.click("#card-play");
  assert.equal(p.sound().url, `${API}/speak?text=Hello%20there`);
  assert.equal(p.text("#read-hint"), "");

  p.sounds.behaviour = () => Promise.reject(new Error("blocked"));
  await p.click("#card-play");
  assert.equal(p.text("#read-hint"), "标准音暂时无法播放");
});

test("播放：听标准音对 YouTube 句子请求播放原视频片段，结果显示在提示里", async (t) => {
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

test("播放：听原声使用当前字幕的时间，错误显示在当前句下面", async (t) => {
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

test("播放：没有选中句子时听标准音什么也不做", async (t) => {
  const p = await createPanel(t);
  await p.click("#card-play");
  assert.equal(p.sounds.instances.length, 0);
  assert.equal(p.messages.filter((m) => m.type === "play-range").length, 0);
});

test("播放：听我的只在有录音时播放，播放失败也不报错", async (t) => {
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

// ---- 编辑与自动保存 ----

test("编辑：点编辑后显示文本框并聚焦，按钮变成完成，再点一次回到句子", async (t) => {
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

test("编辑：点编辑会关掉打开的弹窗", async (t) => {
  const p = await createPanel(t, { cards: [card()], routes: { "GET /lookup": lookupRoute() } });
  await p.click(p.$("#card-sentence .tok"));
  await p.click("#edit");
  assert.equal(p.hidden("#word-popover"), true);
});

test("编辑：没有句子时点编辑不显示文本框", async (t) => {
  const p = await createPanel(t);
  await p.click("#edit");
  assert.equal(p.hidden("#card-text"), true);
  assert.equal(p.hidden("#card-sentence"), false);
});

test("自动保存：停止输入 400 毫秒后保存修剪过的新文本并刷新，重复输入只保留最后一次", async (t) => {
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

test("自动保存：文本为空或没有变化时不保存，输入时清掉旧提示", async (t) => {
  const p = await createPanel(t, { cards: [card()] });
  await p.click("#edit");
  await p.type("#card-text", "   ");
  await p.runTimeouts();
  await p.type("#card-text", " Hello there world. ");
  await p.runTimeouts();
  assert.equal(p.callsTo("PATCH /cards/c1").length, 0);
});

test("自动保存：输入时先清掉之前的提示", async (t) => {
  const p = await createPanel(t, { cards: [card()], routes: { "POST /cards": json({ error: "已经有了" }, 409) } });
  p.$("#paste").value = "Dup";
  await p.click("#add");
  assert.equal(p.text("#read-hint"), "已经有了");
  await p.click("#edit");
  await p.type("#card-text", "Hello");
  assert.equal(p.text("#read-hint"), "");
});

test("自动保存：没有选中句子时输入不会排保存", async (t) => {
  const p = await createPanel(t);
  await p.type("#card-text", "Hello");
  assert.equal(p.pendingTimeouts().length, 0);
});

test("编辑：正在编辑时后台刷新不会覆盖文本框里正在输入的内容", async (t) => {
  const p = await createPanel(t, { cards: [card()] });
  await p.click("#edit");
  await p.type("#card-text", "Half typed");
  await p.pollHealth();
  assert.equal(p.$("#card-text").value, "Half typed");
  assert.equal(p.text("#read"), "朗读");
});

test("编辑：有评分的句子改动后读按钮退回朗读", async (t) => {
  const p = await createPanel(t, { cards: [scoredCard()] });
  assert.equal(p.text("#read"), "再读一次");
  await p.click("#edit");
  await p.type("#card-text", "Different");
  assert.equal(p.text("#read"), "朗读");
});

// ---- 标签页与生词列表 ----

test("标签页：切到生词隐藏已摘列表和贴一句，并刷新生词；切回来恢复", async (t) => {
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

test("生词列表：没有生词时显示空状态", async (t) => {
  const p = await createPanel(t);
  assert.equal(p.text("#word-list li.empty"), "还没有生词。点句子里的词，就能收藏。");
});

test("生词列表：每行显示词、音标、释义第一行，和上次跟读的命中徽章", async (t) => {
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

test("生词列表：点行里的喇叭只朗读，不打开详情；点行本身打开详情", async (t) => {
  const p = await createPanel(t, { words: [word({ id: "a", word: "alpha" })] });
  await p.click("#word-list .icon-button");
  assert.equal(p.sound().url, `${API}/speak?text=alpha`);
  assert.equal(p.hidden("#word-view"), true);
  await p.click("#word-list li.word-item");
  assert.equal(p.hidden("#word-view"), false);
  assert.equal(p.text("#wv-word"), "alpha");
});

test("生词列表：朗读失败时在已打开的单词详情里提示，没打开详情时提示落在这一句", async (t) => {
  const p = await createPanel(t, { words: [word({ id: "a", word: "alpha" })] });
  p.sounds.behaviour = () => Promise.reject(new Error("blocked"));
  await p.click("#word-list .icon-button");
  assert.equal(p.text("#read-hint"), "标准音暂时无法播放");
  assert.equal(p.text("#wv-hint"), "");
});

// ---- 单词详情 ----

test("单词详情：显示词、音标、释义，拆出音素，并隐藏没有的出处和录音", async (t) => {
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

test("单词详情：没有音标和释义时留空", async (t) => {
  const p = await createPanel(t, { words: [word({ ipa: null, definition: null })] });
  await p.click("#word-list li.word-item");
  assert.equal(p.text("#wv-ipa"), "");
  assert.equal(p.text("#wv-def"), "");
});

test("单词详情：有出处句子和视频时间时显示出处和听原句", async (t) => {
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

test("单词详情：出处缺视频或缺开始时间时不显示听原句", async (t) => {
  const p = await createPanel(t, { words: [word({ source_sentence: "Say hello.", video_id: "vid5", start_ms: null })] });
  await p.click("#word-list li.word-item");
  assert.equal(p.hidden("#wv-source-play"), true);

  const q = await createPanel(t, { words: [word({ source_sentence: "Say hello.", video_id: null, start_ms: 100 })] });
  await q.click("#word-list li.word-item");
  assert.equal(q.hidden("#wv-source-play"), true);
});

test("单词详情：取不到音素时提示，并在下次渲染时重试", async (t) => {
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

test("单词详情：音素返回为空数组时也提示拿不到", async (t) => {
  const p = await createPanel(t, { words: [word()], routes: { "GET /phones": json({ phones: [] }) } });
  await p.click("#word-list li.word-item");
  assert.equal(p.text("#wv-phones"), "暂时拿不到音素，本机程序开了吗？");
});

test("单词详情：音素回来时详情已经关掉，就不再写入", async (t) => {
  const pending = deferred();
  const p = await createPanel(t, { words: [word()], routes: { "GET /phones": () => pending.promise } });
  await p.click("#word-list li.word-item");
  assert.equal(p.text("#wv-phones"), "正在拆音素…");
  await p.click("#word-back");
  pending.resolve(json({ phones: ["h"] }));
  await p.flush();
  assert.equal(p.text("#wv-phones"), "正在拆音素…");
});

test("单词详情：返回生词本会切到生词标签并显示主界面", async (t) => {
  const p = await createPanel(t, { words: [word()] });
  await p.click("#word-list li.word-item");
  await p.click("#word-back");
  assert.equal(p.hidden("#word-view"), true);
  assert.equal(p.hidden("#main"), false);
  assert.ok(p.$("#words-tab").classList.contains("active"));
  assert.equal(p.hidden("#word-list"), false);
});

test("单词详情：评分用对照表而不是按词汇总", async (t) => {
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

test("单词详情：点音素格子播放音素，失败时提示落在单词详情里", async (t) => {
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

test("单词详情：喇叭朗读这个词，失败提示在详情里；听我的播放上次录音", async (t) => {
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

test("单词详情：没有打开单词时喇叭、听我的、听原句、删除都不做事", async (t) => {
  const p = await createPanel(t, { words: [word({ latest_attempt_id: "a9" })] });
  await p.click("#wv-play");
  await p.click("#wv-mine");
  await p.click("#wv-source-play");
  await p.click("#word-delete");
  assert.equal(p.sounds.instances.length, 0);
  assert.equal(p.messages.filter((m) => m.type === "play-range").length, 0);
  assert.equal(p.callsTo("DELETE /words/w1").length, 0);
});

test("单词详情：听我的在没有录音时不播放，失败也不报错", async (t) => {
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

test("单词详情：听原句请求播放视频片段，提示显示在详情里", async (t) => {
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

test("单词详情：删除会请求删除、回到生词本并刷新列表", async (t) => {
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

test("单词详情：删除时本机程序没开，也会回到生词本", async (t) => {
  const p = await createPanel(t, { words: [word()] });
  await p.click("#word-list li.word-item");
  await p.click("#word-delete");
  assert.equal(p.hidden("#word-view"), true);
  assert.equal(p.hidden("#main"), false);
  assert.equal(p.$$("#word-list li.word-item").length, 1);
});

test("单词详情：删除后刷新失败也不抛错", async (t) => {
  const p = await createPanel(t, { words: [word()], routes: { "DELETE /words/w1": json({}) } });
  await p.click("#word-list li.word-item");
  p.route("GET /words", () => {
    throw networkError();
  });
  await p.click("#word-delete");
  assert.equal(p.hidden("#word-view"), true);
});

test("单词详情：打开的单词在服务器上被删掉后，下次刷新自动回到生词本", async (t) => {
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

test("单词详情：从句子弹窗收藏后再点已收藏，打开详情并关掉弹窗", async (t) => {
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

// ---- 麦克风与录音 ----

test("录音权限：已允许时直接开始录音，读按钮变成停止", async (t) => {
  const p = await createPanel(t, { cards: [card()] });
  await p.click("#read");
  assert.equal(p.text("#read"), "停止");
  assert.ok(p.$("#read").classList.contains("recording"));
  assert.deepEqual(p.mic.requests, [{ audio: true }]);
  assert.deepEqual(p.graph.modules, [`chrome-extension://${EXTENSION_ID}/recorder-worklet.js`]);
  assert.equal(p.graph.nodes[0].name, "fengsong-recorder");
  assert.deepEqual(p.graph.nodes[0].options, { numberOfOutputs: 0 });
  assert.equal(p.graph.contexts[0].sources[0].connected, p.graph.nodes[0]);
  assert.equal(p.tabsCreated.length, 0);
});

test("录音权限：需要询问时打开麦克风页，等那个标签页关掉后再检查，通过就继续录音", async (t) => {
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

test("录音权限：麦克风页关掉后仍然没允许，就提示需要权限并显示允许按钮", async (t) => {
  const p = await createPanel(t, { cards: [card()], mic: { state: "prompt" } });
  p.$("#read").click();
  await p.flush();
  p.closeTab(100);
  await p.flush();
  assert.equal(p.text("#read-hint"), MIC_PROMPT);
  assert.equal(p.hidden("#allow-mic"), false);
  assert.equal(p.graph.contexts.length, 0);
});

test("录音权限：打不开标签页（拿不到标签页 id）时直接判定没允许", async (t) => {
  const p = await createPanel(t, { cards: [card()], mic: { state: "prompt" } });
  p.tabs.factory = () => undefined;
  await p.click("#read");
  assert.equal(p.text("#read-hint"), MIC_PROMPT);
  assert.equal(p.removedListeners.length, 0);

  p.tabs.factory = () => ({});
  await p.click("#read");
  assert.equal(p.text("#read-hint"), MIC_PROMPT);
});

test("录音权限：被拒绝时打开浏览器的网站设置页，并提示需要权限", async (t) => {
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

test("录音权限：查询权限本身出错时按需要询问处理", async (t) => {
  const p = await createPanel(t, { cards: [card()], mic: { queryError: new Error("unsupported") } });
  p.tabs.factory = () => undefined;
  await p.click("#read");
  assert.equal(p.tabsCreated.length, 1);
  assert.equal(p.tabsCreated[0].url, `chrome-extension://${EXTENSION_ID}/mic.html`);
  assert.equal(p.text("#read-hint"), MIC_PROMPT);
});

test("录音权限：允许麦克风按钮在授权后继续录音，没授权则保持提示", async (t) => {
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

test("录音权限：正在询问时再点允许麦克风不会重复询问", async (t) => {
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

test("录音失败：拿不到麦克风流时提示需要权限，不创建音频环境", async (t) => {
  const p = await createPanel(t, { cards: [card()], mic: { streamError: new Error("NotAllowed") } });
  await p.click("#read");
  assert.equal(p.text("#read-hint"), MIC_PROMPT);
  assert.equal(p.graph.contexts.length, 0);
  assert.equal(p.text("#read"), "朗读");
});

test("录音失败：录音组件加载不出来时释放麦克风和音频环境并提示", async (t) => {
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

test("录音：开始时清掉之前的提示，没有选中句子或没连上时读按钮不可用也不会录", async (t) => {
  const p = await createPanel(t);
  assert.equal(p.$("#read").disabled, true);
  await forceClick(p, "#read");
  assert.equal(p.mic.queries.length, 0);

  const q = await createPanel(t, { cards: [card()], server: { up: false } });
  assert.equal(q.$("#read").disabled, true);
});

test("录音：停止后把重采样成 16k 的 WAV 上传，上传期间显示正在听，成功后刷新句子", async (t) => {
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

test("录音：上传时再点读按钮被忽略", async (t) => {
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

test("录音：本机程序返回错误时显示它的说明，没有说明用默认说法", async (t) => {
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

test("录音：上传时本机程序没开，提示没开并恢复读按钮", async (t) => {
  const p = await createPanel(t, { cards: [card()] });
  await p.click("#read");
  await p.click("#read");
  assert.equal(p.text("#read-hint"), "本机程序没开");
  assert.equal(p.text("#read"), "朗读");
  assert.equal(p.$("#read").disabled, false);
});

test("录音：上传后刷新句子失败也能恢复", async (t) => {
  const p = await createPanel(t, { cards: [card()], routes: { "POST /cards/c1/attempts": json({ ok: true }) } });
  await p.click("#read");
  p.route("GET /cards", () => {
    throw networkError();
  });
  await p.click("#read");
  assert.equal(p.text("#read"), "朗读");
});

test("录音：生词的跟读上传到生词的接口，上传后刷新生词，错误提示在详情里", async (t) => {
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

test("录音：上传后刷新生词失败也能恢复", async (t) => {
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

test("录音：生词录音成功后更新评分和跟读按钮文字", async (t) => {
  const p = await createPanel(t, { words: [word()], routes: { "POST /words/w1/attempts": json({ ok: true }) } });
  await p.click("#word-list li.word-item");
  await p.click("#wv-read");
  p.data.words = [word({ score: { match_count: 2, expected_count: 2, expected: [ph("h")], heard: [ph("h")] }, latest_attempt_id: "a5" })];
  await p.click("#wv-read");
  assert.equal(p.text("#wv-read"), "再读一次");
  assert.equal(p.hidden("#wv-mine"), false);
  assert.equal(p.text("#wv-score .ratio"), "2/2");
});

test("录音：卡片在录音时，生词的读按钮不可用，点它也不会停止卡片的录音", async (t) => {
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

test("录音：生词在录音时，卡片的读按钮不可用", async (t) => {
  const p = await createPanel(t, { cards: [card()], words: [word()] });
  await p.click("#word-list li.word-item");
  await p.click("#wv-read");
  await p.click("#word-back");
  assert.equal(p.$("#read").disabled, true);
  assert.ok(!p.$("#read").classList.contains("recording"));
  await forceClick(p, "#read");
  assert.equal(p.graph.contexts[0].closed, false);
});

test("录音：生词详情没有打开时点跟读不录音", async (t) => {
  const p = await createPanel(t, { words: [word()] });
  await p.click("#wv-read");
  assert.equal(p.mic.queries.length, 0);
});

test("录音：生词的权限失败提示落在单词详情里", async (t) => {
  const p = await createPanel(t, { words: [word()], mic: { streamError: new Error("NotAllowed") } });
  await p.click("#word-list li.word-item");
  await p.click("#wv-read");
  assert.equal(p.text("#wv-hint"), MIC_PROMPT);
});

test("录音：生词录音中点开始提示的位置：权限被拒绝时打开设置页", async (t) => {
  const p = await createPanel(t, { words: [word()], mic: { state: "denied" } });
  await p.click("#word-list li.word-item");
  await p.click("#wv-read");
  assert.equal(p.tabsCreated.length, 1);
  assert.equal(p.text("#wv-hint"), MIC_PROMPT);
});
