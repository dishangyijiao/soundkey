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

test("mic: when permission is already denied, does not ask for the microphone and shows the message and the settings button", async () => {
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

test("mic: after a grant, stops every track at once, says it is allowed and closes the window after 300ms", async () => {
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

test("mic: when the user refuses the prompt, points to the settings and does not close the window", async () => {
  const mic = loadMic({
    permission: { state: "prompt" },
    getUserMedia: () => Promise.reject(new Error("Permission dismissed")),
  });
  await flush();
  assert.equal(mic.text.textContent, REFUSED_TEXT);
  assert.equal(mic.settings.hidden, false);
  assert.deepEqual(mic.clock.pending(), []);
});

test("mic: when the permission query fails, treats it as undecided and still asks for the microphone", async () => {
  const { stream } = fakeStream();
  const mic = loadMic({
    permission: () => Promise.reject(new TypeError("不支持 microphone")),
    getUserMedia: () => Promise.resolve(stream),
  });
  await flush();
  assert.equal(mic.text.textContent, "已允许麦克风。");
});

test("mic: when permission is already granted, asks and closes the same way", async () => {
  const { stream } = fakeStream();
  const mic = loadMic({ permission: { state: "granted" }, getUserMedia: () => Promise.resolve(stream) });
  await flush();
  assert.equal(mic.text.textContent, "已允许麦克风。");
});

test("mic: the settings button opens this extension's microphone site settings in a new tab", async () => {
  const mic = loadMic({ permission: { state: "denied" } });
  await flush();
  mic.settings.click();
  assert.deepEqual(plain(mic.calls.create), [
    { url: "chrome://settings/content/siteDetails?site=https%3A%2F%2Fsoundkey-ext.example%2F" },
  ]);
});
