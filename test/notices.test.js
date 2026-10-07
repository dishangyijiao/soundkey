const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const notices = fs.readFileSync(path.join(ROOT, "THIRD-PARTY-NOTICES.md"), "utf8");

test("notices: the vocabulary file is described with its upstream revision, license and the hash of the shipped bytes", () => {
  const shipped = crypto.createHash("sha256").update(fs.readFileSync(path.join(ROOT, "assets", "vocab.json"))).digest("hex");
  assert.ok(notices.includes(shipped), "THIRD-PARTY-NOTICES.md must carry the sha256 of assets/vocab.json; update it when the file changes");
  assert.match(notices, /facebook\/wav2vec2-lv-60-espeak-cv-ft/);
  assert.match(notices, /Apache-2\.0/);
  assert.match(notices, /\b[0-9a-f]{40}\b/, "the upstream revision must be pinned to a full commit hash");
  assert.match(notices, /unchanged|byte-identical/i, "state that the file was not modified");
});

test("notices: what the project does not ship is named, so nobody expects it in the repository", () => {
  for (const name of ["espeak-ng", "ECDICT", "phoneme model"]) {
    assert.ok(notices.toLowerCase().includes(name.toLowerCase()), `THIRD-PARTY-NOTICES.md must mention ${name}`);
  }
  assert.match(notices, /GPL/);
});
