const test = require("node:test");
const assert = require("node:assert/strict");
const fc = require("fast-check");
const { concat, resample, encodeWav } = require("../extension/audio.js");

const f32 = (...values) => new Float32Array(values);
const samplesArb = (max = 200) =>
  fc.array(fc.float({ min: -1, max: 1, noNaN: true, noDefaultInfinity: true }), { maxLength: max }).map((a) => new Float32Array(a));

// ---- concat ----
test("concat: 按顺序拼接，长度为各块之和", () => {
  const joined = concat([f32(1, 2), f32(), f32(3)]);
  assert.deepEqual(Array.from(joined), [1, 2, 3]);
  assert.equal(concat([]).length, 0);
});

test("性质: concat 保持顺序和总长度", () => {
  fc.assert(
    fc.property(fc.array(samplesArb(20), { maxLength: 8 }), (chunks) => {
      const joined = concat(chunks);
      const flat = chunks.flatMap((c) => Array.from(c));
      return joined.length === flat.length && flat.every((v, i) => v === joined[i]);
    }),
  );
});

// ---- resample ----
test("resample: 采样率相同时原样返回", () => {
  const input = f32(0.1, 0.2);
  assert.equal(resample(input, 16000, 16000), input);
});

test("resample: 降到一半采样率，长度减半并取到对应位置", () => {
  const out = resample(f32(0, 1, 2, 3, 4, 5, 6, 7), 32000, 16000);
  assert.deepEqual(Array.from(out), [0, 2, 4, 6]);
});

test("resample: 升采样按线性插值，末尾不越界", () => {
  const out = resample(f32(0, 1), 8000, 16000);
  assert.deepEqual(Array.from(out), [0, 0.5, 1, 1]);
});

test("resample: 非整数比例（48000 到 16000 之外，44100 到 16000）长度四舍五入", () => {
  assert.equal(resample(new Float32Array(44100), 44100, 16000).length, 16000);
  assert.equal(resample(new Float32Array(1000), 44100, 16000).length, Math.round((1000 * 16000) / 44100));
});

test("resample: 空输入得到空输出", () => {
  assert.equal(resample(new Float32Array(0), 48000, 16000).length, 0);
});

test("性质: resample 长度正确，且输出值不超出输入的范围", () => {
  fc.assert(
    fc.property(samplesArb(300), fc.constantFrom(8000, 16000, 22050, 44100, 48000), (input, from) => {
      const out = resample(input, from, 16000);
      if (out.length !== Math.round((input.length * 16000) / from)) return false;
      if (input.length === 0) return true;
      const lo = Math.min(...input) - 1e-6;
      const hi = Math.max(...input) + 1e-6;
      return Array.from(out).every((v) => v >= lo && v <= hi);
    }),
  );
});

// ---- encodeWav ----
function header(buffer) {
  const view = new DataView(buffer);
  const tag = (offset) => String.fromCharCode(...new Uint8Array(buffer, offset, 4));
  return {
    riff: tag(0),
    size: view.getUint32(4, true),
    wave: tag(8),
    fmt: tag(12),
    fmtSize: view.getUint32(16, true),
    format: view.getUint16(20, true),
    channels: view.getUint16(22, true),
    rate: view.getUint32(24, true),
    byteRate: view.getUint32(28, true),
    blockAlign: view.getUint16(32, true),
    bits: view.getUint16(34, true),
    data: tag(36),
    dataSize: view.getUint32(40, true),
    view,
  };
}

test("encodeWav: 16 位单声道 PCM 的文件头字段都正确", () => {
  const buffer = encodeWav(f32(0, 0.5, -0.5), 16000);
  const h = header(buffer);
  assert.deepEqual(
    [h.riff, h.wave, h.fmt, h.data, h.fmtSize, h.format, h.channels, h.bits, h.blockAlign],
    ["RIFF", "WAVE", "fmt ", "data", 16, 1, 1, 16, 2],
  );
  assert.deepEqual([h.rate, h.byteRate, h.dataSize, h.size, buffer.byteLength], [16000, 32000, 6, 42, 50]);
});

test("encodeWav: 采样值按 16 位量化，超出范围的被截断", () => {
  const h = header(encodeWav(f32(0, 1, -1, 2, -2, 0.5, -0.5), 16000));
  const read = (i) => h.view.getInt16(44 + i * 2, true);
  assert.deepEqual([0, 1, 2, 3, 4, 5, 6].map(read), [0, 32767, -32768, 32767, -32768, 16383, -16384]);
});

test("性质: encodeWav 的数据长度与采样数一致，还原误差不超过一个量化步长", () => {
  fc.assert(
    fc.property(samplesArb(100), (input) => {
      const buffer = encodeWav(input, 16000);
      const h = header(buffer);
      if (h.dataSize !== input.length * 2 || buffer.byteLength !== 44 + input.length * 2) return false;
      return Array.from(input).every((v, i) => {
        const raw = h.view.getInt16(44 + i * 2, true);
        return Math.abs((raw < 0 ? raw / 0x8000 : raw / 0x7fff) - v) <= 1 / 0x7fff + 1e-6;
      });
    }),
  );
});
