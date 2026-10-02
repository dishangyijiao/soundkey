const test = require("node:test");
const assert = require("node:assert/strict");
const { loadBackground, dispatchMessage, flush, plain } = require("./helpers/scripts.js");

const OPEN_ORIGINAL = { ok: false, error: "打开原来的视频才能听原声" };

// ---- 启动 ----
test("background: 启动时让点击扩展图标直接打开侧边栏", () => {
  const { calls } = loadBackground();
  assert.deepEqual(plain(calls.setPanelBehavior), [{ openPanelOnActionClick: true }]);
});

test("background: 设置侧边栏行为失败时不抛未处理的拒绝", async () => {
  loadBackground({ setPanelBehavior: () => Promise.reject(new Error("不支持")) });
  await flush();
});

// ---- onInstalled ----
test("background: 安装或更新后刷新所有打开的 YouTube 标签页", () => {
  for (const reason of ["install", "update"]) {
    const { onInstalled, calls, behavior } = loadBackground();
    behavior.tabs = [{ id: 3 }, { id: 0 }, { id: 9 }];
    onInstalled({ reason });
    assert.deepEqual(plain(calls.tabsQuery), [{ url: "https://www.youtube.com/*" }], reason);
    assert.deepEqual(calls.reload, [3, 0, 9], reason);
  }
});

test("background: 其他原因（浏览器更新、共享模块更新）不刷新标签页", () => {
  const { onInstalled, calls, behavior } = loadBackground();
  behavior.tabs = [{ id: 3 }];
  for (const reason of ["chrome_update", "shared_module_update"]) onInstalled({ reason });
  assert.deepEqual(calls.tabsQuery, []);
  assert.deepEqual(calls.reload, []);
});

test("background: 没有 id 的标签页不会被刷新", () => {
  const { onInstalled, calls, behavior } = loadBackground();
  behavior.tabs = [{}, { id: null }, { id: undefined }, { id: 5 }];
  onInstalled({ reason: "install" });
  assert.deepEqual(calls.reload, [5]);
});

// ---- cue / get-cue ----
test("background: 没收到过字幕时 get-cue 回 no-video", () => {
  const { onMessage } = loadBackground();
  const { returned, responses } = dispatchMessage(onMessage, { type: "get-cue" });
  assert.equal(returned, undefined);
  assert.deepEqual(plain(responses), [{ cue: null, state: "no-video" }]);
});

test("background: 存下页面发来的字幕，get-cue 原样取回", () => {
  const { onMessage } = loadBackground();
  const cue = { text: "Hello", startMs: 0, endMs: 900, videoId: "abc" };
  const stored = dispatchMessage(onMessage, { type: "cue", cue, state: "ok" }, { tab: { id: 7 } });
  assert.equal(stored.returned, undefined);
  assert.deepEqual(stored.responses, []);
  const { responses } = dispatchMessage(onMessage, { type: "get-cue" });
  assert.deepEqual(plain(responses), [{ cue, state: "ok" }]);
});

test("background: 字幕超过 5 秒没更新就算过期，刚好 5 秒还算新鲜", () => {
  const { onMessage, clock } = loadBackground();
  dispatchMessage(onMessage, { type: "cue", cue: { text: "Hi" }, state: "ok" }, { tab: { id: 1 } });
  clock.now += 5000;
  assert.equal(dispatchMessage(onMessage, { type: "get-cue" }).responses[0].state, "ok");
  clock.now += 1;
  assert.deepEqual(plain(dispatchMessage(onMessage, { type: "get-cue" }).responses), [
    { cue: null, state: "no-video" },
  ]);
});

test("background: 新的字幕消息会刷新时间并覆盖旧的", () => {
  const { onMessage, clock } = loadBackground();
  dispatchMessage(onMessage, { type: "cue", cue: { text: "old" }, state: "ok" }, { tab: { id: 1 } });
  clock.now += 4000;
  dispatchMessage(onMessage, { type: "cue", cue: { text: "new" }, state: "ok" }, { tab: { id: 1 } });
  clock.now += 4000;
  assert.deepEqual(plain(dispatchMessage(onMessage, { type: "get-cue" }).responses), [
    { cue: { text: "new" }, state: "ok" },
  ]);
});

// ---- adjust-cue / reset-cue ----
test("background: adjust-cue 和 reset-cue 转发给发来字幕的标签页", () => {
  const { onMessage, calls } = loadBackground();
  dispatchMessage(onMessage, { type: "cue", cue: null, state: "ok" }, { tab: { id: 42 } });
  const adjust = { type: "adjust-cue", edge: "end", delta: 1 };
  const reset = { type: "reset-cue" };
  assert.equal(dispatchMessage(onMessage, adjust).returned, undefined);
  assert.equal(dispatchMessage(onMessage, reset).returned, undefined);
  assert.deepEqual(plain(calls.tabsSendMessage), [
    { tabId: 42, message: adjust },
    { tabId: 42, message: reset },
  ]);
});

test("background: 标签页 id 为 0 也照常转发", () => {
  const { onMessage, calls } = loadBackground();
  dispatchMessage(onMessage, { type: "cue", cue: null, state: "ok" }, { tab: { id: 0 } });
  dispatchMessage(onMessage, { type: "reset-cue" });
  assert.equal(calls.tabsSendMessage.length, 1);
  assert.equal(calls.tabsSendMessage[0].tabId, 0);
});

test("background: 没有收到过字幕时 adjust-cue 不转发", () => {
  const { onMessage, calls } = loadBackground();
  dispatchMessage(onMessage, { type: "adjust-cue", edge: "start", delta: -1 });
  dispatchMessage(onMessage, { type: "reset-cue" });
  assert.deepEqual(calls.tabsSendMessage, []);
});

test("background: 字幕消息不带标签页时，没有可转发的对象", () => {
  const { onMessage, calls } = loadBackground();
  dispatchMessage(onMessage, { type: "cue", cue: null, state: "no-video" });
  dispatchMessage(onMessage, { type: "reset-cue" });
  assert.deepEqual(calls.tabsSendMessage, []);
});

test("background: 转发失败（标签页已关）时吞掉拒绝", async () => {
  const { onMessage, calls, behavior } = loadBackground();
  behavior.tabsSendMessagePromise = () => Promise.reject(new Error("没有接收方"));
  dispatchMessage(onMessage, { type: "cue", cue: null, state: "ok" }, { tab: { id: 8 } });
  dispatchMessage(onMessage, { type: "adjust-cue", edge: "start", delta: 1 });
  await flush();
  assert.equal(calls.tabsSendMessage.length, 1);
});

// ---- load-cues ----
test("background: load-cues 在页面主世界读字幕并回给请求方", async () => {
  const { onMessage, calls, behavior } = loadBackground();
  const cues = [{ text: "Hi", startMs: 0, endMs: 1000 }];
  behavior.executeScript = () => Promise.resolve([{ result: cues }]);
  const { returned, responses } = dispatchMessage(onMessage, { type: "load-cues" }, { tab: { id: 11 } });
  assert.equal(returned, true);
  assert.deepEqual(responses, []);
  await flush();
  assert.deepEqual(plain(responses), [{ cues }]);
  assert.equal(calls.executeScript.length, 1);
  const details = calls.executeScript[0];
  assert.deepEqual(plain({ target: details.target, world: details.world }), {
    target: { tabId: 11 },
    world: "MAIN",
  });
  assert.equal(typeof details.func, "function");
});

test("background: 注入的函数有页面加载器就用它，没有就回空数组", () => {
  const { onMessage, calls, window } = loadBackground();
  dispatchMessage(onMessage, { type: "load-cues" }, { tab: { id: 11 } });
  const read = calls.executeScript[0].func;
  assert.deepEqual(plain(read()), []);
  window.__fengsongLoad = () => [{ text: "x" }];
  assert.deepEqual(plain(read()), [{ text: "x" }]);
  window.__fengsongLoad = "不是函数";
  assert.deepEqual(plain(read()), []);
});

test("background: load-cues 没有结果时回空数组", async () => {
  const shapes = [undefined, [], [{}], [{ result: null }], [{ result: undefined }]];
  for (const shape of shapes) {
    const { onMessage, behavior } = loadBackground();
    behavior.executeScript = () => Promise.resolve(shape);
    const { responses } = dispatchMessage(onMessage, { type: "load-cues" }, { tab: { id: 1 } });
    await flush();
    assert.deepEqual(plain(responses), [{ cues: [] }], JSON.stringify(shape));
  }
});

test("background: load-cues 注入失败时回空数组", async () => {
  const { onMessage, behavior } = loadBackground();
  behavior.executeScript = () => Promise.reject(new Error("无法注入"));
  const { returned, responses } = dispatchMessage(onMessage, { type: "load-cues" }, { tab: { id: 1 } });
  assert.equal(returned, true);
  await flush();
  assert.deepEqual(plain(responses), [{ cues: [] }]);
});

test("background: load-cues 找不到发送方标签页时立刻回空数组", () => {
  const { onMessage, calls } = loadBackground();
  for (const sender of [{}, { tab: {} }, { tab: { id: 0 } }]) {
    const { returned, responses } = dispatchMessage(onMessage, { type: "load-cues" }, sender);
    assert.equal(returned, undefined);
    assert.deepEqual(plain(responses), [{ cues: [] }]);
  }
  assert.deepEqual(calls.executeScript, []);
});

// ---- play-range ----
test("background: play-range 把请求转给播放同一个视频的标签页并回传结果", () => {
  const { onMessage, calls, behavior } = loadBackground();
  behavior.tabs = [
    { id: 1, url: "https://www.youtube.com/watch?v=other" },
    { id: 2, url: "https://www.youtube.com/watch?v=abc&t=3" },
  ];
  behavior.tabsSendMessageResponse = { ok: true };
  const message = { type: "play-range", videoId: "abc", startMs: 1000, endMs: 3000 };
  const { returned, responses } = dispatchMessage(onMessage, message);
  assert.equal(returned, true);
  assert.deepEqual(plain(calls.tabsQuery), [{ url: "https://www.youtube.com/watch*" }]);
  assert.deepEqual(plain(calls.tabsSendMessage), [{ tabId: 2, message }]);
  assert.deepEqual(plain(responses), [{ ok: true }]);
});

test("background: play-range 找不到对应视频的标签页时提示打开原视频", () => {
  const { onMessage, behavior, calls } = loadBackground();
  behavior.tabs = [{ id: 1, url: "https://www.youtube.com/watch?v=other" }];
  const { returned, responses } = dispatchMessage(onMessage, { type: "play-range", videoId: "abc" });
  assert.equal(returned, true);
  assert.deepEqual(plain(responses), [OPEN_ORIGINAL]);
  assert.deepEqual(calls.tabsSendMessage, []);
});

test("background: play-range 没有标签页、标签页没有网址或没有 id 时都提示打开原视频", () => {
  for (const tabs of [[], [{ id: 4 }], [{ id: undefined, url: "https://www.youtube.com/watch?v=abc" }]]) {
    const { onMessage, behavior, calls } = loadBackground();
    behavior.tabs = tabs;
    const { responses } = dispatchMessage(onMessage, { type: "play-range", videoId: "abc" });
    assert.deepEqual(plain(responses), [OPEN_ORIGINAL], JSON.stringify(tabs));
    assert.deepEqual(calls.tabsSendMessage, []);
  }
});

test("background: play-range 发给标签页出错（lastError）时提示打开原视频", () => {
  const { onMessage, behavior } = loadBackground();
  behavior.tabs = [{ id: 2, url: "https://www.youtube.com/watch?v=abc" }];
  behavior.tabsSendMessageError = "Receiving end does not exist.";
  behavior.tabsSendMessageResponse = { ok: true };
  const { responses } = dispatchMessage(onMessage, { type: "play-range", videoId: "abc" });
  assert.deepEqual(plain(responses), [OPEN_ORIGINAL]);
});

test("background: play-range 标签页没有给出响应时提示打开原视频", () => {
  const { onMessage, behavior } = loadBackground();
  behavior.tabs = [{ id: 2, url: "https://www.youtube.com/watch?v=abc" }];
  behavior.tabsSendMessageResponse = undefined;
  const { responses } = dispatchMessage(onMessage, { type: "play-range", videoId: "abc" });
  assert.deepEqual(plain(responses), [OPEN_ORIGINAL]);
});

test("background: play-range 把标签页返回的失败原样回传", () => {
  const { onMessage, behavior } = loadBackground();
  behavior.tabs = [{ id: 2, url: "https://www.youtube.com/watch?v=abc" }];
  behavior.tabsSendMessageResponse = { ok: false, error: "别的错误" };
  const { responses } = dispatchMessage(onMessage, { type: "play-range", videoId: "abc" });
  assert.deepEqual(plain(responses), [{ ok: false, error: "别的错误" }]);
});

// ---- 其他 ----
test("background: 不认识的消息不处理也不回应", () => {
  const { onMessage, calls } = loadBackground();
  const { returned, responses } = dispatchMessage(onMessage, { type: "unknown" }, { tab: { id: 1 } });
  assert.equal(returned, undefined);
  assert.deepEqual(responses, []);
  assert.deepEqual(calls.tabsSendMessage, []);
  assert.deepEqual(calls.executeScript, []);
});
