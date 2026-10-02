const test = require("node:test");
const assert = require("node:assert/strict");
const {
  addPlayer,
  addSubtitlesButton,
  addVideo,
  fakeResponse,
  flush,
  loadPage,
  navigate,
  plain,
  setTextTracks,
} = require("./helpers/scripts.js");

const json = (events) => JSON.stringify({ events });
const GOOD = json([{ tStartMs: 0, dDurationMs: 1000, segs: [{ utf8: "Hello" }] }]);
const GOOD_CUES = [{ text: "Hello", startMs: 0, endMs: 1000 }];
const timedtext = (query = "v=abc&lang=en") => `https://www.youtube.com/api/timedtext?${query}`;
const serving = (body) => () => Promise.resolve(fakeResponse({ body }));
const captionsResponse = (captionTracks) => ({
  captions: { playerCaptionsTracklistRenderer: { captionTracks } },
});

async function cuesFrom(body) {
  const page = loadPage();
  page.captureTimedtext(body);
  return plain(await page.load());
}

// 每次 setTimeout 睡醒时调用，用来模拟"等待期间页面发生了变化"。
function onSleep(page, handler) {
  let count = 0;
  page.clock.onSleep = () => {
    count += 1;
    handler(count);
  };
}

// ---- parseJson3 ----
test("page: 解析 json3 事件：合并文字片段、压缩空白、计算结束时间", async () => {
  const events = [
    { tStartMs: 0, dDurationMs: 1500, segs: [{ utf8: "Hello  " }, { utf8: "\nworld" }] },
    { tStartMs: 2000, segs: [{ utf8: "No duration" }] },
    { id: 1, wpWinPosId: 1 },
    { tStartMs: 2000, segs: [{ utf8: "Same start" }] },
    { tStartMs: 3000, segs: [{ utf8: "Last" }, {}] },
    { tStartMs: 5000, segs: [{ utf8: "\n" }] },
    { tStartMs: 6000 },
    { tStartMs: 7000, dDurationMs: 0, segs: [{ utf8: "Zero" }] },
  ];
  assert.deepEqual(await cuesFrom(json(events)), [
    { text: "Hello world", startMs: 0, endMs: 1500 },
    { text: "No duration", startMs: 2000, endMs: 3000 },
    { text: "Same start", startMs: 2000, endMs: 3000 },
    { text: "Last", startMs: 3000, endMs: 5000 },
    { text: "Zero", startMs: 7000, endMs: 11000 },
  ]);
});

test("page: json3 没有 events 时没有字幕", async () => {
  assert.deepEqual(await cuesFrom("{}"), []);
  assert.deepEqual(await cuesFrom("[]"), []);
  assert.deepEqual(await cuesFrom(json([])), []);
});

// ---- parseXml ----
test("page: 解析 XML 字幕，start/dur 属性按秒换算成毫秒", async () => {
  const xml = `<?xml version="1.0"?><transcript>
    <text start="1.5" dur="2.25">Hi   there</text>
    <text start="4">No duration</text>
    <text start="5">   </text>
    <text start="5.5"></text>
    <text start="5.0004" dur="1">Rounded</text>
  </transcript>`;
  assert.deepEqual(await cuesFrom(xml), [
    { text: "Hi there", startMs: 1500, endMs: 3750 },
    { text: "No duration", startMs: 4000, endMs: 8000 },
    { text: "Rounded", startMs: 5000, endMs: 6000 },
  ]);
});

test("page: 解析 XML 字幕，t/d 属性本身就是毫秒", async () => {
  const xml = `<timedtext format="3"><body>
    <p t="1500" d="2000">One</p>
    <p t="4000">Two</p>
    <p d="500">Three</p>
  </body></timedtext>`;
  assert.deepEqual(await cuesFrom(xml), [
    { text: "One", startMs: 1500, endMs: 3500 },
    { text: "Two", startMs: 4000, endMs: 8000 },
    { text: "Three", startMs: 0, endMs: 500 },
  ]);
});

test("page: 坏掉的 XML 没有字幕", async () => {
  assert.deepEqual(await cuesFrom("<text start='1'>oops"), []);
});

// ---- parseBody ----
test("page: 解析正文前去掉 )]}' 防护前缀和首尾空白", async () => {
  assert.deepEqual(await cuesFrom(`)]}'\n  ${GOOD}  \n`), GOOD_CUES);
});

test("page: 空正文、非 JSON 非 XML 的正文、残缺的 JSON 都没有字幕", async () => {
  for (const body of ["", "   ", "hello", "{broken", ")]}'"]) {
    assert.deepEqual(await cuesFrom(body), [], JSON.stringify(body));
  }
});

// ---- note() 过滤 ----
test("page: 英文字幕请求被记下来，load 直接返回而不等待", async () => {
  const page = loadPage();
  page.captureTimedtext(GOOD);
  const before = page.clock.now;
  assert.deepEqual(plain(await page.load()), GOOD_CUES);
  assert.equal(page.clock.now, before);
  assert.equal(page.fetchCalls.length, 0);
});

test("page: lang 缺省或为空按英文处理，en-US 等变体也接受", async () => {
  for (const query of ["v=abc", "v=abc&lang=", "v=abc&lang=EN-US", "v=abc&lang=en-GB"]) {
    const page = loadPage();
    page.xhr({ url: timedtext(query), response: GOOD });
    assert.deepEqual(plain(await page.load()), GOOD_CUES, query);
  }
});

test("page: 非英文、翻译（tlang）、非 /api/timedtext 路径的请求被忽略", async () => {
  const ignored = [
    timedtext("v=abc&lang=fr"),
    timedtext("v=abc&lang=en&tlang=zh-Hans"),
    "https://www.youtube.com/timedtext_editor?v=abc&lang=en",
    "https://www.youtube.com/api2/timedtext?lang=en&v=abc",
  ];
  for (const url of ignored) {
    const page = loadPage();
    page.xhr({ url, response: GOOD });
    assert.deepEqual(plain(await page.load()), [], url);
  }
});

test("page: 无法解析的地址被忽略，不会抛错", async () => {
  const page = loadPage();
  page.xhr({ url: "https://[timedtext", response: GOOD });
  assert.deepEqual(plain(await page.load()), []);
});

test("page: 请求里没有 v 时用页面地址里的视频编号", async () => {
  const page = loadPage();
  page.xhr({ url: timedtext("lang=en"), response: GOOD });
  assert.deepEqual(plain(await page.load()), GOOD_CUES);
});

test("page: 请求和页面都没有视频编号时忽略", async () => {
  const page = loadPage({ url: "https://www.youtube.com/" });
  page.xhr({ url: timedtext("lang=en"), response: GOOD });
  navigate(page.window, "/watch?v=abc");
  assert.deepEqual(plain(await page.load()), []);
});

test("page: 其他视频的字幕不会混进当前视频", async () => {
  const page = loadPage();
  page.captureTimedtext(GOOD, { v: "zzz" });
  assert.deepEqual(plain(await page.load()), []);
});

test("page: 记下别的视频的字幕后，回到那个视频仍能直接用", async () => {
  const page = loadPage();
  page.captureTimedtext(GOOD, { v: "zzz" });
  navigate(page.window, "/watch?v=zzz");
  const before = page.clock.now;
  assert.deepEqual(plain(await page.load()), GOOD_CUES);
  assert.equal(page.clock.now, before);
});

test("page: 空正文不会覆盖已经记下的字幕，新的非空字幕会覆盖", async () => {
  const page = loadPage();
  page.captureTimedtext(GOOD);
  page.captureTimedtext("");
  assert.deepEqual(plain(await page.load()), GOOD_CUES);
  const newer = json([{ tStartMs: 500, dDurationMs: 500, segs: [{ utf8: "Newer" }] }]);
  page.captureTimedtext(newer);
  assert.deepEqual(plain(await page.load()), [{ text: "Newer", startMs: 500, endMs: 1000 }]);
});

test("page: 带 pot 的请求地址被记住，没有字幕内容时用它重新取", async () => {
  const page = loadPage({ fetchImpl: serving(GOOD) });
  const href = timedtext("v=abc&lang=en&pot=TOKEN&potc=1");
  page.xhr({ url: href, response: "" });
  assert.deepEqual(plain(await page.load()), GOOD_CUES);
  assert.equal(page.fetchCalls.length, 1);
  assert.equal(page.fetchCalls[0].input, href);
  assert.deepEqual(plain(page.fetchCalls[0].init), { credentials: "include" });
});

test("page: 不带 pot 的请求地址不会被记住", async () => {
  const page = loadPage({ fetchImpl: serving(GOOD) });
  page.xhr({ url: timedtext("v=abc&lang=en"), response: "" });
  assert.deepEqual(plain(await page.load()), []);
  assert.equal(page.fetchCalls.length, 0);
});

test("page: 换了视频就清掉旧视频记下的地址", async () => {
  const page = loadPage({ fetchImpl: serving(GOOD) });
  page.xhr({ url: timedtext("v=abc&lang=en&pot=TOKEN"), response: "" });
  navigate(page.window, "/watch?v=def");
  assert.deepEqual(plain(await page.load()), []);
  assert.equal(page.fetchCalls.length, 0);
});

// ---- readXhrBody ----
test("page: XHR 响应是 json 对象时序列化后解析", async () => {
  const page = loadPage();
  page.xhr({ url: timedtext(), responseType: "json", response: JSON.parse(GOOD) });
  assert.deepEqual(plain(await page.load()), GOOD_CUES);
});

test("page: json 响应为空时退回读 responseText", async () => {
  const page = loadPage();
  page.xhr({ url: timedtext(), responseType: "json", response: null, responseText: GOOD });
  assert.deepEqual(plain(await page.load()), GOOD_CUES);
});

test("page: XHR 响应是 arraybuffer 时按文本解码", async () => {
  const page = loadPage();
  const buffer = new TextEncoder().encode(GOOD).buffer;
  page.xhr({ url: timedtext(), responseType: "arraybuffer", response: buffer });
  assert.deepEqual(plain(await page.load()), GOOD_CUES);
});

test("page: arraybuffer 响应为空时退回读 responseText", async () => {
  const page = loadPage();
  page.xhr({ url: timedtext(), responseType: "arraybuffer", response: null, responseText: GOOD });
  assert.deepEqual(plain(await page.load()), GOOD_CUES);
});

test("page: XHR 响应是 Blob 时异步读出文本", async () => {
  const page = loadPage();
  page.xhr({ url: timedtext(), responseType: "blob", response: new page.window.Blob([GOOD]) });
  await flush();
  assert.deepEqual(plain(await page.load()), GOOD_CUES);
});

test("page: 读 Blob 失败时吞掉错误", async () => {
  const page = loadPage();
  const blob = Object.create(page.window.Blob.prototype);
  blob.text = () => Promise.reject(new Error("读取失败"));
  page.xhr({ url: timedtext(), responseType: "blob", response: blob });
  await flush();
  assert.deepEqual(plain(await page.load()), []);
});

test("page: XHR 响应是字符串时直接解析", async () => {
  const page = loadPage();
  page.xhr({ url: timedtext(), responseType: "text", response: GOOD });
  assert.deepEqual(plain(await page.load()), GOOD_CUES);
});

test("page: 响应为空字符串时退回读 responseText，都为空则没有字幕", async () => {
  const page = loadPage();
  page.xhr({ url: timedtext(), response: "", responseText: GOOD });
  assert.deepEqual(plain(await page.load()), GOOD_CUES);
  const empty = loadPage();
  empty.xhr({ url: timedtext(), response: "", responseText: "" });
  assert.deepEqual(plain(await empty.load()), []);
});

test("page: 读取响应抛错时按空正文处理", async () => {
  const page = loadPage();
  page.xhr({
    url: timedtext(),
    setup: (xhr) =>
      Object.defineProperty(xhr, "response", {
        get() {
          throw new Error("InvalidStateError");
        },
      }),
  });
  assert.deepEqual(plain(await page.load()), []);
});

// ---- XHR 补丁 ----
test("page: 补丁后的 open 记下地址并交给原来的 open", () => {
  const page = loadPage();
  const xhr = new page.window.XMLHttpRequest();
  const url = new URL("https://example.com/a");
  const result = xhr.open("POST", url, true, "user");
  assert.equal(result, "opened");
  assert.equal(xhr.opened.length, 1);
  const [method, passedUrl, async, user] = xhr.opened[0];
  assert.deepEqual([method, async, user], ["POST", true, "user"]);
  assert.equal(passedUrl, url);
  assert.equal(xhr.__fengsongUrl, "https://example.com/a");
});

test("page: 补丁后的 send 交给原来的 send，并返回它的结果", () => {
  const page = loadPage();
  const xhr = new page.window.XMLHttpRequest();
  assert.equal(xhr.send("body", 2), "sent");
  assert.deepEqual(plain(xhr.sent), [["body", 2]]);
  assert.equal(xhr.listeners.load.length, 1);
});

test("page: 响应地址缺失时用 open 时记下的地址", async () => {
  const page = loadPage();
  page.xhr({ url: timedtext(), responseURL: "", response: GOOD });
  assert.deepEqual(plain(await page.load()), GOOD_CUES);
});

test("page: 响应地址（重定向后）优先于 open 时的地址", async () => {
  const page = loadPage();
  page.xhr({ url: "https://www.youtube.com/redirect", responseURL: timedtext(), response: GOOD });
  assert.deepEqual(plain(await page.load()), GOOD_CUES);
});

test("page: 没有任何地址或地址不含 timedtext 的 XHR 不读取", async () => {
  const page = loadPage();
  let reads = 0;
  const watch = (xhr) =>
    Object.defineProperty(xhr, "response", {
      get() {
        reads += 1;
        return GOOD;
      },
    });
  page.xhr({ setup: watch });
  page.xhr({ url: "https://www.youtube.com/api/stats", setup: watch });
  assert.equal(reads, 0);
  assert.deepEqual(plain(await page.load()), []);
});

test("page: 脚本重复注入时不会二次打补丁", () => {
  const page = loadPage({ loadTwice: true });
  assert.equal(page.window.fetch, page.patched.fetch);
  assert.equal(page.window.XMLHttpRequest.prototype.open, page.patched.open);
  assert.equal(page.window.__fengsongLoad, page.patched.load);
  assert.notEqual(page.window.fetch, page.originalFetch);
  assert.notEqual(page.window.XMLHttpRequest.prototype.open, page.originals.open);
});

// ---- fetch 补丁 ----
test("page: 补丁后的 fetch 把请求交给原来的 fetch，并原样返回响应", async () => {
  const response = fakeResponse({ url: "https://www.youtube.com/other", body: "" });
  const page = loadPage({ fetchImpl: () => Promise.resolve(response) });
  const init = { method: "GET" };
  const result = await page.window.fetch("https://www.youtube.com/other", init);
  assert.equal(result, response);
  assert.equal(page.fetchCalls[0].input, "https://www.youtube.com/other");
  assert.equal(page.fetchCalls[0].init, init);
  assert.equal(response.cloned, 0);
});

test("page: 字幕请求的响应被复制一份读出来，字符串地址", async () => {
  const response = fakeResponse({ url: "", body: GOOD });
  const page = loadPage({ fetchImpl: () => Promise.resolve(response) });
  const result = await page.window.fetch(timedtext());
  assert.equal(result, response);
  assert.equal(response.cloned, 1);
  await flush();
  assert.deepEqual(plain(await page.load()), GOOD_CUES);
  assert.equal(page.fetchCalls.length, 1);
});

test("page: 请求对象（带 url）也能识别，响应地址优先", async () => {
  const response = fakeResponse({ url: timedtext("v=abc&lang=en"), body: GOOD });
  const page = loadPage({ fetchImpl: () => Promise.resolve(response) });
  await page.window.fetch({ url: "https://www.youtube.com/api/timedtext-proxy" });
  await flush();
  assert.deepEqual(plain(await page.load()), GOOD_CUES);
});

test("page: 没有地址的请求按空地址处理，不读响应", async () => {
  for (const input of [undefined, null, {}]) {
    const response = fakeResponse({ url: timedtext(), body: GOOD });
    const page = loadPage({ fetchImpl: () => Promise.resolve(response) });
    await page.window.fetch(input);
    assert.equal(response.cloned, 0);
  }
});

test("page: 复制响应读文字失败时吞掉错误", async () => {
  const response = fakeResponse({ cloneError: true });
  const page = loadPage({ fetchImpl: () => Promise.resolve(response) });
  const result = await page.window.fetch(timedtext());
  await flush();
  assert.equal(result, response);
  assert.deepEqual(plain(await page.load()), []);
});

// ---- 页面自带字幕轨 ----
const cue = (text, startTime, endTime) => ({ text, startTime, endTime });
const track = (fields = {}) => ({ language: "en", mode: "showing", cues: [cue("Hi", 1, 2)], ...fields });

test("page: 读取英文字幕轨，时间四舍五入到毫秒，压缩空白", async () => {
  const page = loadPage();
  const video = addVideo(page.document);
  setTextTracks(video, [track({ cues: [cue("  Hi \n there ", 1.2344, 2.5006), cue("Bye", 3, 4)] })]);
  assert.deepEqual(plain(await page.load()), [
    { text: "Hi there", startMs: 1234, endMs: 2501 },
    { text: "Bye", startMs: 3000, endMs: 4000 },
  ]);
});

test("page: 字幕轨读到后缓存，不再重新读取", async () => {
  const page = loadPage();
  const video = addVideo(page.document);
  const tracks = [track()];
  setTextTracks(video, tracks);
  await page.load();
  tracks[0].cues = [cue("Changed", 9, 10)];
  assert.deepEqual(plain(await page.load()), [{ text: "Hi", startMs: 1000, endMs: 2000 }]);
});

test("page: 没有 video 或 video 没有 textTracks 时回退到等待", async () => {
  const none = loadPage();
  assert.deepEqual(plain(await none.load()), []);
  const bare = loadPage();
  setTextTracks(addVideo(bare.document), undefined);
  assert.deepEqual(plain(await bare.load()), []);
});

test("page: 字幕轨被禁用时改成 hidden 才能拿到字幕内容", async () => {
  const page = loadPage();
  const empty = track({ mode: "disabled", cues: null });
  const none = track({ mode: "disabled", cues: [] });
  const showing = track({ mode: "showing", cues: null });
  setTextTracks(addVideo(page.document), [empty, none, showing]);
  assert.deepEqual(plain(await page.load()), []);
  assert.equal(empty.mode, "hidden");
  assert.equal(none.mode, "hidden");
  assert.equal(showing.mode, "showing");
});

test("page: 非英文字幕轨被跳过，语言为空的字幕轨当作可用", async () => {
  const page = loadPage();
  const french = track({ language: "fr", mode: "disabled", cues: [cue("Bonjour", 1, 2)] });
  const unknown = track({ language: undefined, cues: [cue("Unknown", 3, 4)] });
  setTextTracks(addVideo(page.document), [french, unknown]);
  assert.deepEqual(plain(await page.load()), [{ text: "Unknown", startMs: 3000, endMs: 4000 }]);
  assert.equal(french.mode, "disabled");
});

test("page: 大写语言码也算英文", async () => {
  const page = loadPage();
  setTextTracks(addVideo(page.document), [track({ language: "EN-US" })]);
  assert.deepEqual(plain(await page.load()), [{ text: "Hi", startMs: 1000, endMs: 2000 }]);
});

test("page: 字幕轨里全是空白的字幕条时，换下一条字幕轨", async () => {
  const page = loadPage();
  const blank = track({ cues: [cue("   ", 1, 2), { startTime: 2, endTime: 3 }] });
  const next = track({ cues: [cue("Real", 5, 6)] });
  setTextTracks(addVideo(page.document), [blank, next]);
  assert.deepEqual(plain(await page.load()), [{ text: "Real", startMs: 5000, endMs: 6000 }]);
});

test("page: 等待期间字幕轨有了内容就立刻返回", async () => {
  const page = loadPage();
  const late = track({ cues: [] });
  setTextTracks(addVideo(page.document), [late]);
  onSleep(page, (count) => {
    if (count === 2) late.cues = [cue("Later", 1, 2)];
  });
  const start = page.clock.now;
  assert.deepEqual(plain(await page.load()), [{ text: "Later", startMs: 1000, endMs: 2000 }]);
  assert.equal(page.clock.now - start, 600);
});

// ---- enableEnglish ----
const tracklist = [
  { languageCode: "fr", kind: "standard" },
  { languageCode: "en", kind: "asr", id: "auto" },
  {},
  { languageCode: "EN-US", kind: "standard", id: "manual" },
];

function playerWith(page, members = {}, options = {}) {
  const calls = { setOption: [], toggle: 0 };
  const player = addPlayer(page.document, {
    getOption: () => tracklist,
    setOption: (...args) => calls.setOption.push(args),
    toggleSubtitles: () => {
      calls.toggle += 1;
    },
    ...members,
  });
  const button = addSubtitlesButton(page.document, options);
  return { player, button, calls };
}

test("page: 打开英文字幕时优先选择非自动生成的轨道，且只设置一次", async () => {
  const page = loadPage();
  const { calls, button } = playerWith(page);
  await page.load();
  assert.equal(calls.setOption.length, 1);
  assert.equal(calls.setOption[0][0], "captions");
  assert.equal(calls.setOption[0][1], "track");
  assert.equal(calls.setOption[0][2].id, "manual");
  assert.equal(calls.toggle, 0);
  assert.equal(button.fake.clicks, 0);
});

test("page: 只有自动生成的英文轨道时就用它", async () => {
  const page = loadPage();
  const { calls } = playerWith(page, { getOption: () => [{ languageCode: "en", kind: "asr", id: "auto" }] });
  await page.load();
  assert.equal(calls.setOption[0][2].id, "auto");
});

test("page: 字幕按钮已经是按下状态就什么都不做", async () => {
  const page = loadPage();
  const { calls, button } = playerWith(page, {}, { pressed: true });
  await page.load();
  assert.deepEqual(calls.setOption, []);
  assert.equal(calls.toggle, 0);
  assert.equal(button.fake.clicks, 0);
});

test("page: 找不到英文轨道时调用播放器的 toggleSubtitles", async () => {
  for (const getOption of [() => [{ languageCode: "fr" }], () => undefined, undefined]) {
    const page = loadPage();
    const { calls, button } = playerWith(page, { getOption });
    await page.load();
    assert.deepEqual(calls.setOption, []);
    assert.equal(calls.toggle, 1);
    assert.equal(button.fake.clicks, 0);
  }
});

test("page: 没有 setOption 时也走 toggleSubtitles", async () => {
  const page = loadPage();
  const { calls } = playerWith(page, { setOption: undefined });
  await page.load();
  assert.equal(calls.toggle, 1);
});

test("page: 读取轨道列表抛错时走 toggleSubtitles", async () => {
  const page = loadPage();
  const { calls } = playerWith(page, {
    getOption: () => {
      throw new Error("播放器还没准备好");
    },
  });
  await page.load();
  assert.deepEqual(calls.setOption, []);
  assert.equal(calls.toggle, 1);
});

test("page: 播放器没有 toggleSubtitles 时点击字幕按钮", async () => {
  const page = loadPage();
  const { button } = playerWith(page, { getOption: undefined, toggleSubtitles: undefined });
  await page.load();
  assert.equal(button.fake.clicks, 1);
});

test("page: 播放器或字幕按钮晚出现时，等它们都出现了再启用", async () => {
  const page = loadPage();
  const calls = [];
  onSleep(page, (count) => {
    if (count === 1) {
      addPlayer(page.document, {
        getOption: () => tracklist,
        setOption: (...args) => calls.push(["setOption", args[2].id]),
      });
    }
    if (count === 2) {
      calls.push(["buttonAdded"]);
      addSubtitlesButton(page.document);
    }
  });
  await page.load();
  assert.deepEqual(calls, [["buttonAdded"], ["setOption", "manual"]]);
});

test("page: 只有字幕按钮没有播放器时不启用", async () => {
  const page = loadPage();
  const button = addSubtitlesButton(page.document);
  await page.load();
  assert.equal(button.fake.clicks, 0);
});

test("page: 同一个视频的重复加载只启用一次，换视频后重新启用", async () => {
  const page = loadPage();
  const { calls } = playerWith(page);
  await page.load();
  await page.load();
  assert.equal(calls.setOption.length, 1);
  navigate(page.window, "/watch?v=def");
  await page.load();
  assert.equal(calls.setOption.length, 2);
});

// ---- urlWithPot ----
const MANUAL_BASE = "/api/timedtext?v=abc&lang=en&fmt=srv3";
const AUDIO_ITEMS = [
  { url: "http://[bad" },
  { url: timedtext("v=other&lang=en&pot=OTHER") },
  { url: timedtext("v=abc&lang=fr&pot=FRENCH") },
  { url: timedtext("v=abc&lang=en") },
  { url: timedtext("v=abc&lang=en&pot=GOOD&potc=C") },
  { url: timedtext("v=abc&lang=en&pot=LATER&potc=L") },
];

function mintPage({ audio, response, fetchImpl = serving(GOOD) } = {}) {
  const page = loadPage({ fetchImpl });
  addPlayer(page.document, {
    getPlayerResponse: () => response,
    ...(audio === undefined ? {} : { getAudioTrack: () => audio }),
  });
  return page;
}

const mintResponse = captionsResponse([
  { languageCode: "en", kind: "asr", baseUrl: "/api/timedtext?v=abc&lang=en&kind=asr" },
  { languageCode: "fr", baseUrl: "/api/timedtext?v=abc&lang=fr" },
  { baseUrl: "/api/timedtext?v=abc&lang=none" },
  { languageCode: "en", baseUrl: MANUAL_BASE },
]);

test("page: 用播放器音轨里的 pot 拼出字幕地址，选非自动生成的英文轨道", async () => {
  const page = mintPage({ response: mintResponse, audio: { captionTracks: AUDIO_ITEMS } });
  assert.deepEqual(plain(await page.load()), GOOD_CUES);
  assert.equal(
    page.fetchCalls[0].input,
    "https://www.youtube.com/api/timedtext?v=abc&lang=en&fmt=json3&c=WEB&pot=GOOD&potc=C",
  );
  assert.equal(page.fetchCalls.length, 1);
});

test("page: 音轨没有 potc 时不加 potc 参数", async () => {
  const items = [{ url: timedtext("v=abc&lang=en&pot=ONLY") }];
  const page = mintPage({ response: mintResponse, audio: { captionTracks: items } });
  await page.load();
  assert.equal(
    page.fetchCalls[0].input,
    "https://www.youtube.com/api/timedtext?v=abc&lang=en&fmt=json3&c=WEB&pot=ONLY",
  );
});

test("page: 只有自动生成的英文字幕轨时也能拼出地址", async () => {
  const response = captionsResponse([{ languageCode: "en", kind: "asr", baseUrl: "/api/timedtext?v=abc&kind=asr" }]);
  const page = mintPage({ response, audio: { captionTracks: [{ url: timedtext("pot=P") }] } });
  await page.load();
  assert.equal(
    page.fetchCalls[0].input,
    "https://www.youtube.com/api/timedtext?v=abc&kind=asr&fmt=json3&c=WEB&pot=P",
  );
});

test("page: 音轨没有 captionTracks、没有 getAudioTrack 或没有 pot 时拼不出地址", async () => {
  const variants = [{ audio: {} }, { audio: undefined }, { audio: null }, { audio: { captionTracks: [] } }];
  for (const variant of variants) {
    const page = mintPage({ response: mintResponse, ...variant });
    assert.deepEqual(plain(await page.load()), [], JSON.stringify(variant));
    assert.equal(page.fetchCalls.length, 0);
  }
});

test("page: 没有英文字幕轨、没有 baseUrl 或没有字幕信息时拼不出地址", async () => {
  const audio = { captionTracks: [{ url: timedtext("pot=P") }] };
  const responses = [
    undefined,
    {},
    { captions: {} },
    captionsResponse([]),
    captionsResponse([{ languageCode: "fr", baseUrl: "/api/timedtext?lang=fr" }]),
    captionsResponse([{ languageCode: "en" }]),
  ];
  for (const response of responses) {
    const page = mintPage({ response, audio });
    assert.deepEqual(plain(await page.load()), [], JSON.stringify(response));
    assert.equal(page.fetchCalls.length, 0);
  }
});

const mintedOnly = (url) => Promise.resolve(fakeResponse({ body: url.includes("fmt=json3") ? GOOD : "" }));

test("page: 播放器没有 getPlayerResponse、返回空值或没有播放器时读 ytInitialPlayerResponse", async () => {
  const response = captionsResponse([{ languageCode: "en", baseUrl: MANUAL_BASE }]);
  const players = {
    "getPlayerResponse 返回 null": (page) => addPlayer(page.document, { getPlayerResponse: () => null }),
    没有播放器: () => {},
    "播放器没有 getPlayerResponse": (page) => addPlayer(page.document),
  };
  for (const [name, install] of Object.entries(players)) {
    const page = loadPage({ fetchImpl: mintedOnly });
    page.window.ytInitialPlayerResponse = response;
    install(page);
    page.xhr({ url: timedtext("v=abc&lang=en&pot=CACHED"), response: "" });
    assert.deepEqual(plain(await page.load()), GOOD_CUES, name);
    assert.equal(
      page.fetchCalls[1].input,
      "https://www.youtube.com/api/timedtext?v=abc&lang=en&fmt=json3&c=WEB&pot=CACHED",
      name,
    );
  }
});

test("page: 抓到的地址取不到字幕时，用缓存的 pot 和 potc 重新拼地址", async () => {
  const page = loadPage({ fetchImpl: mintedOnly });
  page.window.ytInitialPlayerResponse = captionsResponse([{ languageCode: "en", baseUrl: "/api/timedtext?v=abc&lang=en" }]);
  const captured = timedtext("v=abc&lang=en&pot=CACHED&potc=CC");
  page.xhr({ url: captured, response: "" });
  assert.deepEqual(plain(await page.load()), GOOD_CUES);
  assert.deepEqual(
    page.fetchCalls.map((call) => call.input),
    [captured, "https://www.youtube.com/api/timedtext?v=abc&lang=en&fmt=json3&c=WEB&pot=CACHED&potc=CC"],
  );
});

test("page: 播放器音轨里的 pot 优先于缓存的 pot", async () => {
  const page = mintPage({
    response: captionsResponse([{ languageCode: "en", baseUrl: "/api/timedtext?v=abc&lang=en" }]),
    audio: { captionTracks: [{ url: timedtext("v=abc&lang=en&pot=AUDIO") }] },
    fetchImpl: (url) => Promise.resolve(fakeResponse({ body: url.includes("pot=AUDIO") ? GOOD : "" })),
  });
  page.xhr({ url: timedtext("v=abc&lang=en&pot=CACHED"), response: "" });
  assert.deepEqual(plain(await page.load()), GOOD_CUES);
  assert.equal(page.fetchCalls.length, 2);
  assert.ok(page.fetchCalls[1].input.includes("pot=AUDIO"));
});

test("page: 同一个拼出来的地址取不到字幕后不重复请求", async () => {
  const page = mintPage({
    response: mintResponse,
    audio: { captionTracks: [{ url: timedtext("v=abc&lang=en&pot=P") }] },
    fetchImpl: serving(""),
  });
  assert.deepEqual(plain(await page.load()), []);
  assert.equal(page.fetchCalls.length, 1);
});

// ---- load() 流程 ----
test("page: 页面地址没有视频编号时返回空数组", async () => {
  const page = loadPage({ url: "https://www.youtube.com/" });
  const before = page.clock.now;
  assert.deepEqual(plain(await page.load()), []);
  assert.equal(page.clock.now, before);
});

test("page: 等待超过 8 秒仍没有字幕就返回空数组", async () => {
  const page = loadPage();
  const start = page.clock.now;
  assert.deepEqual(plain(await page.load()), []);
  assert.ok(page.clock.now - start >= 8000);
  assert.ok(page.clock.now - start < 8000 + 300);
});

test("page: 等待期间页面请求到了字幕就立刻返回", async () => {
  const page = loadPage();
  onSleep(page, (count) => {
    if (count === 2) page.captureTimedtext(GOOD);
  });
  const start = page.clock.now;
  assert.deepEqual(plain(await page.load()), GOOD_CUES);
  assert.equal(page.clock.now - start, 600);
});

test("page: 等待期间抓到带 pot 的地址就去取", async () => {
  const page = loadPage({ fetchImpl: serving(GOOD) });
  onSleep(page, (count) => {
    if (count === 1) page.xhr({ url: timedtext("v=abc&lang=en&pot=LATE"), response: "" });
  });
  assert.deepEqual(plain(await page.load()), GOOD_CUES);
  assert.equal(page.fetchCalls.length, 1);
});

test("page: 等待期间用户切到别的视频就放弃并返回空数组", async () => {
  const page = loadPage();
  onSleep(page, (count) => {
    if (count === 2) navigate(page.window, "/watch?v=def");
  });
  const start = page.clock.now;
  assert.deepEqual(plain(await page.load()), []);
  assert.equal(page.clock.now - start, 600);
});

test("page: 取地址的过程中切了视频，取到的字幕作废", async () => {
  const page = loadPage({
    fetchImpl: () => {
      navigate(page.window, "/watch?v=def");
      return Promise.resolve(fakeResponse({ body: GOOD }));
    },
  });
  page.xhr({ url: timedtext("v=abc&lang=en&pot=TOKEN"), response: "" });
  assert.deepEqual(plain(await page.load()), []);
  assert.equal(page.fetchCalls.length, 1);
});

test("page: 取地址失败时继续等待，不重复请求同一个地址", async () => {
  const failures = [
    () => Promise.reject(new Error("网络错误")),
    () => Promise.resolve({ text: () => Promise.reject(new Error("读取失败")) }),
  ];
  for (const fetchImpl of failures) {
    const page = loadPage({ fetchImpl });
    page.xhr({ url: timedtext("v=abc&lang=en&pot=TOKEN"), response: "" });
    assert.deepEqual(plain(await page.load()), []);
    assert.equal(page.fetchCalls.length, 1);
  }
});

test("page: 最后一次等待期间收到的字幕也会返回", async () => {
  const page = loadPage();
  const start = page.clock.now;
  onSleep(page, () => {
    if (page.clock.now >= start + 8000) page.captureTimedtext(GOOD);
  });
  assert.deepEqual(plain(await page.load()), GOOD_CUES);
});

test("page: 最后一次等待期间切了视频就返回空数组", async () => {
  const page = loadPage();
  const start = page.clock.now;
  onSleep(page, () => {
    if (page.clock.now >= start + 8000) {
      page.captureTimedtext(GOOD);
      navigate(page.window, "/watch?v=def");
    }
  });
  assert.deepEqual(plain(await page.load()), []);
});

test("page: 取地址耗时超过期限后不再继续等待", async () => {
  const page = loadPage({
    fetchImpl: () => {
      page.clock.now += 9000;
      return Promise.resolve(fakeResponse({ body: "" }));
    },
  });
  page.xhr({ url: timedtext("v=abc&lang=en&pot=TOKEN"), response: "" });
  const start = page.clock.now;
  assert.deepEqual(plain(await page.load()), []);
  assert.equal(page.clock.now - start, 9000 + 300);
});
