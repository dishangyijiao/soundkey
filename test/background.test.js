const test = require("node:test");
const assert = require("node:assert/strict");
const { loadBackground, dispatchMessage, flush, plain } = require("./helpers/scripts.js");

const OPEN_ORIGINAL = { ok: false, error: "打开原来的视频才能听原声" };

// ---- startup ----
test("background: at startup, makes clicking the extension icon open the side panel directly", () => {
  const { calls } = loadBackground();
  assert.deepEqual(plain(calls.setPanelBehavior), [{ openPanelOnActionClick: true }]);
});

test("background: does not raise an unhandled rejection when setting the side panel behavior fails", async () => {
  loadBackground({ setPanelBehavior: () => Promise.reject(new Error("不支持")) });
  await flush();
});

// ---- the side panel is available only on YouTube ----
const PANEL = (tabId, enabled) => ({ tabId, path: "sidepanel.html", enabled });

test("background: the side panel is off by default and switched on for the YouTube tabs already open", () => {
  // A tab without an id must be skipped: setOptions without a tab id would switch the panel on for every tab.
  const { calls } = loadBackground({ tabs: [{ id: 4 }, { id: 0 }, {}, { id: null }] });
  assert.deepEqual(plain(calls.setOptions[0]), { enabled: false });
  assert.deepEqual(plain(calls.tabsQuery[0]), { url: "https://www.youtube.com/*" });
  assert.deepEqual(plain(calls.setOptions.slice(1)), [PANEL(4, true), PANEL(0, true)]);
});

test("background: a tab that moves to YouTube gets the side panel, and one that leaves it loses it", () => {
  const { onTabUpdated, calls } = loadBackground();
  const before = calls.setOptions.length;
  onTabUpdated(7, { url: "https://www.youtube.com/watch?v=a" }, { url: "https://www.youtube.com/watch?v=a" });
  onTabUpdated(7, { url: "https://example.com/" }, { url: "https://example.com/" });
  assert.deepEqual(plain(calls.setOptions.slice(before)), [PANEL(7, true), PANEL(7, false)]);
});

test("background: only https://www.youtube.com counts as YouTube", () => {
  const { onTabUpdated, calls } = loadBackground();
  const before = calls.setOptions.length;
  const urls = [
    "http://www.youtube.com/watch?v=a",
    "https://www.youtube.com.example.com/",
    "https://music.youtube.com/",
    "https://example.com/?next=https://www.youtube.com/",
    "chrome://extensions",
  ];
  urls.forEach((url, index) => onTabUpdated(index, { url }, { url }));
  assert.deepEqual(plain(calls.setOptions.slice(before)), urls.map((_, index) => PANEL(index, false)));
});

test("background: a tab update that does not change the address leaves the side panel alone", () => {
  const { onTabUpdated, calls } = loadBackground();
  const before = calls.setOptions.length;
  onTabUpdated(7, { title: "x" }, { url: "https://www.youtube.com/watch?v=a" });
  onTabUpdated(7, { status: "complete" }, { url: "https://www.youtube.com/watch?v=a" });
  assert.equal(calls.setOptions.length, before);
});

test("background: a tab address the extension may not read is treated as not YouTube", () => {
  const { onTabUpdated, calls } = loadBackground();
  const before = calls.setOptions.length;
  onTabUpdated(3, { url: "https://example.org/" }, {});
  assert.deepEqual(plain(calls.setOptions.slice(before)), [PANEL(3, false)]);
});

test("background: does not raise an unhandled rejection when switching the side panel fails", async () => {
  const { onTabUpdated } = loadBackground({ setOptions: () => Promise.reject(new Error("没有这个标签页")) });
  onTabUpdated(7, { url: "https://www.youtube.com/" }, { url: "https://www.youtube.com/" });
  await flush();
});

// ---- onInstalled ----
test("background: after an install or update, reloads every open YouTube tab", () => {
  for (const reason of ["install", "update"]) {
    const { onInstalled, calls, behavior } = loadBackground();
    behavior.tabs = [{ id: 3 }, { id: 0 }, { id: 9 }];
    const queriesAtStartup = calls.tabsQuery.length;
    onInstalled({ reason });
    assert.deepEqual(plain(calls.tabsQuery.slice(queriesAtStartup)), [{ url: "https://www.youtube.com/*" }], reason);
    assert.deepEqual(calls.reload, [3, 0, 9], reason);
  }
});

test("background: for other reasons (browser update, shared module update) does not reload tabs", () => {
  const { onInstalled, calls, behavior } = loadBackground();
  behavior.tabs = [{ id: 3 }];
  const queriesAtStartup = calls.tabsQuery.length;
  for (const reason of ["chrome_update", "shared_module_update"]) onInstalled({ reason });
  assert.equal(calls.tabsQuery.length, queriesAtStartup, "onInstalled queried tabs for a reason that does not reload");
  assert.deepEqual(calls.reload, []);
});

test("background: a tab without an id is not reloaded", () => {
  const { onInstalled, calls, behavior } = loadBackground();
  behavior.tabs = [{}, { id: null }, { id: undefined }, { id: 5 }];
  onInstalled({ reason: "install" });
  assert.deepEqual(calls.reload, [5]);
});

// ---- cue / get-cue ----
test("background: get-cue answers no-video when no captions were ever received", () => {
  const { onMessage } = loadBackground();
  const { returned, responses } = dispatchMessage(onMessage, { type: "get-cue" });
  assert.equal(returned, undefined);
  assert.deepEqual(plain(responses), [{ cue: null, state: "no-video" }]);
});

test("background: stores the captions the page sent and get-cue returns them unchanged", () => {
  const { onMessage } = loadBackground();
  const cue = { text: "Hello", startMs: 0, endMs: 900, videoId: "abc" };
  const stored = dispatchMessage(onMessage, { type: "cue", cue, state: "ok" }, { tab: { id: 7 } });
  assert.equal(stored.returned, undefined);
  assert.deepEqual(stored.responses, []);
  const { responses } = dispatchMessage(onMessage, { type: "get-cue" });
  assert.deepEqual(plain(responses), [{ cue, state: "ok" }]);
});

test("background: captions older than 5 seconds are stale, exactly 5 seconds is still fresh", () => {
  const { onMessage, clock } = loadBackground();
  dispatchMessage(onMessage, { type: "cue", cue: { text: "Hi" }, state: "ok" }, { tab: { id: 1 } });
  clock.now += 5000;
  assert.equal(dispatchMessage(onMessage, { type: "get-cue" }).responses[0].state, "ok");
  clock.now += 1;
  assert.deepEqual(plain(dispatchMessage(onMessage, { type: "get-cue" }).responses), [
    { cue: null, state: "no-video" },
  ]);
});

test("background: a new caption message refreshes the time and overwrites the old one", () => {
  const { onMessage, clock } = loadBackground();
  dispatchMessage(onMessage, { type: "cue", cue: { text: "old" }, state: "ok" }, { tab: { id: 1 } });
  clock.now += 4000;
  dispatchMessage(onMessage, { type: "cue", cue: { text: "new" }, state: "ok" }, { tab: { id: 1 } });
  clock.now += 4000;
  assert.deepEqual(plain(dispatchMessage(onMessage, { type: "get-cue" }).responses), [
    { cue: { text: "new" }, state: "ok" },
  ]);
});

// ---- adjust-cue / reset-cue (removed with the manual range controls) ----
test("background: adjust-cue and reset-cue are not forwarded: sentence boundaries are found by the program", () => {
  const { onMessage, calls } = loadBackground();
  dispatchMessage(onMessage, { type: "cue", cue: null, state: "ok" }, { tab: { id: 42 } });
  dispatchMessage(onMessage, { type: "adjust-cue", edge: "end", delta: 1 });
  dispatchMessage(onMessage, { type: "reset-cue" });
  assert.deepEqual(calls.tabsSendMessage, []);
});

// ---- load-cues ----
test("background: load-cues reads the captions in the page's main world and answers the requester", async () => {
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

test("background: the injected function uses the page loader when there is one, and answers an empty array when there is not", () => {
  const { onMessage, calls, window } = loadBackground();
  dispatchMessage(onMessage, { type: "load-cues" }, { tab: { id: 11 } });
  const read = calls.executeScript[0].func;
  assert.deepEqual(plain(read()), []);
  window.__soundkeyLoad = () => [{ text: "x" }];
  assert.deepEqual(plain(read()), [{ text: "x" }]);
  window.__soundkeyLoad = "不是函数";
  assert.deepEqual(plain(read()), []);
});

test("background: load-cues answers an empty array when there is no result", async () => {
  const shapes = [undefined, [], [{}], [{ result: null }], [{ result: undefined }]];
  for (const shape of shapes) {
    const { onMessage, behavior } = loadBackground();
    behavior.executeScript = () => Promise.resolve(shape);
    const { responses } = dispatchMessage(onMessage, { type: "load-cues" }, { tab: { id: 1 } });
    await flush();
    assert.deepEqual(plain(responses), [{ cues: [] }], JSON.stringify(shape));
  }
});

test("background: load-cues answers an empty array when injection fails", async () => {
  const { onMessage, behavior } = loadBackground();
  behavior.executeScript = () => Promise.reject(new Error("无法注入"));
  const { returned, responses } = dispatchMessage(onMessage, { type: "load-cues" }, { tab: { id: 1 } });
  assert.equal(returned, true);
  await flush();
  assert.deepEqual(plain(responses), [{ cues: [] }]);
});

test("background: load-cues answers an empty array at once when the sender tab cannot be found", () => {
  const { onMessage, calls } = loadBackground();
  for (const sender of [{}, { tab: {} }, { tab: { id: 0 } }]) {
    const { returned, responses } = dispatchMessage(onMessage, { type: "load-cues" }, sender);
    assert.equal(returned, undefined);
    assert.deepEqual(plain(responses), [{ cues: [] }]);
  }
  assert.deepEqual(calls.executeScript, []);
});

// ---- play-range ----
test("background: play-range forwards the request to the tab playing the same video and returns the result", () => {
  const { onMessage, calls, behavior } = loadBackground();
  behavior.tabs = [
    { id: 1, url: "https://www.youtube.com/watch?v=other" },
    { id: 2, url: "https://www.youtube.com/watch?v=abc&t=3" },
  ];
  behavior.tabsSendMessageResponse = { ok: true };
  const message = { type: "play-range", videoId: "abc", startMs: 1000, endMs: 3000 };
  const queriesAtStartup = calls.tabsQuery.length;
  const { returned, responses } = dispatchMessage(onMessage, message);
  assert.equal(returned, true);
  assert.deepEqual(plain(calls.tabsQuery.slice(queriesAtStartup)), [{ url: "https://www.youtube.com/watch*" }]);
  assert.deepEqual(plain(calls.tabsSendMessage), [{ tabId: 2, message }]);
  assert.deepEqual(plain(responses), [{ ok: true }]);
});

test("background: play-range asks the user to open the original video when no tab matches the video", () => {
  const { onMessage, behavior, calls } = loadBackground();
  behavior.tabs = [{ id: 1, url: "https://www.youtube.com/watch?v=other" }];
  const { returned, responses } = dispatchMessage(onMessage, { type: "play-range", videoId: "abc" });
  assert.equal(returned, true);
  assert.deepEqual(plain(responses), [OPEN_ORIGINAL]);
  assert.deepEqual(calls.tabsSendMessage, []);
});

test("background: play-range asks the user to open the original video when there is no tab, the tab has no URL or it has no id", () => {
  for (const tabs of [[], [{ id: 4 }], [{ id: undefined, url: "https://www.youtube.com/watch?v=abc" }]]) {
    const { onMessage, behavior, calls } = loadBackground();
    behavior.tabs = tabs;
    const { responses } = dispatchMessage(onMessage, { type: "play-range", videoId: "abc" });
    assert.deepEqual(plain(responses), [OPEN_ORIGINAL], JSON.stringify(tabs));
    assert.deepEqual(calls.tabsSendMessage, []);
  }
});

test("background: play-range asks the user to open the original video when sending to the tab fails (lastError)", () => {
  const { onMessage, behavior } = loadBackground();
  behavior.tabs = [{ id: 2, url: "https://www.youtube.com/watch?v=abc" }];
  behavior.tabsSendMessageError = "Receiving end does not exist.";
  behavior.tabsSendMessageResponse = { ok: true };
  const { responses } = dispatchMessage(onMessage, { type: "play-range", videoId: "abc" });
  assert.deepEqual(plain(responses), [OPEN_ORIGINAL]);
});

test("background: play-range asks the user to open the original video when the tab gives no response", () => {
  const { onMessage, behavior } = loadBackground();
  behavior.tabs = [{ id: 2, url: "https://www.youtube.com/watch?v=abc" }];
  behavior.tabsSendMessageResponse = undefined;
  const { responses } = dispatchMessage(onMessage, { type: "play-range", videoId: "abc" });
  assert.deepEqual(plain(responses), [OPEN_ORIGINAL]);
});

test("background: play-range returns the failure the tab reported, unchanged", () => {
  const { onMessage, behavior } = loadBackground();
  behavior.tabs = [{ id: 2, url: "https://www.youtube.com/watch?v=abc" }];
  behavior.tabsSendMessageResponse = { ok: false, error: "别的错误" };
  const { responses } = dispatchMessage(onMessage, { type: "play-range", videoId: "abc" });
  assert.deepEqual(plain(responses), [{ ok: false, error: "别的错误" }]);
});

// ---- other ----
test("background: ignores a message it does not know, without responding", () => {
  const { onMessage, calls } = loadBackground();
  const { returned, responses } = dispatchMessage(onMessage, { type: "unknown" }, { tab: { id: 1 } });
  assert.equal(returned, undefined);
  assert.deepEqual(responses, []);
  assert.deepEqual(calls.tabsSendMessage, []);
  assert.deepEqual(calls.executeScript, []);
});
