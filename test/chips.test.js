const test = require("node:test");
const assert = require("node:assert/strict");
const fc = require("fast-check");
const { errorChip, sortErrors } = require("../extension/chips.js");

test("errorChip: 读错 → 「标准 → 你读的」", () => {
  assert.deepEqual(errorChip({ kind: "sub", from: "θ", to: "s", class: "辅音", count: 1 }), {
    kind: "sub",
    tone: "consonant",
    tag: "辅音",
    kindLabel: "读成",
    from: "θ",
    to: "s",
    count: 1,
  });
});

test("errorChip: 漏读只有标准音", () => {
  const chip = errorChip({ kind: "del", from: "ɪ", to: null, class: "元音", count: 2 });
  assert.equal(chip.kindLabel, "漏读");
  assert.equal(chip.tone, "vowel");
  assert.equal(chip.tag, "元音");
  assert.equal(chip.from, "ɪ");
  assert.equal(chip.to, null);
  assert.equal(chip.count, 2);
});

test("errorChip: 多读只有你读的音", () => {
  const chip = errorChip({ kind: "ins", from: null, to: "ə", class: "元音", count: 1 });
  assert.equal(chip.kindLabel, "多读");
  assert.equal(chip.from, null);
  assert.equal(chip.to, "ə");
});

test("errorChip: 未知类别按辅音处理，但保留原文字标签", () => {
  const chip = errorChip({ kind: "sub", from: "x", to: "y", class: "其他", count: 1 });
  assert.equal(chip.tone, "consonant");
  assert.equal(chip.tag, "其他");
});

test("sortErrors: 次数多的排前面，同次数保持原顺序，不改动原数组", () => {
  const errors = [
    { kind: "sub", from: "a", to: "b", class: "元音", count: 1 },
    { kind: "sub", from: "c", to: "d", class: "辅音", count: 3 },
    { kind: "del", from: "e", to: null, class: "辅音", count: 1 },
  ];
  const before = JSON.stringify(errors);
  assert.deepEqual(
    sortErrors(errors).map((e) => e.from),
    ["c", "a", "e"],
  );
  assert.equal(JSON.stringify(errors), before);
});

const errorArb = fc.record({
  kind: fc.constantFrom("sub", "del", "ins"),
  from: fc.constantFrom("a", "θ", "ɪ"),
  to: fc.constantFrom("s", "ə", "d"),
  class: fc.constantFrom("元音", "辅音"),
  count: fc.integer({ min: 1, max: 9 }),
});

test("性质: sortErrors 是稳定的降序排列且保持元素", () => {
  fc.assert(
    fc.property(fc.array(errorArb, { maxLength: 15 }), (errors) => {
      const indexed = errors.map((e, i) => ({ ...e, i }));
      const sorted = sortErrors(indexed);
      if (sorted.length !== indexed.length) return false;
      for (let k = 1; k < sorted.length; k++) {
        if (sorted[k - 1].count < sorted[k].count) return false;
        if (sorted[k - 1].count === sorted[k].count && sorted[k - 1].i > sorted[k].i) return false;
      }
      return true;
    }),
  );
});

test("性质: 元音永远对应 vowel，且颜色之外一定带文字标签", () => {
  fc.assert(
    fc.property(errorArb, (error) => {
      const chip = errorChip(error);
      const toneOk = (error.class === "元音") === (chip.tone === "vowel");
      return toneOk && chip.tag.length > 0 && chip.kindLabel.length > 0 && chip.count === error.count;
    }),
  );
});

test("sortErrors: 大量同次数的错误保持原顺序", () => {
  const errors = Array.from({ length: 300 }, (_, i) => ({ kind: "sub", from: String(i), to: "x", class: "辅音", count: 1 }));
  assert.deepEqual(
    sortErrors(errors).map((e) => e.from),
    errors.map((e) => e.from),
  );
});
