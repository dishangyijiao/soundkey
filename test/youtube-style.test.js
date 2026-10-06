const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const DIR = path.join(__dirname, "..", "extension");
const manifest = JSON.parse(fs.readFileSync(path.join(DIR, "manifest.json"), "utf8"));
const youtubeScripts = manifest.content_scripts.filter((entry) => entry.matches.includes("https://www.youtube.com/*"));

test("youtube style: the stylesheet is loaded on YouTube pages and the file exists", () => {
  const withCss = youtubeScripts.filter((entry) => (entry.css || []).includes("youtube.css"));
  assert.equal(withCss.length, 1, "exactly one content script entry should load youtube.css");
  assert.ok(fs.existsSync(path.join(DIR, "youtube.css")));
});

test("youtube style: it hides the recommended videos on watch pages and nothing else", () => {
  const css = fs.readFileSync(path.join(DIR, "youtube.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((match) => ({ selectors: match[1].split(",").map((s) => s.trim()), body: match[2] }));
  assert.ok(rules.length > 0);
  for (const { selectors, body } of rules) {
    assert.match(body, /display:\s*none\s*!important/);
    for (const selector of selectors) {
      // ytd-watch-flexy exists only on a watch page, so the home page, search and channel pages are untouched.
      assert.ok(selector.startsWith("ytd-watch-flexy "), `selector is not scoped to the watch page: ${selector}`);
    }
  }
  const text = rules.flatMap((rule) => rule.selectors).join(" ");
  assert.match(text, /#related/);
});

test("youtube style: no new permission is needed for it", () => {
  assert.deepEqual([...manifest.permissions].sort(), ["scripting", "sidePanel"]);
  assert.deepEqual(manifest.host_permissions, ["https://www.youtube.com/*", "http://127.0.0.1:17321/*"]);
});
