const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

// jsdom does not compute styles, so these read the stylesheet text. They pin rules that are easy to lose when the file is
// reorganized; whether the result looks right is checked by rendering it.
const css = fs.readFileSync(path.join(__dirname, "..", "extension", "sidepanel.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((match) => ({
  selectors: match[1].split(",").map((selector) => selector.trim().replace(/\s+/g, " ")),
  body: match[2],
}));
const rulesFor = (selector) => rules.filter((rule) => rule.selectors.includes(selector));

test("sidepanel style: each kind of button has a pressed state, so a click is acknowledged at once", () => {
  for (const selector of [
    "button.primary:active:not(:disabled)",
    "button.primary.recording:active:not(:disabled)",
    "button.secondary:active:not(:disabled)",
    "button.text-button:active:not(:disabled)",
    "button.icon-button:active:not(:disabled)",
  ]) {
    const found = rulesFor(selector);
    assert.equal(found.length, 1, `missing a pressed rule for ${selector}`);
    assert.match(found[0].body, /background:/);
  }
});

test("sidepanel style: there is no pressed rule for every button, which would grey out phoneme chips and tabs", () => {
  const everyButton = rules.filter((rule) => rule.selectors.includes("button:active:not(:disabled)") || rule.selectors.includes("button:active"));
  assert.deepEqual(everyButton, []);
});

test("sidepanel style: the edit button lines up with the right edge and is quieter than the heading it sits next to", () => {
  const offset = rulesFor(".section-head .text-button");
  assert.equal(offset.length, 1, "the text button in a section heading needs a rule that cancels its own padding");
  assert.match(offset[0].body, /margin-right:\s*-8px/);
  const quiet = rulesFor(".text-button.small");
  assert.ok(quiet.length >= 1);
  const body = quiet.map((rule) => rule.body).join(";");
  assert.match(body, /font-weight:\s*400/);
  assert.match(body, /color:\s*var\(--muted\)/);
});
