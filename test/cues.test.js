const test = require("node:test");
const assert = require("node:assert/strict");
const fc = require("fast-check");
const { cleanCue, scoreColumns, selectedWord } = require("../extension/cues.js");

test("cleanCue removes caption markers without joining neighboring words", () => {
  assert.equal(cleanCue(">> Hello [Music] there >>"), "Hello there");
  fc.assert(fc.property(fc.string(), (s) => !cleanCue(s).includes(">>")));
});

test("scoreColumns leaves explicit gaps for deletion and insertion", () => {
  const columns = scoreColumns({ columns: [
    { expected: { phone: "θ", bad: true }, heard: { phone: "s", bad: true }, status: "sub" },
    { expected: { phone: "ɪ", bad: true }, heard: null, status: "del" },
  ] });
  assert.equal(columns.length, 2);
  assert.equal(columns[1].heard, null);
});

test("selectedWord accepts one word only", () => {
  assert.equal(selectedWord("I went home", 2, 6), "went");
  assert.equal(selectedWord("two words", 0, 9), null);
  assert.equal(selectedWord("hello,", 0, 6), null);
});
