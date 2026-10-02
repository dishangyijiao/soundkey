const test = require("node:test");
const assert = require("node:assert/strict");
const { dispatchMessage, flush, loadContent, navigate, plain } = require("./helpers/scripts.js");

const OPEN_ORIGINAL = { ok: false, error: "打开原来的视频才能听原声" };

// 自动分句：[0,1] 和 [2,3]。
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
  // 第一次发布触发加载，第二次才带上字幕。
  env.ready = async () => {
    await env.step();
    await env.step();
  };
  return env;
}

const cueOf = (env) => env.lastCue();

// ---- 发布节奏 ----
test("content: 加载后每 300ms 发布一次字幕", () => {
  const env = setup();
  assert.deepEqual(
    env.clock.intervals().map((timer) => timer.ms),
    [300],
  );
  assert.equal(env.cueMessages().length, 0);
  env.clock.advance(900);
  assert.equal(env.cueMessages().length, 3);
});

// ---- 没有视频 ----
test("content: 页面没有 video 时发布 no-video", async () => {
  const env = setup({ video: false });
  await env.step();
  assert.deepEqual(cueOf(env), { type: "cue", cue: null, state: "no-video" });
  assert.equal(env.loadCuesCalls(), 0);
});

test("content: 不在 /watch 页面或没有 v 参数时发布 no-video", async () => {
  for (const url of ["https://www.youtube.com/feed/subscriptions?v=abc", "https://www.youtube.com/watch"]) {
    const env = setup({ url });
    await env.step();
    assert.deepEqual(cueOf(env), { type: "cue", cue: null, state: "no-video" }, url);
    assert.equal(env.loadCuesCalls(), 0, url);
  }
});

test("content: 视频消失后清掉旧字幕，下次回来要重新加载", async () => {
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

// ---- 加载字幕 ----
test("content: 先向后台请求字幕，加载完成前显示 no-caption，之后显示当前句", async () => {
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

test("content: 字幕加载完成后不再重复请求", async () => {
  const env = setup();
  await env.ready();
  await env.step();
  await env.step();
  assert.equal(env.loadCuesCalls(), 1);
});

test("content: 加载还没返回时不会再发第二次请求", async () => {
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

test("content: 切到另一个视频后丢掉旧字幕并重新加载", async () => {
  const env = setup();
  await env.ready();
  navigate(env.window, "/watch?v=def");
  await env.step();
  assert.deepEqual(cueOf(env), { type: "cue", cue: null, state: "no-caption" });
  assert.equal(env.loadCuesCalls(), 2);
  await env.step();
  assert.equal(cueOf(env).cue.videoId, "def");
});

test("content: 后台没有字幕或请求失败时，连续尝试 8 次后改为每 10 秒一次", async () => {
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
    // 间隔刚好 10 秒还不重试，多 1 毫秒才重试。
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

test("content: 加载成功后重置失败次数，换视频后又能立即重试", async () => {
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

// ---- 当前句 ----
test("content: 当前时间落在字幕条内时，用这条所在的整句", async () => {
  const env = setup({ currentTime: 2.5 });
  await env.ready();
  assert.deepEqual(cueOf(env).cue, { text: "Next one.", startMs: 2000, endMs: 4000, videoId: "abc" });
});

test("content: 字幕条起点算在内、终点不算在内", async () => {
  const env = setup({ currentTime: 1 });
  await env.ready();
  assert.equal(cueOf(env).cue.text, "Hello world.");
  env.video.currentTime = 2;
  await env.step();
  assert.equal(cueOf(env).cue.text, "Next one.");
});

test("content: 时间在两条字幕之间时，停在前一条", async () => {
  const gap = [
    { text: "First.", startMs: 0, endMs: 1000 },
    { text: "Second.", startMs: 5000, endMs: 6000 },
  ];
  const env = setup({ cues: gap, currentTime: 2 });
  await env.ready();
  assert.equal(cueOf(env).cue.text, "First.");
});

test("content: 时间在最后一条之后时，停在最后一条", async () => {
  const env = setup({ currentTime: 99 });
  await env.ready();
  assert.equal(cueOf(env).cue.text, "Next one.");
});

test("content: 时间在第一条之前时，显示第一条", async () => {
  const late = [
    { text: "Late.", startMs: 3000, endMs: 4000 },
    { text: "Later.", startMs: 5000, endMs: 6000 },
  ];
  const env = setup({ cues: late, currentTime: 1 });
  await env.ready();
  assert.equal(cueOf(env).cue.text, "Late.");
});

// ---- 手动调整 ----
test("content: 还没显示过字幕时 adjust-cue 不起作用", async () => {
  const env = setup();
  const { returned, responses } = dispatchMessage(env.onMessage, { type: "adjust-cue", edge: "end", delta: 1 });
  assert.equal(returned, undefined);
  assert.deepEqual(responses, []);
  assert.equal(env.cueMessages().length, 0);
});

test("content: adjust-cue 移动句子边界并立刻重新发布", async () => {
  const env = setup();
  await env.ready();
  const before = env.cueMessages().length;
  dispatchMessage(env.onMessage, { type: "adjust-cue", edge: "end", delta: 1 });
  assert.equal(env.cueMessages().length, before + 1);
  assert.deepEqual(cueOf(env).cue, { text: "Hello world. Next", startMs: 0, endMs: 3000, videoId: "abc" });
  await env.step();
  assert.equal(cueOf(env).cue.text, "Hello world. Next");
});

test("content: 手动范围只在当前字幕条仍在范围内时保留", async () => {
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

test("content: 当前字幕条跑到手动范围前面时，手动范围作废", async () => {
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

test("content: reset-cue 清掉手动范围并立刻重新发布", async () => {
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

// ---- 原声播放 ----
test("content: play-range 跳到起点播放，并在接近终点时暂停", async () => {
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

test("content: play-range 的视频编号不是当前视频时拒绝", async () => {
  const env = setup();
  const { responses } = dispatchMessage(env.onMessage, { type: "play-range", videoId: "other", startMs: 0, endMs: 1 });
  assert.deepEqual(plain(responses), [OPEN_ORIGINAL]);
  assert.equal(env.video.fake.plays, 0);
  assert.equal(env.video.fake.handlers.size, 0);
});

test("content: play-range 在页面没有 video 时拒绝", async () => {
  const env = setup({ video: false });
  const { responses } = dispatchMessage(env.onMessage, { type: "play-range", videoId: "abc", startMs: 0, endMs: 1 });
  assert.deepEqual(plain(responses), [OPEN_ORIGINAL]);
});

test("content: 不认识的消息不处理也不回应", () => {
  const env = setup();
  const { returned, responses } = dispatchMessage(env.onMessage, { type: "get-cue" });
  assert.equal(returned, undefined);
  assert.deepEqual(responses, []);
  assert.equal(env.cueMessages().length, 0);
});

// ---- 站内导航 ----
test("content: yt-navigate-finish 清掉字幕和手动范围，重新加载", async () => {
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

test("content: yt-navigate-finish 重置失败次数，立刻重新尝试", async () => {
  const env = setup({ cues: [] });
  for (let index = 0; index < 12; index += 1) await env.step();
  assert.equal(env.loadCuesCalls(), 8);
  env.document.dispatchEvent(new env.window.Event("yt-navigate-finish"));
  await env.step();
  assert.equal(env.loadCuesCalls(), 9);
});

// ---- 扩展上下文失效 ----
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

test("content: 扩展上下文失效后停止定时发布（没有视频时）", async () => {
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

test("content: 扩展上下文失效后停止定时发布（有视频、正要加载字幕时）", async () => {
  for (const [name, apply] of Object.entries(invalidate)) {
    const env = setup();
    apply(env);
    env.clock.tickIntervals();
    await flush();
    assert.equal(env.clock.intervals().length, 0, name);
    assert.equal(env.calls.sendMessage.length, 0, name);
  }
});

test("content: 发送消息抛错（上下文刚好失效）时停止定时发布", async () => {
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

test("content: 加载字幕时消息发送抛错只算一次失败，仍继续发布", async () => {
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
