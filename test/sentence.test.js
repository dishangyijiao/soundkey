const test = require("node:test");
const assert = require("node:assert/strict");
const fc = require("fast-check");
const {
  LIMITS,
  endsSentence,
  isBoundary,
  sentenceRange,
  rangeCue,
} = require("../extension/sentence.js");

const cue = (text, startMs, endMs) => ({ text, startMs, endMs });

// ---- endsSentence ----
test("endsSentence: end-of-sentence punctuation ends it", () => {
  for (const text of ["Hello.", "Really?", "Stop!", "Wait…", 'He said "go."', "It (ended.)", "Yes.'"]) {
    assert.equal(endsSentence(text), true, text);
  }
});

test("endsSentence: mid-sentence punctuation, commas and no punctuation do not end it", () => {
  for (const text of ["Hello", "Hello,", "3.5 million", "and then", "Mr. Smith", ""]) {
    assert.equal(endsSentence(text), false, text);
  }
});

test("endsSentence: trailing whitespace does not affect the decision", () => {
  assert.equal(endsSentence("Done.  "), true);
});

// ---- isBoundary ----
test("isBoundary: it is a boundary when the previous piece ends with a period", () => {
  assert.equal(isBoundary(cue("Hi.", 0, 1000), cue("there", 1000, 2000)), true);
});

test("isBoundary: a gap above the threshold is a boundary, a gap exactly equal to it is not", () => {
  const a = cue("hi", 0, 1000);
  assert.equal(isBoundary(a, cue("x", 1000 + LIMITS.gapMs, 5000)), false);
  assert.equal(isBoundary(a, cue("x", 1000 + LIMITS.gapMs + 1, 5000)), true);
});

test("isBoundary: overlapping captions are not a boundary", () => {
  assert.equal(isBoundary(cue("hi", 0, 3000), cue("there", 2000, 4000)), false);
});

// ---- sentenceRange ----
test("sentenceRange: one sentence split into three pieces can be recovered whole from the middle one", () => {
  const cues = [
    cue("Earlier sentence.", 0, 1000),
    cue("I went to", 1100, 2000),
    cue("the store", 2000, 3000),
    cue("yesterday.", 3000, 4000),
    cue("Next one.", 4100, 5000),
  ];
  for (const i of [1, 2, 3]) assert.deepEqual(sentenceRange(cues, i), { from: 1, to: 3 }, `index ${i}`);
});

test("sentenceRange: an already complete piece stays unchanged", () => {
  const cues = [cue("A.", 0, 1000), cue("B is whole.", 1100, 2000), cue("C.", 2100, 3000)];
  assert.deepEqual(sentenceRange(cues, 1), { from: 1, to: 1 });
});

test("sentenceRange: a long pause splits captions that have no punctuation", () => {
  const cues = [cue("one two", 0, 1000), cue("three", 1100, 2000), cue("four", 5000, 6000)];
  assert.deepEqual(sentenceRange(cues, 0), { from: 0, to: 1 });
  assert.deepEqual(sentenceRange(cues, 2), { from: 2, to: 2 });
});

test("sentenceRange: merges at most maxCues pieces", () => {
  const cues = Array.from({ length: 12 }, (_, i) => cue(`w${i}`, i * 1000, i * 1000 + 900));
  const range = sentenceRange(cues, 6);
  assert.equal(range.to - range.from + 1, LIMITS.maxCues);
  assert.ok(range.from <= 6 && 6 <= range.to);
});

test("sentenceRange: the total duration does not exceed maxMs", () => {
  const cues = Array.from({ length: 6 }, (_, i) => cue(`w${i}`, i * 9000, i * 9000 + 8900));
  const range = sentenceRange(cues, 3);
  const span = cues[range.to].endMs - cues[range.from].startMs;
  assert.ok(span <= LIMITS.maxMs, `span ${span}`);
});

test("sentenceRange: a single caption piece that is itself too long is still returned", () => {
  const cues = [cue("very long", 0, 30000)];
  assert.deepEqual(sentenceRange(cues, 0), { from: 0, to: 0 });
});

test("sentenceRange: the first and last boundaries stay in bounds", () => {
  const cues = [cue("a", 0, 500), cue("b", 600, 1000)];
  assert.deepEqual(sentenceRange(cues, 0), { from: 0, to: 1 });
  assert.deepEqual(sentenceRange(cues, 1), { from: 0, to: 1 });
});

test("sentenceRange: returns null for an invalid index", () => {
  assert.equal(sentenceRange([], 0), null);
  assert.equal(sentenceRange([cue("a", 0, 1)], -1), null);
  assert.equal(sentenceRange([cue("a", 0, 1)], 1), null);
});

// ---- rangeCue ----
test("rangeCue: merges the text, takes the first start and the largest end", () => {
  const cues = [cue("I went to", 1000, 2000), cue("the store", 2000, 3500), cue("now.", 3000, 3400)];
  assert.deepEqual(rangeCue(cues, { from: 0, to: 2 }), {
    text: "I went to the store now.",
    startMs: 1000,
    endMs: 3500,
  });
});

test("rangeCue: collapses extra whitespace when merging", () => {
  const cues = [cue("a  b ", 0, 1), cue(" c", 1, 2)];
  assert.equal(rangeCue(cues, { from: 0, to: 1 }).text, "a b c");
});

// ---- properties and invariants ----
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

test("property: the range contains the original index and stays within the boundaries", () => {
  fc.assert(
    fc.property(casesArb, ([cues, i]) => {
      const r = sentenceRange(cues, i);
      return 0 <= r.from && r.from <= i && i <= r.to && r.to < cues.length;
    }),
  );
});

test("property: the number of pieces and the duration respect the limits (a single piece is the exception)", () => {
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

test("property: there is no sentence boundary inside the range", () => {
  fc.assert(
    fc.property(casesArb, ([cues, i]) => {
      const r = sentenceRange(cues, i);
      for (let k = r.from; k < r.to; k++) if (isBoundary(cues[k], cues[k + 1])) return false;
      return true;
    }),
  );
});

test("property: when no limit truncated it, the range is the largest continuous run without a boundary", () => {
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

test("property: every piece in a run gets the same range (when no limit was hit)", () => {
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

test("property: the merged result is ordered in time, and the text is the pieces' text joined in order", () => {
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

test("sentenceRange: overlapping pieces are not joined when the clip they make would be longer than maxMs", () => {
  // The second piece ends before the first one does, so the clip ends at 25 000 ms, not at 15 000 ms.
  const cues = [cue("one two three", 0, 25000), cue("four five.", 5000, 15000)];
  assert.deepEqual(sentenceRange(cues, 0), { from: 0, to: 0 });
  assert.deepEqual(sentenceRange(cues, 1), { from: 1, to: 1 });
});

test("property: with overlapping pieces, a joined clip is never longer than maxMs", () => {
  const overlapArb = fc
    .array(
      fc.record({
        text: fc.constantFrom("a", "b c", "d.", "e?", "f g h"),
        step: fc.integer({ min: 0, max: 4000 }),
        dur: fc.integer({ min: 200, max: 30000 }),
      }),
      { minLength: 2, maxLength: 8 },
    )
    .map((items) => {
      let start = 0;
      return items.map(({ text, step, dur }) => {
        start += step;
        return cue(text, start, start + dur);
      });
    })
    .chain((cues) => fc.tuple(fc.constant(cues), fc.integer({ min: 0, max: cues.length - 1 })));
  fc.assert(
    fc.property(overlapArb, ([cues, i]) => {
      const r = sentenceRange(cues, i);
      if (r.to === r.from) return true;
      const clip = rangeCue(cues, r);
      return clip.endMs - clip.startMs <= LIMITS.maxMs;
    }),
  );
});

test("sentenceRange: still merges when the total duration is exactly maxMs", () => {
  const cues = [cue("one", 0, 10000), cue("two", 10000, LIMITS.maxMs)];
  assert.deepEqual(sentenceRange(cues, 0), { from: 0, to: 1 });
  assert.deepEqual(sentenceRange(cues, 1), { from: 0, to: 1 });
});

test("sentenceRange: no longer merges with one millisecond more", () => {
  const cues = [cue("one", 0, 10000), cue("two", 10000, LIMITS.maxMs + 1)];
  assert.deepEqual(sentenceRange(cues, 0), { from: 0, to: 0 });
});
