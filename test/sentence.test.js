const test = require("node:test");
const assert = require("node:assert/strict");
const fc = require("fast-check");
const {
  LIMITS,
  endsSentence,
  isBoundary,
  sentenceRange,
  moveEdge,
  rangeCue,
} = require("../extension/sentence.js");

const cue = (text, startMs, endMs) => ({ text, startMs, endMs });

// ---- endsSentence ----
test("endsSentence: 句末标点算结束", () => {
  for (const text of ["Hello.", "Really?", "Stop!", "Wait…", 'He said "go."', "It (ended.)", "Yes.'"]) {
    assert.equal(endsSentence(text), true, text);
  }
});

test("endsSentence: 句中标点、逗号、无标点不算结束", () => {
  for (const text of ["Hello", "Hello,", "3.5 million", "and then", "Mr. Smith", ""]) {
    assert.equal(endsSentence(text), false, text);
  }
});

test("endsSentence: 结尾空白不影响判断", () => {
  assert.equal(endsSentence("Done.  "), true);
});

// ---- isBoundary ----
test("isBoundary: 前一条以句号结束就是边界", () => {
  assert.equal(isBoundary(cue("Hi.", 0, 1000), cue("there", 1000, 2000)), true);
});

test("isBoundary: 间隔超过阈值才是边界，恰好等于阈值不是", () => {
  const a = cue("hi", 0, 1000);
  assert.equal(isBoundary(a, cue("x", 1000 + LIMITS.gapMs, 5000)), false);
  assert.equal(isBoundary(a, cue("x", 1000 + LIMITS.gapMs + 1, 5000)), true);
});

test("isBoundary: 重叠字幕不是边界", () => {
  assert.equal(isBoundary(cue("hi", 0, 3000), cue("there", 2000, 4000)), false);
});

// ---- sentenceRange ----
test("sentenceRange: 一句话拆成三条，从中间那条也能取全", () => {
  const cues = [
    cue("Earlier sentence.", 0, 1000),
    cue("I went to", 1100, 2000),
    cue("the store", 2000, 3000),
    cue("yesterday.", 3000, 4000),
    cue("Next one.", 4100, 5000),
  ];
  for (const i of [1, 2, 3]) assert.deepEqual(sentenceRange(cues, i), { from: 1, to: 3 }, `index ${i}`);
});

test("sentenceRange: 已经完整的一条保持不变", () => {
  const cues = [cue("A.", 0, 1000), cue("B is whole.", 1100, 2000), cue("C.", 2100, 3000)];
  assert.deepEqual(sentenceRange(cues, 1), { from: 1, to: 1 });
});

test("sentenceRange: 长停顿把没有标点的字幕断开", () => {
  const cues = [cue("one two", 0, 1000), cue("three", 1100, 2000), cue("four", 5000, 6000)];
  assert.deepEqual(sentenceRange(cues, 0), { from: 0, to: 1 });
  assert.deepEqual(sentenceRange(cues, 2), { from: 2, to: 2 });
});

test("sentenceRange: 最多合并 maxCues 条", () => {
  const cues = Array.from({ length: 12 }, (_, i) => cue(`w${i}`, i * 1000, i * 1000 + 900));
  const range = sentenceRange(cues, 6);
  assert.equal(range.to - range.from + 1, LIMITS.maxCues);
  assert.ok(range.from <= 6 && 6 <= range.to);
});

test("sentenceRange: 总时长不超过 maxMs", () => {
  const cues = Array.from({ length: 6 }, (_, i) => cue(`w${i}`, i * 9000, i * 9000 + 8900));
  const range = sentenceRange(cues, 3);
  const span = cues[range.to].endMs - cues[range.from].startMs;
  assert.ok(span <= LIMITS.maxMs, `span ${span}`);
});

test("sentenceRange: 单条字幕本身超长也照样返回它", () => {
  const cues = [cue("very long", 0, 30000)];
  assert.deepEqual(sentenceRange(cues, 0), { from: 0, to: 0 });
});

test("sentenceRange: 头尾边界不越界", () => {
  const cues = [cue("a", 0, 500), cue("b", 600, 1000)];
  assert.deepEqual(sentenceRange(cues, 0), { from: 0, to: 1 });
  assert.deepEqual(sentenceRange(cues, 1), { from: 0, to: 1 });
});

test("sentenceRange: 下标无效时返回 null", () => {
  assert.equal(sentenceRange([], 0), null);
  assert.equal(sentenceRange([cue("a", 0, 1)], -1), null);
  assert.equal(sentenceRange([cue("a", 0, 1)], 1), null);
});

// ---- moveEdge ----
const five = Array.from({ length: 5 }, (_, i) => cue(`w${i}`, i * 1000, i * 1000 + 900));

test("moveEdge: 向前加一条、向后加一条", () => {
  assert.deepEqual(moveEdge({ from: 2, to: 3 }, "start", -1, 5), { from: 1, to: 3 });
  assert.deepEqual(moveEdge({ from: 2, to: 3 }, "end", 1, 5), { from: 2, to: 4 });
});

test("moveEdge: 去掉一条", () => {
  assert.deepEqual(moveEdge({ from: 1, to: 3 }, "start", 1, 5), { from: 2, to: 3 });
  assert.deepEqual(moveEdge({ from: 1, to: 3 }, "end", -1, 5), { from: 1, to: 2 });
});

test("moveEdge: 至少保留一条，不越界", () => {
  assert.deepEqual(moveEdge({ from: 2, to: 2 }, "start", 1, 5), { from: 2, to: 2 });
  assert.deepEqual(moveEdge({ from: 2, to: 2 }, "end", -1, 5), { from: 2, to: 2 });
  assert.deepEqual(moveEdge({ from: 0, to: 1 }, "start", -1, 5), { from: 0, to: 1 });
  assert.deepEqual(moveEdge({ from: 3, to: 4 }, "end", 1, 5), { from: 3, to: 4 });
});

// ---- rangeCue ----
test("rangeCue: 合并文字，起点取第一条，终点取最大", () => {
  const cues = [cue("I went to", 1000, 2000), cue("the store", 2000, 3500), cue("now.", 3000, 3400)];
  assert.deepEqual(rangeCue(cues, { from: 0, to: 2 }), {
    text: "I went to the store now.",
    startMs: 1000,
    endMs: 3500,
  });
});

test("rangeCue: 合并时压缩多余空白", () => {
  const cues = [cue("a  b ", 0, 1), cue(" c", 1, 2)];
  assert.equal(rangeCue(cues, { from: 0, to: 1 }).text, "a b c");
});

// ---- 属性与不变量 ----
const cuesArb = fc
  .array(
    fc.record({
      text: fc.constantFrom("a", "b c", "d.", "e?", "f,", "g!", "h i j."),
      gap: fc.integer({ min: -500, max: 3000 }),
      dur: fc.integer({ min: 100, max: 12000 }),
    }),
    { minLength: 1, maxLength: 25 },
  )
  .map((items) => {
    let t = 0;
    return items.map(({ text, gap, dur }) => {
      const startMs = Math.max(0, t + gap);
      t = startMs + dur;
      return cue(text, startMs, t);
    });
  });

const casesArb = cuesArb.chain((cues) => fc.tuple(fc.constant(cues), fc.integer({ min: 0, max: cues.length - 1 })));

test("性质: 范围包含原下标且在边界内", () => {
  fc.assert(
    fc.property(casesArb, ([cues, i]) => {
      const r = sentenceRange(cues, i);
      return 0 <= r.from && r.from <= i && i <= r.to && r.to < cues.length;
    }),
  );
});

test("性质: 条数、时长受上限约束（单条例外）", () => {
  fc.assert(
    fc.property(casesArb, ([cues, i]) => {
      const r = sentenceRange(cues, i);
      const count = r.to - r.from + 1;
      if (count > LIMITS.maxCues) return false;
      if (count === 1) return true;
      return cues[r.to].endMs - cues[r.from].startMs <= LIMITS.maxMs;
    }),
  );
});

test("性质: 范围内部没有句子边界", () => {
  fc.assert(
    fc.property(casesArb, ([cues, i]) => {
      const r = sentenceRange(cues, i);
      for (let k = r.from; k < r.to; k++) if (isBoundary(cues[k], cues[k + 1])) return false;
      return true;
    }),
  );
});

test("性质: 没被上限截断时，范围是最大的无边界连续段", () => {
  fc.assert(
    fc.property(casesArb, ([cues, i]) => {
      const r = sentenceRange(cues, i);
      const count = r.to - r.from + 1;
      const span = (a, b) => cues[b].endMs - cues[a].startMs;
      const canGrowLeft =
        r.from > 0 && !isBoundary(cues[r.from - 1], cues[r.from]) && count + 1 <= LIMITS.maxCues && span(r.from - 1, r.to) <= LIMITS.maxMs;
      const canGrowRight =
        r.to < cues.length - 1 && !isBoundary(cues[r.to], cues[r.to + 1]) && count + 1 <= LIMITS.maxCues && span(r.from, r.to + 1) <= LIMITS.maxMs;
      return !canGrowLeft && !canGrowRight;
    }),
  );
});

test("性质: 段内任一条都得到同一个范围（未触发上限时）", () => {
  const shortArb = fc
    .array(fc.constantFrom("a", "b c", "d.", "e?"), { minLength: 1, maxLength: 4 })
    .map((texts) => texts.map((text, i) => cue(text, i * 1000, i * 1000 + 900)));
  fc.assert(
    fc.property(shortArb, (cues) => {
      const first = sentenceRange(cues, 0);
      for (let k = first.from; k <= first.to; k++) {
        const r = sentenceRange(cues, k);
        if (r.from !== first.from || r.to !== first.to) return false;
      }
      return true;
    }),
  );
});

test("性质: 合并结果的时间有序，文字是各条文字按序拼接", () => {
  fc.assert(
    fc.property(casesArb, ([cues, i]) => {
      const r = sentenceRange(cues, i);
      const merged = rangeCue(cues, r);
      const expected = cues
        .slice(r.from, r.to + 1)
        .map((c) => c.text)
        .join(" ");
      return merged.startMs <= merged.endMs && merged.text === expected && merged.startMs === cues[r.from].startMs;
    }),
  );
});

test("性质: moveEdge 永远保持 0<=from<=to<n，且只动指定的一边", () => {
  const rangeArb = fc.integer({ min: 1, max: 10 }).chain((n) =>
    fc.tuple(
      fc.constant(n),
      fc.integer({ min: 0, max: n - 1 }).chain((from) => fc.tuple(fc.constant(from), fc.integer({ min: from, max: n - 1 }))),
      fc.constantFrom("start", "end"),
      fc.constantFrom(-1, 1),
    ),
  );
  fc.assert(
    fc.property(rangeArb, ([n, [from, to], edge, delta]) => {
      const r = moveEdge({ from, to }, edge, delta, n);
      const valid = 0 <= r.from && r.from <= r.to && r.to < n;
      const otherKept = edge === "start" ? r.to === to : r.from === from;
      const step = edge === "start" ? Math.abs(r.from - from) <= 1 : Math.abs(r.to - to) <= 1;
      return valid && otherKept && step;
    }),
  );
});

test("sentenceRange: 总时长恰好等于 maxMs 时仍然合并", () => {
  const cues = [cue("one", 0, 10000), cue("two", 10000, LIMITS.maxMs)];
  assert.deepEqual(sentenceRange(cues, 0), { from: 0, to: 1 });
  assert.deepEqual(sentenceRange(cues, 1), { from: 0, to: 1 });
});

test("sentenceRange: 多出 1 毫秒就不再合并", () => {
  const cues = [cue("one", 0, 10000), cue("two", 10000, LIMITS.maxMs + 1)];
  assert.deepEqual(sentenceRange(cues, 0), { from: 0, to: 0 });
});
