const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const { runExtensionFile } = require("./helpers/scripts");

// 页面里没有 module，侧边栏和内容脚本靠这些全局名取到共享代码。
const SHARED = [
  ["audio.js", "FengsongAudio", ["concat", "resample", "encodeWav"]],
  ["cues.js", "FengsongCues", ["cleanCue", "scoreColumns", "tokenize", "lookupKey", "wordScores", "wordColumns", "isVowel", "readButton", "wordPayload"]],
  ["sentence.js", "FengsongSentence", ["LIMITS", "endsSentence", "isBoundary", "sentenceRange", "moveEdge", "rangeCue"]],
];

for (const [file, name, members] of SHARED) {
  test(`${file} 在浏览器里挂成全局 ${name}`, () => {
    const context = vm.createContext({});
    runExtensionFile(context, file);
    assert.deepEqual(Object.keys(context[name]).sort(), [...members].sort());
  });

  test(`${file} 在 node 里走 module.exports，不污染全局`, () => {
    const context = vm.createContext({ module: { exports: {} } });
    runExtensionFile(context, file);
    assert.equal(context[name], undefined);
    assert.deepEqual(Object.keys(context.module.exports).sort(), [...members].sort());
  });
}
