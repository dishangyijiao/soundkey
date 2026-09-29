// 把 YouTube 拆碎的字幕条拼回完整句子。纯函数，content.js 和测试共用。
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
    const fits = (a, b) => b - a + 1 <= LIMITS.maxCues && cues[b].endMs - cues[a].startMs <= LIMITS.maxMs;
    for (;;) {
      const left = from > 0 && !isBoundary(cues[from - 1], cues[from]) && fits(from - 1, to);
      if (left) from -= 1;
      const right = to < cues.length - 1 && !isBoundary(cues[to], cues[to + 1]) && fits(from, to + 1);
      if (right) to += 1;
      if (!left && !right) break;
    }
    return { from, to };
  }

  function moveEdge(range, edge, delta, total) {
    let { from, to } = range;
    if (edge === "start") from = Math.min(to, Math.max(0, from + delta));
    else to = Math.max(from, Math.min(total - 1, to + delta));
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

  const api = { LIMITS, endsSentence, isBoundary, sentenceRange, moveEdge, rangeCue };
  // Stryker disable next-line all: 浏览器与 node 的环境探测，没有可断言的业务行为
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else globalThis.FengsongSentence = api;
})();
