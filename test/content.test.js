const test = require("node:test");
const assert = require("node:assert/strict");
const { dispatchMessage, flush, loadContent, navigate, plain } = require("./helpers/scripts.js");

const OPEN_ORIGINAL = { ok: false, error: "打开原来的视频才能听原声" };

// Automatic sentence splitting: [0,1] and [2,3].
const CUES = [
  { text: "Hello", startMs: 0, endMs: 1000 },
  { text: "world.", startMs: 1000, endMs: 2000 },
  { text: "Next", startMs: 2000, endMs: 3000 },
  { text: "one.", startMs: 3000, endMs: 4000 },
];

function setup({ cues = CUES, currentTime = 0, ...options } = {}) {
  const loadTimes = [];
  const env = loadContent({
    currentTime,
    ...options,
    chromeOverrides: {
      sendMessage: (message) => {
        if (message.type !== "load-cues") return undefined;
        loadTimes.push(env.clock.now);
        return Promise.resolve({ cues });
      },
      ...options.chromeOverrides,
    },
  });
  env.loadTimes = loadTimes;
  env.step = async (ms = 300) => {
    env.clock.advance(ms);
    await flush();
  };
  // The first publish triggers the load; only the second carries captions.
  env.ready = async () => {
    await env.step();
    await env.step();
  };
  return env;
}

const cueOf = (env) => env.lastCue();

// ---- publishing rhythm ----
test("content: publishes the captions every 300ms after loading", () => {
  const env = setup();
  assert.deepEqual(
    env.clock.intervals().map((timer) => timer.ms),
    [300],
  );
  assert.equal(env.cueMessages().length, 0);
  env.clock.advance(900);
  assert.equal(env.cueMessages().length, 3);
});

// ---- no video ----
test("content: publishes no-video when the page has no video", async () => {
  const env = setup({ video: false });
  await env.step();
  assert.deepEqual(cueOf(env), { type: "cue", cue: null, state: "no-video" });
  assert.equal(env.loadCuesCalls(), 0);
});

test("content: publishes no-video when not on a /watch page or without a v parameter", async () => {
  for (const url of ["https://www.youtube.com/feed/subscriptions?v=abc", "https://www.youtube.com/watch"]) {
    const env = setup({ url });
    await env.step();
    assert.deepEqual(cueOf(env), { type: "cue", cue: null, state: "no-video" }, url);
    assert.equal(env.loadCuesCalls(), 0, url);
  }
});

test("content: after the video disappears, clears the old captions, and reloads when it comes back", async () => {
  const env = setup();
  await env.ready();
  assert.equal(cueOf(env).state, "ok");
  env.video.remove();
  await env.step();
  assert.deepEqual(cueOf(env), { type: "cue", cue: null, state: "no-video" });
  env.document.body.append(env.video);
  await env.step();
  assert.deepEqual(cueOf(env), { type: "cue", cue: null, state: "no-caption" });
  assert.equal(env.loadCuesCalls(), 2);
});

// ---- loading captions ----
test("content: asks the background for captions first, shows no-caption until loading finishes, then the current sentence", async () => {
  const env = setup();
  await env.step();
  assert.deepEqual(cueOf(env), { type: "cue", cue: null, state: "no-caption" });
  assert.deepEqual(plain(env.calls.sendMessage[0]), { type: "load-cues" });
  await env.step();
  assert.deepEqual(cueOf(env), {
    type: "cue",
    state: "ok",
    cue: { text: "Hello world.", startMs: 0, endMs: 2000, videoId: "abc" },
  });
});

test("content: does not request again once the captions have loaded", async () => {
  const env = setup();
  await env.ready();
  await env.step();
  await env.step();
  assert.equal(env.loadCuesCalls(), 1);
});

test("content: does not send a second request while a load is still pending", async () => {
  let release;
  const env = setup({
    chromeOverrides: {
      sendMessage: (message) =>
        message.type === "load-cues"
          ? new Promise((resolve) => {
              release = () => resolve({ cues: CUES });
            })
          : undefined,
    },
  });
  await env.step();
  await env.step();
  await env.step();
  assert.equal(env.loadCuesCalls(), 1);
  release();
  await flush();
  await env.step();
  assert.equal(cueOf(env).state, "ok");
  assert.equal(env.loadCuesCalls(), 1);
});

test("content: after switching to another video, drops the old captions and loads again", async () => {
  const env = setup();
  await env.ready();
  navigate(env.window, "/watch?v=def");
  await env.step();
  assert.deepEqual(cueOf(env), { type: "cue", cue: null, state: "no-caption" });
  assert.equal(env.loadCuesCalls(), 2);
  await env.step();
  assert.equal(cueOf(env).cue.videoId, "def");
});

test("content: when the background has no captions or the request fails, tries 8 times in a row and then once every 10 seconds", async () => {
  const behaviors = {
    "空数组": () => Promise.resolve({ cues: [] }),
    "没有 cues 字段": () => Promise.resolve({}),
    "没有响应": () => Promise.resolve(undefined),
    "请求被拒绝": () => Promise.reject(new Error("Could not establish connection")),
  };
  for (const [name, reply] of Object.entries(behaviors)) {
    const env = setup({
      chromeOverrides: {
        sendMessage: (message) => {
          if (message.type !== "load-cues") return undefined;
          env.loadTimes.push(env.clock.now);
          return reply();
        },
      },
    });
    for (let index = 0; index < 20; index += 1) await env.step();
    assert.equal(env.loadCuesCalls(), 8, name);
    assert.equal(cueOf(env).state, "no-caption", name);
    // The gap is exactly 10 seconds and does not retry yet; one more millisecond does.
    env.clock.now = env.loadTimes.at(-1) + 10000;
    env.clock.tickIntervals();
    await flush();
    assert.equal(env.loadCuesCalls(), 8, name);
    env.clock.now += 1;
    env.clock.tickIntervals();
    await flush();
    assert.equal(env.loadCuesCalls(), 9, name);
  }
});

test("content: resets the failure count after a successful load, and can retry at once after a video change", async () => {
  let ok = false;
  const env = setup({
    chromeOverrides: {
      sendMessage: (message) =>
        message.type === "load-cues" ? Promise.resolve({ cues: ok ? CUES : [] }) : undefined,
    },
  });
  for (let index = 0; index < 10; index += 1) await env.step();
  assert.equal(env.loadCuesCalls(), 8);
  navigate(env.window, "/watch?v=def");
  await env.step();
  await env.step();
  assert.equal(env.loadCuesCalls(), 10);
  ok = true;
  await env.step();
  await env.step();
  assert.equal(cueOf(env).state, "ok");
});

// ---- current sentence ----
test("content: when the current time falls inside a caption piece, uses the whole sentence that piece belongs to", async () => {
  const env = setup({ currentTime: 2.5 });
  await env.ready();
  assert.deepEqual(cueOf(env).cue, { text: "Next one.", startMs: 2000, endMs: 4000, videoId: "abc" });
});

test("content: the start of a caption piece is included and its end is not", async () => {
  const env = setup({ currentTime: 1 });
  await env.ready();
  assert.equal(cueOf(env).cue.text, "Hello world.");
  env.video.currentTime = 2;
  await env.step();
  assert.equal(cueOf(env).cue.text, "Next one.");
});

test("content: when the time is between two caption pieces, stays on the earlier one", async () => {
  const gap = [
    { text: "First.", startMs: 0, endMs: 1000 },
    { text: "Second.", startMs: 5000, endMs: 6000 },
  ];
  const env = setup({ cues: gap, currentTime: 2 });
  await env.ready();
  assert.equal(cueOf(env).cue.text, "First.");
});

test("content: when the time is after the last piece, stays on the last piece", async () => {
  const env = setup({ currentTime: 99 });
  await env.ready();
  assert.equal(cueOf(env).cue.text, "Next one.");
});

test("content: when the time is before the first piece, shows the first piece", async () => {
  const late = [
    { text: "Late.", startMs: 3000, endMs: 4000 },
    { text: "Later.", startMs: 5000, endMs: 6000 },
  ];
  const env = setup({ cues: late, currentTime: 1 });
  await env.ready();
  assert.equal(cueOf(env).cue.text, "Late.");
});

// ---- manual adjustment ----
test("content: adjust-cue does nothing before any caption has been shown", async () => {
  const env = setup();
  const { returned, responses } = dispatchMessage(env.onMessage, { type: "adjust-cue", edge: "end", delta: 1 });
  assert.equal(returned, undefined);
  assert.deepEqual(responses, []);
  assert.equal(env.cueMessages().length, 0);
});

test("content: adjust-cue moves the sentence boundary and republishes at once", async () => {
  const env = setup();
  await env.ready();
  const before = env.cueMessages().length;
  dispatchMessage(env.onMessage, { type: "adjust-cue", edge: "end", delta: 1 });
  assert.equal(env.cueMessages().length, before + 1);
  assert.deepEqual(cueOf(env).cue, { text: "Hello world. Next", startMs: 0, endMs: 3000, videoId: "abc" });
  await env.step();
  assert.equal(cueOf(env).cue.text, "Hello world. Next");
});

test("content: the manual range is kept only while the current caption piece is still inside it", async () => {
  const env = setup();
  await env.ready();
  dispatchMessage(env.onMessage, { type: "adjust-cue", edge: "end", delta: 1 });
  env.video.currentTime = 2.5;
  await env.step();
  assert.equal(cueOf(env).cue.text, "Hello world. Next");
  env.video.currentTime = 3.5;
  await env.step();
  assert.equal(cueOf(env).cue.text, "Next one.");
  env.video.currentTime = 0.5;
  await env.step();
  assert.equal(cueOf(env).cue.text, "Hello world.");
});

test("content: when the current caption piece moves in front of the manual range, the manual range is dropped", async () => {
  const env = setup({ currentTime: 2.5 });
  await env.ready();
  dispatchMessage(env.onMessage, { type: "adjust-cue", edge: "start", delta: -1 });
  assert.equal(cueOf(env).cue.text, "world. Next one.");
  env.video.currentTime = 0.5;
  await env.step();
  assert.equal(cueOf(env).cue.text, "Hello world.");
  env.video.currentTime = 2.5;
  await env.step();
  assert.equal(cueOf(env).cue.text, "Next one.");
});

test("content: reset-cue clears the manual range and republishes at once", async () => {
  const env = setup();
  await env.ready();
  dispatchMessage(env.onMessage, { type: "adjust-cue", edge: "end", delta: 1 });
  const before = env.cueMessages().length;
  const { returned, responses } = dispatchMessage(env.onMessage, { type: "reset-cue" });
  assert.equal(returned, undefined);
  assert.deepEqual(responses, []);
  assert.equal(env.cueMessages().length, before + 1);
  assert.equal(cueOf(env).cue.text, "Hello world.");
});

// ---- playing the original audio ----
test("content: play-range jumps to the start, plays, and pauses near the end", async () => {
  const env = setup();
  await env.ready();
  const message = { type: "play-range", videoId: "abc", startMs: 1500, endMs: 5040 };
  const { returned, responses } = dispatchMessage(env.onMessage, message);
  assert.equal(returned, undefined);
  assert.deepEqual(plain(responses), [{ ok: true }]);
  assert.equal(env.video.currentTime, 1.5);
  assert.equal(env.video.fake.plays, 1);
  assert.equal(env.video.fake.handlers.size, 1);

  env.video.currentTime = 4.99;
  env.video.fake.fireTimeUpdate();
  assert.equal(env.video.fake.pauses, 0);
  assert.equal(env.video.fake.handlers.size, 1);

  env.video.currentTime = 5;
  env.video.fake.fireTimeUpdate();
  assert.equal(env.video.fake.pauses, 1);
  assert.equal(env.video.fake.handlers.size, 0);
  assert.equal(env.video.fake.removed.length, 1);
});

test("content: play-range refuses when the video id is not the current video", async () => {
  const env = setup();
  const { responses } = dispatchMessage(env.onMessage, { type: "play-range", videoId: "other", startMs: 0, endMs: 1 });
  assert.deepEqual(plain(responses), [OPEN_ORIGINAL]);
  assert.equal(env.video.fake.plays, 0);
  assert.equal(env.video.fake.handlers.size, 0);
});

test("content: play-range refuses when the page has no video", async () => {
  const env = setup({ video: false });
  const { responses } = dispatchMessage(env.onMessage, { type: "play-range", videoId: "abc", startMs: 0, endMs: 1 });
  assert.deepEqual(plain(responses), [OPEN_ORIGINAL]);
});

test("content: ignores a message it does not know, without responding", () => {
  const env = setup();
  const { returned, responses } = dispatchMessage(env.onMessage, { type: "get-cue" });
  assert.equal(returned, undefined);
  assert.deepEqual(responses, []);
  assert.equal(env.cueMessages().length, 0);
});

// ---- in-site navigation ----
test("content: yt-navigate-finish clears the captions and the manual range, and loads again", async () => {
  const env = setup();
  await env.ready();
  dispatchMessage(env.onMessage, { type: "adjust-cue", edge: "end", delta: 1 });
  env.document.dispatchEvent(new env.window.Event("yt-navigate-finish"));
  await env.step();
  assert.deepEqual(cueOf(env), { type: "cue", cue: null, state: "no-caption" });
  assert.equal(env.loadCuesCalls(), 2);
  await env.step();
  assert.equal(cueOf(env).cue.text, "Hello world.");
});

test("content: yt-navigate-finish resets the failure count and tries again at once", async () => {
  const env = setup({ cues: [] });
  for (let index = 0; index < 12; index += 1) await env.step();
  assert.equal(env.loadCuesCalls(), 8);
  env.document.dispatchEvent(new env.window.Event("yt-navigate-finish"));
  await env.step();
  assert.equal(env.loadCuesCalls(), 9);
});

// ---- extension context invalidated ----
const invalidate = {
  "runtime 不存在": (env) => {
    env.chrome.runtime = undefined;
  },
  "runtime.id 为空": (env) => {
    env.chrome.runtime.id = "";
  },
  "访问 runtime 抛错": (env) => {
    Object.defineProperty(env.chrome, "runtime", {
      get() {
        throw new Error("Extension context invalidated.");
      },
    });
  },
};

test("content: stops the periodic publishing once the extension context is invalidated (no video)", async () => {
  for (const [name, apply] of Object.entries(invalidate)) {
    const env = setup({ video: false });
    apply(env);
    assert.equal(env.clock.intervals().length, 1, name);
    env.clock.tickIntervals();
    await flush();
    assert.equal(env.clock.intervals().length, 0, name);
    assert.equal(env.calls.sendMessage.length, 0, name);
  }
});

test("content: stops the periodic publishing once the extension context is invalidated (with a video, about to load captions)", async () => {
  for (const [name, apply] of Object.entries(invalidate)) {
    const env = setup();
    apply(env);
    env.clock.tickIntervals();
    await flush();
    assert.equal(env.clock.intervals().length, 0, name);
    assert.equal(env.calls.sendMessage.length, 0, name);
  }
});

test("content: stops the periodic publishing when sending a message throws (the context was just invalidated)", async () => {
  const env = setup({
    video: false,
    chromeOverrides: {
      sendMessage: () => {
        throw new Error("Extension context invalidated.");
      },
    },
  });
  env.clock.tickIntervals();
  await flush();
  assert.equal(env.clock.intervals().length, 0);
});

test("content: a message that throws while loading captions counts as one failure and publishing continues", async () => {
  const env = setup({
    chromeOverrides: {
      sendMessage: (message) => {
        if (message.type === "load-cues") throw new Error("同步失败");
        return undefined;
      },
    },
  });
  await env.step();
  await env.step();
  assert.equal(env.clock.intervals().length, 1);
  assert.equal(cueOf(env).state, "no-caption");
});
