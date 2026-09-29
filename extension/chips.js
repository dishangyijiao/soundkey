// 把评分里的音素错误整理成侧边栏标签用的数据。纯函数，sidepanel.js 和测试共用。
(() => {
  const KIND_LABEL = { sub: "读成", del: "漏读", ins: "多读" };

  function errorChip(error) {
    return {
      kind: error.kind,
      tone: error.class === "元音" ? "vowel" : "consonant",
      tag: error.class,
      kindLabel: KIND_LABEL[error.kind],
      from: error.from,
      to: error.to,
      count: error.count,
    };
  }

  function sortErrors(errors) {
    return [...errors].sort((a, b) => b.count - a.count);
  }

  const api = { errorChip, sortErrors };
  // Stryker disable next-line all: 浏览器与 node 的环境探测，没有可断言的业务行为
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else globalThis.FengsongChips = api;
})();
