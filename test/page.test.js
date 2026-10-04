const test = require("node:test");
const assert = require("node:assert/strict");
const {
  addPlayer,
  addSubtitlesButton,
  addVideo,
  fakeResponse,
  flush,
  loadPage,
  navigate,
  plain,
  setTextTracks,
} = require("./helpers/scripts.js");

const json = (events) => JSON.stringify({ events });
const GOOD = json([{ tStartMs: 0, dDurationMs: 1000, segs: [{ utf8: "Hello" }] }]);
const GOOD_CUES = [{ text: "Hello", startMs: 0, endMs: 1000 }];
const timedtext = (query = "v=abc&lang=en") => `https://www.youtube.com/api/timedtext?${query}`;
const serving = (body) => () => Promise.resolve(fakeResponse({ body }));
const captionsResponse = (captionTracks) => ({
  captions: { playerCaptionsTracklistRenderer: { captionTracks } },
});

async function cuesFrom(body) {
  const page = loadPage();
  page.captureTimedtext(body);
  return plain(await page.load());
}

// Called every time setTimeout wakes up, to simulate "the page changed while waiting".
function onSleep(page, handler) {
  let count = 0;
  page.clock.onSleep = () => {
    count += 1;
    handler(count);
  };
}

// ---- parseJson3 ----
test("page: parses json3 events: joins text pieces, collapses whitespace, computes the end time", async () => {
  const events = [
    { tStartMs: 0, dDurationMs: 1500, segs: [{ utf8: "Hello  " }, { utf8: "\nworld" }] },
    { tStartMs: 2000, segs: [{ utf8: "No duration" }] },
    { id: 1, wpWinPosId: 1 },
    { tStartMs: 2000, segs: [{ utf8: "Same start" }] },
    { tStartMs: 3000, segs: [{ utf8: "Last" }, {}] },
    { tStartMs: 5000, segs: [{ utf8: "\n" }] },
    { tStartMs: 6000 },
    { tStartMs: 7000, dDurationMs: 0, segs: [{ utf8: "Zero" }] },
  ];
  assert.deepEqual(await cuesFrom(json(events)), [
    { text: "Hello world", startMs: 0, endMs: 1500 },
    { text: "No duration", startMs: 2000, endMs: 3000 },
    { text: "Same start", startMs: 2000, endMs: 3000 },
    { text: "Last", startMs: 3000, endMs: 5000 },
    { text: "Zero", startMs: 7000, endMs: 11000 },
  ]);
});

test("page: json3 without events has no captions", async () => {
  assert.deepEqual(await cuesFrom("{}"), []);
  assert.deepEqual(await cuesFrom("[]"), []);
  assert.deepEqual(await cuesFrom(json([])), []);
});

// ---- parseXml ----
test("page: parses XML captions, converting the start/dur attributes from seconds to milliseconds", async () => {
  const xml = `<?xml version="1.0"?><transcript>
    <text start="1.5" dur="2.25">Hi   there</text>
    <text start="4">No duration</text>
    <text start="5">   </text>
    <text start="5.5"></text>
    <text start="5.0004" dur="1">Rounded</text>
  </transcript>`;
  assert.deepEqual(await cuesFrom(xml), [
    { text: "Hi there", startMs: 1500, endMs: 3750 },
    { text: "No duration", startMs: 4000, endMs: 8000 },
    { text: "Rounded", startMs: 5000, endMs: 6000 },
  ]);
});

test("page: parses XML captions where the t/d attributes are already milliseconds", async () => {
  const xml = `<timedtext format="3"><body>
    <p t="1500" d="2000">One</p>
    <p t="4000">Two</p>
    <p d="500">Three</p>
  </body></timedtext>`;
  assert.deepEqual(await cuesFrom(xml), [
    { text: "One", startMs: 1500, endMs: 3500 },
    { text: "Two", startMs: 4000, endMs: 8000 },
    { text: "Three", startMs: 0, endMs: 500 },
  ]);
});

test("page: broken XML has no captions", async () => {
  assert.deepEqual(await cuesFrom("<text start='1'>oops"), []);
});

// ---- parseBody ----
test("page: strips the )]}' guard prefix and surrounding whitespace before parsing the body", async () => {
  assert.deepEqual(await cuesFrom(`)]}'\n  ${GOOD}  \n`), GOOD_CUES);
});

test("page: an empty body, a body that is neither JSON nor XML, and truncated JSON all have no captions", async () => {
  for (const body of ["", "   ", "hello", "{broken", ")]}'"]) {
    assert.deepEqual(await cuesFrom(body), [], JSON.stringify(body));
  }
});

// ---- note() filtering ----
test("page: an English caption request is recorded, and load returns at once without waiting", async () => {
  const page = loadPage();
  page.captureTimedtext(GOOD);
  const before = page.clock.now;
  assert.deepEqual(plain(await page.load()), GOOD_CUES);
  assert.equal(page.clock.now, before);
  assert.equal(page.fetchCalls.length, 0);
});

test("page: a missing or empty lang is treated as English, and variants such as en-US are accepted", async () => {
  for (const query of ["v=abc", "v=abc&lang=", "v=abc&lang=EN-US", "v=abc&lang=en-GB"]) {
    const page = loadPage();
    page.xhr({ url: timedtext(query), response: GOOD });
    assert.deepEqual(plain(await page.load()), GOOD_CUES, query);
  }
});

test("page: requests that are not English, are translations (tlang), or are not on the /api/timedtext path are ignored", async () => {
  const ignored = [
    timedtext("v=abc&lang=fr"),
    timedtext("v=abc&lang=en&tlang=zh-Hans"),
    "https://www.youtube.com/timedtext_editor?v=abc&lang=en",
    "https://www.youtube.com/api2/timedtext?lang=en&v=abc",
  ];
  for (const url of ignored) {
    const page = loadPage();
    page.xhr({ url, response: GOOD });
    assert.deepEqual(plain(await page.load()), [], url);
  }
});

test("page: an address that cannot be parsed is ignored without throwing", async () => {
  const page = loadPage();
  page.xhr({ url: "https://[timedtext", response: GOOD });
  assert.deepEqual(plain(await page.load()), []);
});

test("page: when the request has no v, uses the video id from the page address", async () => {
  const page = loadPage();
  page.xhr({ url: timedtext("lang=en"), response: GOOD });
  assert.deepEqual(plain(await page.load()), GOOD_CUES);
});

test("page: ignored when neither the request nor the page has a video id", async () => {
  const page = loadPage({ url: "https://www.youtube.com/" });
  page.xhr({ url: timedtext("lang=en"), response: GOOD });
  navigate(page.window, "/watch?v=abc");
  assert.deepEqual(plain(await page.load()), []);
});

test("page: captions of another video do not leak into the current video", async () => {
  const page = loadPage();
  page.captureTimedtext(GOOD, { v: "zzz" });
  assert.deepEqual(plain(await page.load()), []);
});

test("page: after recording another video's captions, going back to that video can use them directly", async () => {
  const page = loadPage();
  page.captureTimedtext(GOOD, { v: "zzz" });
  navigate(page.window, "/watch?v=zzz");
  const before = page.clock.now;
  assert.deepEqual(plain(await page.load()), GOOD_CUES);
  assert.equal(page.clock.now, before);
});

test("page: an empty body does not overwrite recorded captions, and a new non-empty caption does", async () => {
  const page = loadPage();
  page.captureTimedtext(GOOD);
  page.captureTimedtext("");
  assert.deepEqual(plain(await page.load()), GOOD_CUES);
  const newer = json([{ tStartMs: 500, dDurationMs: 500, segs: [{ utf8: "Newer" }] }]);
  page.captureTimedtext(newer);
  assert.deepEqual(plain(await page.load()), [{ text: "Newer", startMs: 500, endMs: 1000 }]);
});

test("page: a request address that carries pot is remembered and used to fetch again when there is no caption content", async () => {
  const page = loadPage({ fetchImpl: serving(GOOD) });
  const href = timedtext("v=abc&lang=en&pot=TOKEN&potc=1");
  page.xhr({ url: href, response: "" });
  assert.deepEqual(plain(await page.load()), GOOD_CUES);
  assert.equal(page.fetchCalls.length, 1);
  assert.equal(page.fetchCalls[0].input, href);
  assert.deepEqual(plain(page.fetchCalls[0].init), { credentials: "include" });
});

test("page: a request address without pot is not remembered", async () => {
  const page = loadPage({ fetchImpl: serving(GOOD) });
  page.xhr({ url: timedtext("v=abc&lang=en"), response: "" });
  assert.deepEqual(plain(await page.load()), []);
  assert.equal(page.fetchCalls.length, 0);
});

test("page: switching video clears the address recorded for the old video", async () => {
  const page = loadPage({ fetchImpl: serving(GOOD) });
  page.xhr({ url: timedtext("v=abc&lang=en&pot=TOKEN"), response: "" });
  navigate(page.window, "/watch?v=def");
  assert.deepEqual(plain(await page.load()), []);
  assert.equal(page.fetchCalls.length, 0);
});

// ---- readXhrBody ----
test("page: an XHR response that is a json object is serialized and then parsed", async () => {
  const page = loadPage();
  page.xhr({ url: timedtext(), responseType: "json", response: JSON.parse(GOOD) });
  assert.deepEqual(plain(await page.load()), GOOD_CUES);
});

test("page: when the json response is empty, falls back to reading responseText", async () => {
  const page = loadPage();
  page.xhr({ url: timedtext(), responseType: "json", response: null, responseText: GOOD });
  assert.deepEqual(plain(await page.load()), GOOD_CUES);
});

test("page: an XHR response that is an arraybuffer is decoded as text", async () => {
  const page = loadPage();
  const buffer = new TextEncoder().encode(GOOD).buffer;
  page.xhr({ url: timedtext(), responseType: "arraybuffer", response: buffer });
  assert.deepEqual(plain(await page.load()), GOOD_CUES);
});

test("page: when the arraybuffer response is empty, falls back to reading responseText", async () => {
  const page = loadPage();
  page.xhr({ url: timedtext(), responseType: "arraybuffer", response: null, responseText: GOOD });
  assert.deepEqual(plain(await page.load()), GOOD_CUES);
});

test("page: an XHR response that is a Blob has its text read asynchronously", async () => {
  const page = loadPage();
  page.xhr({ url: timedtext(), responseType: "blob", response: new page.window.Blob([GOOD]) });
  await flush();
  assert.deepEqual(plain(await page.load()), GOOD_CUES);
});

test("page: swallows the error when reading a Blob fails", async () => {
  const page = loadPage();
  const blob = Object.create(page.window.Blob.prototype);
  blob.text = () => Promise.reject(new Error("读取失败"));
  page.xhr({ url: timedtext(), responseType: "blob", response: blob });
  await flush();
  assert.deepEqual(plain(await page.load()), []);
});

test("page: an XHR response that is a string is parsed directly", async () => {
  const page = loadPage();
  page.xhr({ url: timedtext(), responseType: "text", response: GOOD });
  assert.deepEqual(plain(await page.load()), GOOD_CUES);
});

test("page: when the response is an empty string, falls back to responseText; if both are empty there are no captions", async () => {
  const page = loadPage();
  page.xhr({ url: timedtext(), response: "", responseText: GOOD });
  assert.deepEqual(plain(await page.load()), GOOD_CUES);
  const empty = loadPage();
  empty.xhr({ url: timedtext(), response: "", responseText: "" });
  assert.deepEqual(plain(await empty.load()), []);
});

test("page: when reading the response throws, treats it as an empty body", async () => {
  const page = loadPage();
  page.xhr({
    url: timedtext(),
    setup: (xhr) =>
      Object.defineProperty(xhr, "response", {
        get() {
          throw new Error("InvalidStateError");
        },
      }),
  });
  assert.deepEqual(plain(await page.load()), []);
});

// ---- XHR patch ----
test("page: the patched open records the address and hands it to the original open", () => {
  const page = loadPage();
  const xhr = new page.window.XMLHttpRequest();
  const url = new URL("https://example.com/a");
  const result = xhr.open("POST", url, true, "user");
  assert.equal(result, "opened");
  assert.equal(xhr.opened.length, 1);
  const [method, passedUrl, async, user] = xhr.opened[0];
  assert.deepEqual([method, async, user], ["POST", true, "user"]);
  assert.equal(passedUrl, url);
  assert.equal(xhr.__soundkeyUrl, "https://example.com/a");
});

test("page: the patched send hands over to the original send and returns its result", () => {
  const page = loadPage();
  const xhr = new page.window.XMLHttpRequest();
  assert.equal(xhr.send("body", 2), "sent");
  assert.deepEqual(plain(xhr.sent), [["body", 2]]);
  assert.equal(xhr.listeners.load.length, 1);
});

test("page: when the response address is missing, uses the address recorded at open time", async () => {
  const page = loadPage();
  page.xhr({ url: timedtext(), responseURL: "", response: GOOD });
  assert.deepEqual(plain(await page.load()), GOOD_CUES);
});

test("page: the response address (after a redirect) takes priority over the address at open time", async () => {
  const page = loadPage();
  page.xhr({ url: "https://www.youtube.com/redirect", responseURL: timedtext(), response: GOOD });
  assert.deepEqual(plain(await page.load()), GOOD_CUES);
});

test("page: an XHR with no address, or an address without timedtext, is not read", async () => {
  const page = loadPage();
  let reads = 0;
  const watch = (xhr) =>
    Object.defineProperty(xhr, "response", {
      get() {
        reads += 1;
        return GOOD;
      },
    });
  page.xhr({ setup: watch });
  page.xhr({ url: "https://www.youtube.com/api/stats", setup: watch });
  assert.equal(reads, 0);
  assert.deepEqual(plain(await page.load()), []);
});

test("page: does not patch twice when the script is injected twice", () => {
  const page = loadPage({ loadTwice: true });
  assert.equal(page.window.fetch, page.patched.fetch);
  assert.equal(page.window.XMLHttpRequest.prototype.open, page.patched.open);
  assert.equal(page.window.__soundkeyLoad, page.patched.load);
  assert.notEqual(page.window.fetch, page.originalFetch);
  assert.notEqual(page.window.XMLHttpRequest.prototype.open, page.originals.open);
});

// ---- fetch patch ----
test("page: the patched fetch hands the request to the original fetch and returns the response unchanged", async () => {
  const response = fakeResponse({ url: "https://www.youtube.com/other", body: "" });
  const page = loadPage({ fetchImpl: () => Promise.resolve(response) });
  const init = { method: "GET" };
  const result = await page.window.fetch("https://www.youtube.com/other", init);
  assert.equal(result, response);
  assert.equal(page.fetchCalls[0].input, "https://www.youtube.com/other");
  assert.equal(page.fetchCalls[0].init, init);
  assert.equal(response.cloned, 0);
});

test("page: the response of a caption request is cloned and read, string address", async () => {
  const response = fakeResponse({ url: "", body: GOOD });
  const page = loadPage({ fetchImpl: () => Promise.resolve(response) });
  const result = await page.window.fetch(timedtext());
  assert.equal(result, response);
  assert.equal(response.cloned, 1);
  await flush();
  assert.deepEqual(plain(await page.load()), GOOD_CUES);
  assert.equal(page.fetchCalls.length, 1);
});

test("page: a request object (with url) is also recognized, and the response address takes priority", async () => {
  const response = fakeResponse({ url: timedtext("v=abc&lang=en"), body: GOOD });
  const page = loadPage({ fetchImpl: () => Promise.resolve(response) });
  await page.window.fetch({ url: "https://www.youtube.com/api/timedtext-proxy" });
  await flush();
  assert.deepEqual(plain(await page.load()), GOOD_CUES);
});

test("page: a request without an address is treated as an empty address and its response is not read", async () => {
  for (const input of [undefined, null, {}]) {
    const response = fakeResponse({ url: timedtext(), body: GOOD });
    const page = loadPage({ fetchImpl: () => Promise.resolve(response) });
    await page.window.fetch(input);
    assert.equal(response.cloned, 0);
  }
});

test("page: swallows the error when reading the text of the cloned response fails", async () => {
  const response = fakeResponse({ cloneError: true });
  const page = loadPage({ fetchImpl: () => Promise.resolve(response) });
  const result = await page.window.fetch(timedtext());
  await flush();
  assert.equal(result, response);
  assert.deepEqual(plain(await page.load()), []);
});

// ---- the page's own caption tracks ----
const cue = (text, startTime, endTime) => ({ text, startTime, endTime });
const track = (fields = {}) => ({ language: "en", mode: "showing", cues: [cue("Hi", 1, 2)], ...fields });

test("page: reads the English caption track, rounds times to milliseconds, collapses whitespace", async () => {
  const page = loadPage();
  const video = addVideo(page.document);
  setTextTracks(video, [track({ cues: [cue("  Hi \n there ", 1.2344, 2.5006), cue("Bye", 3, 4)] })]);
  assert.deepEqual(plain(await page.load()), [
    { text: "Hi there", startMs: 1234, endMs: 2501 },
    { text: "Bye", startMs: 3000, endMs: 4000 },
  ]);
});

test("page: once the caption track has been read it is cached and not read again", async () => {
  const page = loadPage();
  const video = addVideo(page.document);
  const tracks = [track()];
  setTextTracks(video, tracks);
  await page.load();
  tracks[0].cues = [cue("Changed", 9, 10)];
  assert.deepEqual(plain(await page.load()), [{ text: "Hi", startMs: 1000, endMs: 2000 }]);
});

test("page: falls back to waiting when there is no video or the video has no textTracks", async () => {
  const none = loadPage();
  assert.deepEqual(plain(await none.load()), []);
  const bare = loadPage();
  setTextTracks(addVideo(bare.document), undefined);
  assert.deepEqual(plain(await bare.load()), []);
});

test("page: a disabled caption track is switched to hidden so its content can be read", async () => {
  const page = loadPage();
  const empty = track({ mode: "disabled", cues: null });
  const none = track({ mode: "disabled", cues: [] });
  const showing = track({ mode: "showing", cues: null });
  setTextTracks(addVideo(page.document), [empty, none, showing]);
  assert.deepEqual(plain(await page.load()), []);
  assert.equal(empty.mode, "hidden");
  assert.equal(none.mode, "hidden");
  assert.equal(showing.mode, "showing");
});

test("page: a non-English caption track is skipped, and a track with an empty language counts as usable", async () => {
  const page = loadPage();
  const french = track({ language: "fr", mode: "disabled", cues: [cue("Bonjour", 1, 2)] });
  const unknown = track({ language: undefined, cues: [cue("Unknown", 3, 4)] });
  setTextTracks(addVideo(page.document), [french, unknown]);
  assert.deepEqual(plain(await page.load()), [{ text: "Unknown", startMs: 3000, endMs: 4000 }]);
  assert.equal(french.mode, "disabled");
});

test("page: an uppercase language code also counts as English", async () => {
  const page = loadPage();
  setTextTracks(addVideo(page.document), [track({ language: "EN-US" })]);
  assert.deepEqual(plain(await page.load()), [{ text: "Hi", startMs: 1000, endMs: 2000 }]);
});

test("page: when a track holds only blank cues, moves on to the next track", async () => {
  const page = loadPage();
  const blank = track({ cues: [cue("   ", 1, 2), { startTime: 2, endTime: 3 }] });
  const next = track({ cues: [cue("Real", 5, 6)] });
  setTextTracks(addVideo(page.document), [blank, next]);
  assert.deepEqual(plain(await page.load()), [{ text: "Real", startMs: 5000, endMs: 6000 }]);
});

test("page: returns at once when the caption track gets content while waiting", async () => {
  const page = loadPage();
  const late = track({ cues: [] });
  setTextTracks(addVideo(page.document), [late]);
  onSleep(page, (count) => {
    if (count === 2) late.cues = [cue("Later", 1, 2)];
  });
  const start = page.clock.now;
  assert.deepEqual(plain(await page.load()), [{ text: "Later", startMs: 1000, endMs: 2000 }]);
  assert.equal(page.clock.now - start, 600);
});

// ---- enableEnglish ----
const tracklist = [
  { languageCode: "fr", kind: "standard" },
  { languageCode: "en", kind: "asr", id: "auto" },
  {},
  { languageCode: "EN-US", kind: "standard", id: "manual" },
];

function playerWith(page, members = {}, options = {}) {
  const calls = { setOption: [], toggle: 0 };
  const player = addPlayer(page.document, {
    getOption: () => tracklist,
    setOption: (...args) => calls.setOption.push(args),
    toggleSubtitles: () => {
      calls.toggle += 1;
    },
    ...members,
  });
  const button = addSubtitlesButton(page.document, options);
  return { player, button, calls };
}

test("page: when turning on English captions, prefers a track that is not auto-generated, and sets it only once", async () => {
  const page = loadPage();
  const { calls, button } = playerWith(page);
  await page.load();
  assert.equal(calls.setOption.length, 1);
  assert.equal(calls.setOption[0][0], "captions");
  assert.equal(calls.setOption[0][1], "track");
  assert.equal(calls.setOption[0][2].id, "manual");
  assert.equal(calls.toggle, 0);
  assert.equal(button.fake.clicks, 0);
});

test("page: uses the auto-generated English track when it is the only one", async () => {
  const page = loadPage();
  const { calls } = playerWith(page, { getOption: () => [{ languageCode: "en", kind: "asr", id: "auto" }] });
  await page.load();
  assert.equal(calls.setOption[0][2].id, "auto");
});

test("page: does nothing when the caption button is already pressed", async () => {
  const page = loadPage();
  const { calls, button } = playerWith(page, {}, { pressed: true });
  await page.load();
  assert.deepEqual(calls.setOption, []);
  assert.equal(calls.toggle, 0);
  assert.equal(button.fake.clicks, 0);
});

test("page: calls the player's toggleSubtitles when no English track is found", async () => {
  for (const getOption of [() => [{ languageCode: "fr" }], () => undefined, undefined]) {
    const page = loadPage();
    const { calls, button } = playerWith(page, { getOption });
    await page.load();
    assert.deepEqual(calls.setOption, []);
    assert.equal(calls.toggle, 1);
    assert.equal(button.fake.clicks, 0);
  }
});

test("page: also goes through toggleSubtitles when there is no setOption", async () => {
  const page = loadPage();
  const { calls } = playerWith(page, { setOption: undefined });
  await page.load();
  assert.equal(calls.toggle, 1);
});

test("page: goes through toggleSubtitles when reading the track list throws", async () => {
  const page = loadPage();
  const { calls } = playerWith(page, {
    getOption: () => {
      throw new Error("播放器还没准备好");
    },
  });
  await page.load();
  assert.deepEqual(calls.setOption, []);
  assert.equal(calls.toggle, 1);
});

test("page: clicks the caption button when the player has no toggleSubtitles", async () => {
  const page = loadPage();
  const { button } = playerWith(page, { getOption: undefined, toggleSubtitles: undefined });
  await page.load();
  assert.equal(button.fake.clicks, 1);
});

test("page: when the player or the caption button appears late, enables once both are there", async () => {
  const page = loadPage();
  const calls = [];
  onSleep(page, (count) => {
    if (count === 1) {
      addPlayer(page.document, {
        getOption: () => tracklist,
        setOption: (...args) => calls.push(["setOption", args[2].id]),
      });
    }
    if (count === 2) {
      calls.push(["buttonAdded"]);
      addSubtitlesButton(page.document);
    }
  });
  await page.load();
  assert.deepEqual(calls, [["buttonAdded"], ["setOption", "manual"]]);
});

test("page: does not enable when there is a caption button but no player", async () => {
  const page = loadPage();
  const button = addSubtitlesButton(page.document);
  await page.load();
  assert.equal(button.fake.clicks, 0);
});

test("page: repeated loads of the same video enable it only once, and again after a video change", async () => {
  const page = loadPage();
  const { calls } = playerWith(page);
  await page.load();
  await page.load();
  assert.equal(calls.setOption.length, 1);
  navigate(page.window, "/watch?v=def");
  await page.load();
  assert.equal(calls.setOption.length, 2);
});

// ---- urlWithPot ----
const MANUAL_BASE = "/api/timedtext?v=abc&lang=en&fmt=srv3";
const AUDIO_ITEMS = [
  { url: "http://[bad" },
  { url: timedtext("v=other&lang=en&pot=OTHER") },
  { url: timedtext("v=abc&lang=fr&pot=FRENCH") },
  { url: timedtext("v=abc&lang=en") },
  { url: timedtext("v=abc&lang=en&pot=GOOD&potc=C") },
  { url: timedtext("v=abc&lang=en&pot=LATER&potc=L") },
];

function mintPage({ audio, response, fetchImpl = serving(GOOD) } = {}) {
  const page = loadPage({ fetchImpl });
  addPlayer(page.document, {
    getPlayerResponse: () => response,
    ...(audio === undefined ? {} : { getAudioTrack: () => audio }),
  });
  return page;
}

const mintResponse = captionsResponse([
  { languageCode: "en", kind: "asr", baseUrl: "/api/timedtext?v=abc&lang=en&kind=asr" },
  { languageCode: "fr", baseUrl: "/api/timedtext?v=abc&lang=fr" },
  { baseUrl: "/api/timedtext?v=abc&lang=none" },
  { languageCode: "en", baseUrl: MANUAL_BASE },
]);

test("page: builds the caption address from the pot in the player's audio track, choosing the non-auto-generated English track", async () => {
  const page = mintPage({ response: mintResponse, audio: { captionTracks: AUDIO_ITEMS } });
  assert.deepEqual(plain(await page.load()), GOOD_CUES);
  assert.equal(
    page.fetchCalls[0].input,
    "https://www.youtube.com/api/timedtext?v=abc&lang=en&fmt=json3&c=WEB&pot=GOOD&potc=C",
  );
  assert.equal(page.fetchCalls.length, 1);
});

test("page: does not add the potc parameter when the audio track has no potc", async () => {
  const items = [{ url: timedtext("v=abc&lang=en&pot=ONLY") }];
  const page = mintPage({ response: mintResponse, audio: { captionTracks: items } });
  await page.load();
  assert.equal(
    page.fetchCalls[0].input,
    "https://www.youtube.com/api/timedtext?v=abc&lang=en&fmt=json3&c=WEB&pot=ONLY",
  );
});

test("page: can also build the address when the only caption track is auto-generated English", async () => {
  const response = captionsResponse([{ languageCode: "en", kind: "asr", baseUrl: "/api/timedtext?v=abc&kind=asr" }]);
  const page = mintPage({ response, audio: { captionTracks: [{ url: timedtext("pot=P") }] } });
  await page.load();
  assert.equal(
    page.fetchCalls[0].input,
    "https://www.youtube.com/api/timedtext?v=abc&kind=asr&fmt=json3&c=WEB&pot=P",
  );
});

test("page: cannot build an address when the audio track has no captionTracks, no getAudioTrack or no pot", async () => {
  const variants = [{ audio: {} }, { audio: undefined }, { audio: null }, { audio: { captionTracks: [] } }];
  for (const variant of variants) {
    const page = mintPage({ response: mintResponse, ...variant });
    assert.deepEqual(plain(await page.load()), [], JSON.stringify(variant));
    assert.equal(page.fetchCalls.length, 0);
  }
});

test("page: cannot build an address when there is no English caption track, no baseUrl or no caption info", async () => {
  const audio = { captionTracks: [{ url: timedtext("pot=P") }] };
  const responses = [
    undefined,
    {},
    { captions: {} },
    captionsResponse([]),
    captionsResponse([{ languageCode: "fr", baseUrl: "/api/timedtext?lang=fr" }]),
    captionsResponse([{ languageCode: "en" }]),
  ];
  for (const response of responses) {
    const page = mintPage({ response, audio });
    assert.deepEqual(plain(await page.load()), [], JSON.stringify(response));
    assert.equal(page.fetchCalls.length, 0);
  }
});

const mintedOnly = (url) => Promise.resolve(fakeResponse({ body: url.includes("fmt=json3") ? GOOD : "" }));

test("page: reads ytInitialPlayerResponse when the player has no getPlayerResponse, returns nothing, or there is no player", async () => {
  const response = captionsResponse([{ languageCode: "en", baseUrl: MANUAL_BASE }]);
  const players = {
    "getPlayerResponse 返回 null": (page) => addPlayer(page.document, { getPlayerResponse: () => null }),
    没有播放器: () => {},
    "播放器没有 getPlayerResponse": (page) => addPlayer(page.document),
  };
  for (const [name, install] of Object.entries(players)) {
    const page = loadPage({ fetchImpl: mintedOnly });
    page.window.ytInitialPlayerResponse = response;
    install(page);
    page.xhr({ url: timedtext("v=abc&lang=en&pot=CACHED"), response: "" });
    assert.deepEqual(plain(await page.load()), GOOD_CUES, name);
    assert.equal(
      page.fetchCalls[1].input,
      "https://www.youtube.com/api/timedtext?v=abc&lang=en&fmt=json3&c=WEB&pot=CACHED",
      name,
    );
  }
});

test("page: when the captured address yields no captions, rebuilds the address with the cached pot and potc", async () => {
  const page = loadPage({ fetchImpl: mintedOnly });
  page.window.ytInitialPlayerResponse = captionsResponse([{ languageCode: "en", baseUrl: "/api/timedtext?v=abc&lang=en" }]);
  const captured = timedtext("v=abc&lang=en&pot=CACHED&potc=CC");
  page.xhr({ url: captured, response: "" });
  assert.deepEqual(plain(await page.load()), GOOD_CUES);
  assert.deepEqual(
    page.fetchCalls.map((call) => call.input),
    [captured, "https://www.youtube.com/api/timedtext?v=abc&lang=en&fmt=json3&c=WEB&pot=CACHED&potc=CC"],
  );
});

test("page: the pot in the player's audio track takes priority over the cached pot", async () => {
  const page = mintPage({
    response: captionsResponse([{ languageCode: "en", baseUrl: "/api/timedtext?v=abc&lang=en" }]),
    audio: { captionTracks: [{ url: timedtext("v=abc&lang=en&pot=AUDIO") }] },
    fetchImpl: (url) => Promise.resolve(fakeResponse({ body: url.includes("pot=AUDIO") ? GOOD : "" })),
  });
  page.xhr({ url: timedtext("v=abc&lang=en&pot=CACHED"), response: "" });
  assert.deepEqual(plain(await page.load()), GOOD_CUES);
  assert.equal(page.fetchCalls.length, 2);
  assert.ok(page.fetchCalls[1].input.includes("pot=AUDIO"));
});

test("page: does not request again an address that was built once and yielded no captions", async () => {
  const page = mintPage({
    response: mintResponse,
    audio: { captionTracks: [{ url: timedtext("v=abc&lang=en&pot=P") }] },
    fetchImpl: serving(""),
  });
  assert.deepEqual(plain(await page.load()), []);
  assert.equal(page.fetchCalls.length, 1);
});

// ---- load() flow ----
test("page: returns an empty array when the page address has no video id", async () => {
  const page = loadPage({ url: "https://www.youtube.com/" });
  const before = page.clock.now;
  assert.deepEqual(plain(await page.load()), []);
  assert.equal(page.clock.now, before);
});

test("page: returns an empty array when there are still no captions after waiting more than 8 seconds", async () => {
  const page = loadPage();
  const start = page.clock.now;
  assert.deepEqual(plain(await page.load()), []);
  assert.ok(page.clock.now - start >= 8000);
  assert.ok(page.clock.now - start < 8000 + 300);
});

test("page: returns at once when the page requests captions while waiting", async () => {
  const page = loadPage();
  onSleep(page, (count) => {
    if (count === 2) page.captureTimedtext(GOOD);
  });
  const start = page.clock.now;
  assert.deepEqual(plain(await page.load()), GOOD_CUES);
  assert.equal(page.clock.now - start, 600);
});

test("page: fetches an address that carries pot when one is captured while waiting", async () => {
  const page = loadPage({ fetchImpl: serving(GOOD) });
  onSleep(page, (count) => {
    if (count === 1) page.xhr({ url: timedtext("v=abc&lang=en&pot=LATE"), response: "" });
  });
  assert.deepEqual(plain(await page.load()), GOOD_CUES);
  assert.equal(page.fetchCalls.length, 1);
});

test("page: gives up and returns an empty array when the user switches to another video while waiting", async () => {
  const page = loadPage();
  onSleep(page, (count) => {
    if (count === 2) navigate(page.window, "/watch?v=def");
  });
  const start = page.clock.now;
  assert.deepEqual(plain(await page.load()), []);
  assert.equal(page.clock.now - start, 600);
});

test("page: discards the captions fetched when the video changed during the address fetch", async () => {
  const page = loadPage({
    fetchImpl: () => {
      navigate(page.window, "/watch?v=def");
      return Promise.resolve(fakeResponse({ body: GOOD }));
    },
  });
  page.xhr({ url: timedtext("v=abc&lang=en&pot=TOKEN"), response: "" });
  assert.deepEqual(plain(await page.load()), []);
  assert.equal(page.fetchCalls.length, 1);
});

test("page: keeps waiting when fetching the address fails, without requesting the same address again", async () => {
  const failures = [
    () => Promise.reject(new Error("网络错误")),
    () => Promise.resolve({ text: () => Promise.reject(new Error("读取失败")) }),
  ];
  for (const fetchImpl of failures) {
    const page = loadPage({ fetchImpl });
    page.xhr({ url: timedtext("v=abc&lang=en&pot=TOKEN"), response: "" });
    assert.deepEqual(plain(await page.load()), []);
    assert.equal(page.fetchCalls.length, 1);
  }
});

test("page: also returns captions received during the last wait", async () => {
  const page = loadPage();
  const start = page.clock.now;
  onSleep(page, () => {
    if (page.clock.now >= start + 8000) page.captureTimedtext(GOOD);
  });
  assert.deepEqual(plain(await page.load()), GOOD_CUES);
});

test("page: returns an empty array when the video changed during the last wait", async () => {
  const page = loadPage();
  const start = page.clock.now;
  onSleep(page, () => {
    if (page.clock.now >= start + 8000) {
      page.captureTimedtext(GOOD);
      navigate(page.window, "/watch?v=def");
    }
  });
  assert.deepEqual(plain(await page.load()), []);
});

test("page: stops waiting once fetching the address takes longer than the deadline", async () => {
  const page = loadPage({
    fetchImpl: () => {
      page.clock.now += 9000;
      return Promise.resolve(fakeResponse({ body: "" }));
    },
  });
  page.xhr({ url: timedtext("v=abc&lang=en&pot=TOKEN"), response: "" });
  const start = page.clock.now;
  assert.deepEqual(plain(await page.load()), []);
  assert.equal(page.clock.now - start, 9000 + 300);
});
