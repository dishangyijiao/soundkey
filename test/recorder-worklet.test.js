const test = require("node:test");
const assert = require("node:assert/strict");
const { loadWorklet } = require("./helpers/scripts.js");

function processor() {
  const { registered } = loadWorklet();
  const [{ processor: Recorder }] = registered;
  return new Recorder();
}

test("recorder-worklet: 注册名为 fengsong-recorder 的处理器", () => {
  const { registered, AudioWorkletProcessor } = loadWorklet();
  assert.equal(registered.length, 1);
  assert.equal(registered[0].name, "fengsong-recorder");
  assert.ok(new registered[0].processor() instanceof AudioWorkletProcessor);
});

test("recorder-worklet: process 把第 0 声道的副本交给 port 并返回 true", () => {
  const recorder = processor();
  const channel = new Float32Array([0.5, -0.25, 1]);
  const keepAlive = recorder.process([[channel, new Float32Array([9, 9, 9])]]);
  assert.equal(keepAlive, true);
  assert.equal(recorder.posted.length, 1);
  const [posted] = recorder.posted;
  assert.deepEqual([...posted], [0.5, -0.25, 1]);
  assert.notEqual(posted, channel);
  channel[0] = 7;
  assert.equal(posted[0], 0.5);
});

test("recorder-worklet: 每次调用各发一块", () => {
  const recorder = processor();
  recorder.process([[new Float32Array([1])]]);
  recorder.process([[new Float32Array([2])]]);
  assert.deepEqual(
    recorder.posted.map((chunk) => [...chunk]),
    [[1], [2]],
  );
});

test("recorder-worklet: 没有输入或没有声道时不发送，仍返回 true", () => {
  const recorder = processor();
  for (const inputs of [[], [undefined], [[]]]) {
    assert.equal(recorder.process(inputs), true);
  }
  assert.deepEqual(recorder.posted, []);
});
