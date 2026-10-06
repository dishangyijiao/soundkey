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

test("sidepanel style: button and field borders are darker than the dividers, and the pick button is the strongest", () => {
  const root = rulesFor(":root")[0].body;
  const value = (name) => root.match(new RegExp(`${name}:\\s*(#[0-9a-fA-F]{6})`))?.[1];
  const light = (hex) => parseInt(hex.slice(1, 3), 16) + parseInt(hex.slice(3, 5), 16) + parseInt(hex.slice(5, 7), 16);
  assert.ok(value("--control-line") && value("--strong-line"), "the border colors must be defined");
  assert.ok(light(value("--control-line")) < light(value("--line")), "control borders must be darker than dividers");
  assert.ok(light(value("--strong-line")) < light(value("--control-line")), "the pick button border must be the darkest");
  assert.match(rulesFor("button.secondary")[0].body, /border-color:\s*var\(--control-line\)/);
  assert.match(rulesFor(".icon-button")[0].body, /border-color:\s*var\(--control-line\)/);
  assert.match(rulesFor("textarea")[0].body + rules.find((rule) => rule.selectors.includes("input")).body, /border:\s*1px solid var\(--control-line\)/);
  const clip = rulesFor("#clip");
  assert.equal(clip.length, 1, "the pick button needs its own rule");
  assert.match(clip[0].body, /border-color:\s*var\(--strong-line\)/);
  assert.match(clip[0].body, /font-weight:\s*600/);
});

test("sidepanel style: the read button shows a record dot, and a square while recording", () => {
  const dot = rulesFor("button.record::before");
  assert.equal(dot.length, 1);
  assert.match(dot[0].body, /border-radius:\s*50%/);
  const square = rulesFor("button.primary.recording::before");
  assert.equal(square.length, 1);
  assert.doesNotMatch(square[0].body, /border-radius:\s*50%/);
});
