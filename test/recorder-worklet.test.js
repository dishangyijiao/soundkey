const test = require("node:test");
const assert = require("node:assert/strict");
const { loadWorklet } = require("./helpers/scripts.js");

function processor() {
  const { registered } = loadWorklet();
  const [{ processor: Recorder }] = registered;
  return new Recorder();
}

test("recorder-worklet: registers a processor named soundkey-recorder", () => {
  const { registered, AudioWorkletProcessor } = loadWorklet();
  assert.equal(registered.length, 1);
  assert.equal(registered[0].name, "soundkey-recorder");
  assert.ok(new registered[0].processor() instanceof AudioWorkletProcessor);
});

test("recorder-worklet: process hands a copy of channel 0 to the port and returns true", () => {
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

test("recorder-worklet: sends one block per call", () => {
  const recorder = processor();
  recorder.process([[new Float32Array([1])]]);
  recorder.process([[new Float32Array([2])]]);
  assert.deepEqual(
    recorder.posted.map((chunk) => [...chunk]),
    [[1], [2]],
  );
});

test("recorder-worklet: sends nothing and still returns true when there is no input or no channel", () => {
  const recorder = processor();
  for (const inputs of [[], [undefined], [[]]]) {
    assert.equal(recorder.process(inputs), true);
  }
  assert.deepEqual(recorder.posted, []);
});
