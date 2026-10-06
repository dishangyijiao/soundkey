// Joins the caption pieces YouTube splits up back into whole sentences. Pure functions, shared by content.js and the tests.
(() => {
  const LIMITS = { maxCues: 5, maxMs: 20000, gapMs: 1200 };

  const TERMINAL = /[.?!…]["'”’)\]]*$/;

  function endsSentence(text) {
    return TERMINAL.test(String(text).trim());
  }

  function isBoundary(prev, next) {
    return endsSentence(prev.text) || next.startMs - prev.endMs > LIMITS.gapMs;
  }

  function sentenceRange(cues, index) {
    if (!Number.isInteger(index) || index < 0 || index >= cues.length) return null;
    let from = index;
    let to = index;
    // The clip ends at the latest end among its pieces (see rangeCue), and pieces can overlap, so the last piece's end is not enough.
    const fits = (a, b) => b - a + 1 <= LIMITS.maxCues && Math.max(...cues.slice(a, b + 1).map((item) => item.endMs)) - cues[a].startMs <= LIMITS.maxMs;
    for (;;) {
      const left = from > 0 && !isBoundary(cues[from - 1], cues[from]) && fits(from - 1, to);
      if (left) from -= 1;
      const right = to < cues.length - 1 && !isBoundary(cues[to], cues[to + 1]) && fits(from, to + 1);
      if (right) to += 1;
      if (!left && !right) break;
    }
    return { from, to };
  }

  function rangeCue(cues, range) {
    const items = cues.slice(range.from, range.to + 1);
    return {
      text: items.map((item) => item.text.replace(/\s+/g, " ").trim()).join(" "),
      startMs: items[0].startMs,
      endMs: Math.max(...items.map((item) => item.endMs)),
    };
  }

  const api = { LIMITS, endsSentence, isBoundary, sentenceRange, rangeCue };
  // Stryker disable next-line all: environment detection for browser versus node, no business behavior to assert
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else globalThis.SoundKeySentence = api;
})();
