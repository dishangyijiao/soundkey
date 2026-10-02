const test = require("node:test");
const assert = require("node:assert/strict");
const { loadMic, flush, plain } = require("./helpers/scripts.js");

const DENIED_TEXT = "麦克风已被关掉。打开设置后，把这个扩展的麦克风改成允许。";
const REFUSED_TEXT = "没有允许麦克风。打开设置后，把这个扩展的麦克风改成允许。";

function fakeStream() {
  const stops = [];
  const tracks = [{ stop: () => stops.push("a") }, { stop: () => stops.push("b") }];
  return { stream: { getTracks: () => tracks }, stops };
}

test("mic: 权限已被拒绝时不再请求麦克风，直接提示并显示设置按钮", async () => {
  let asked = 0;
  const mic = loadMic({
    permission: { state: "denied" },
    getUserMedia: () => {
      asked += 1;
      return Promise.resolve(fakeStream().stream);
    },
  });
  await flush();
  assert.equal(mic.text.textContent, DENIED_TEXT);
  assert.equal(mic.settings.hidden, false);
  assert.equal(asked, 0);
});

test("mic: 授权成功后立刻停掉所有音轨，提示已允许并在 300ms 后关闭窗口", async () => {
  const { stream, stops } = fakeStream();
  let request;
  const mic = loadMic({
    permission: { state: "prompt" },
    getUserMedia: (constraints) => {
      request = constraints;
      return Promise.resolve(stream);
    },
  });
  await flush();
  assert.deepEqual(plain(request), { audio: true });
  assert.deepEqual(stops, ["a", "b"]);
  assert.equal(mic.text.textContent, "已允许麦克风。");
  assert.equal(mic.settings.hidden, true);
  assert.deepEqual(mic.clock.pending().map((timer) => timer.ms), [300]);
  assert.deepEqual(mic.closes, []);
  mic.clock.advance(299);
  assert.deepEqual(mic.closes, []);
  mic.clock.advance(1);
  assert.deepEqual(mic.closes, [true]);
});

test("mic: 用户拒绝弹窗时提示去设置，不关闭窗口", async () => {
  const mic = loadMic({
    permission: { state: "prompt" },
    getUserMedia: () => Promise.reject(new Error("Permission dismissed")),
  });
  await flush();
  assert.equal(mic.text.textContent, REFUSED_TEXT);
  assert.equal(mic.settings.hidden, false);
  assert.deepEqual(mic.clock.pending(), []);
});

test("mic: 查询权限出错时按未决定处理，继续请求麦克风", async () => {
  const { stream } = fakeStream();
  const mic = loadMic({
    permission: () => Promise.reject(new TypeError("不支持 microphone")),
    getUserMedia: () => Promise.resolve(stream),
  });
  await flush();
  assert.equal(mic.text.textContent, "已允许麦克风。");
});

test("mic: 权限已授予时同样直接请求并关闭", async () => {
  const { stream } = fakeStream();
  const mic = loadMic({ permission: { state: "granted" }, getUserMedia: () => Promise.resolve(stream) });
  await flush();
  assert.equal(mic.text.textContent, "已允许麦克风。");
});

test("mic: 点击设置按钮在新标签页打开本扩展的麦克风站点设置", async () => {
  const mic = loadMic({ permission: { state: "denied" } });
  await flush();
  mic.settings.click();
  assert.deepEqual(plain(mic.calls.create), [
    { url: "chrome://settings/content/siteDetails?site=https%3A%2F%2Ffengsong-ext.example%2F" },
  ]);
});
