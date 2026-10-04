const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const { runExtensionFile } = require("./helpers/scripts");

// There is no module in the page; the side panel and the content script reach the shared code through these global names.
const SHARED = [
  ["audio.js", "SoundkeyAudio", ["concat", "resample", "encodeWav"]],
  ["cues.js", "SoundkeyCues", ["cleanCue", "scoreColumns", "tokenize", "lookupKey", "wordScores", "wordColumns", "isVowel", "readButton", "wordPayload"]],
  ["sentence.js", "SoundkeySentence", ["LIMITS", "endsSentence", "isBoundary", "sentenceRange", "moveEdge", "rangeCue"]],
];

for (const [file, name, members] of SHARED) {
  test(`${file} is exposed as the global ${name} in the browser`, () => {
    const context = vm.createContext({});
    runExtensionFile(context, file);
    assert.deepEqual(Object.keys(context[name]).sort(), [...members].sort());
  });

  test(`${file} uses module.exports in node and does not pollute the globals`, () => {
    const context = vm.createContext({ module: { exports: {} } });
    runExtensionFile(context, file);
    assert.equal(context[name], undefined);
    assert.deepEqual(Object.keys(context.module.exports).sort(), [...members].sort());
  });
}
