// Test bench for sidepanel.js: builds a jsdom from the real sidepanel.html and replaces fetch, chrome,
// Audio, the microphone, AudioContext and the timers with controllable stand-ins.
//
// A script must run in the jsdom context with a file:// file name so that coverage counts the source files under extension/.
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { pathToFileURL } = require("node:url");
const { JSDOM } = require("jsdom");

const EXTENSION_DIR = path.resolve(__dirname, "..", "..", "extension");
const OPENAPI_PATHS = JSON.parse(fs.readFileSync(path.resolve(__dirname, "..", "..", "contracts", "openapi", "openapi.json"), "utf8")).paths;
const EXTENSION_ID = "test-extension-id";

function readExtensionFile(name) {
  return fs.readFileSync(path.join(EXTENSION_DIR, name), "utf8");
}

function runScript(dom, name) {
  const absolute = path.join(EXTENSION_DIR, name);
  const script = new vm.Script(readExtensionFile(name), { filename: pathToFileURL(absolute).href });
  script.runInContext(dom.getInternalVMContext());
}

function loadDocument() {
  const html = readExtensionFile("sidepanel.html").replace(/<script\b[^>]*>\s*<\/script>/g, "");
  return new JSDOM(html, { runScripts: "outside-only", url: "http://localhost/" });
}

// Close enough to a fetch Response: sidepanel.js only reads ok and json().
function json(body, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function flush() {
  return new Promise((resolve) => setImmediate(resolve));
}

function networkError() {
  return new TypeError("Failed to fetch");
}

function hasContractOperation(method, pathname) {
  const actual = pathname.split("/");
  return Object.entries(OPENAPI_PATHS).some(([template, operations]) => {
    const expected = template.split("/");
    const matches = expected.length === actual.length && expected.every((part, index) =>
      part.startsWith("{") && part.endsWith("}") ? actual[index].length > 0 : part === actual[index]);
    return matches && Object.hasOwn(operations, method.toLowerCase());
  });
}

// Converts objects made inside the jsdom context into plain objects of this test context, so deepEqual does not fail on different prototypes.
const plain = (value) => (value === undefined ? value : JSON.parse(JSON.stringify(value)));

function parseBody(raw) {
  if (typeof raw !== "string") return raw;
  try {
    return JSON.parse(raw);
  } catch (_error) {
    return raw;
  }
}

function installFetch(window, rig) {
  window.fetch = async (url, init = {}) => {
    const parsed = new URL(url);
    const method = (init.method || "GET").toUpperCase();
    const call = {
      method,
      url: String(url),
      path: parsed.pathname,
      query: parsed.searchParams,
      headers: init.headers || {},
      body: parseBody(init.body),
    };
    if (!hasContractOperation(method, parsed.pathname)) {
      throw new Error(`${method} ${parsed.pathname} is not declared by OpenAPI`);
    }
    rig.calls.push(call);
    if (!rig.server.up) throw networkError();
    const handler = rig.routes.get(`${method} ${parsed.pathname}`);
    if (!handler) {
      rig.unrouted.push(call);
      throw networkError();
    }
    return typeof handler === "function" ? handler(call) : handler;
  };
}

function installChrome(window, rig) {
  const removedListeners = [];
  const nextTabId = { value: 100 };
  window.chrome = {
    runtime: {
      id: EXTENSION_ID,
      getURL: (file) => `chrome-extension://${EXTENSION_ID}/${file}`,
      sendMessage: async (message) => {
        rig.messages.push(plain(message));
        const reply = rig.replies[message.type];
        const value = typeof reply === "function" ? reply(message) : reply;
        if (value instanceof Error) throw value;
        return value;
      },
    },
    tabs: {
      create(options, callback) {
        rig.tabsCreated.push(plain(options));
        const tab = rig.tabs.factory(options, nextTabId);
        if (callback) {
          queueMicrotask(() => callback(tab));
          return undefined;
        }
        return Promise.resolve(tab);
      },
      onRemoved: {
        addListener: (listener) => removedListeners.push(listener),
        removeListener: (listener) => {
          const index = removedListeners.indexOf(listener);
          if (index >= 0) removedListeners.splice(index, 1);
        },
      },
    },
  };
  rig.removedListeners = removedListeners;
  rig.closeTab = (tabId) => {
    for (const listener of [...removedListeners]) listener(tabId);
  };
}

function installAudio(window, rig) {
  class FakeAudio {
    constructor(url) {
      this.url = url;
      this.pauses = 0;
      this.plays = 0;
      rig.sounds.instances.push(this);
    }

    pause() {
      this.pauses += 1;
    }

    play() {
      this.plays += 1;
      return rig.sounds.behaviour(this);
    }
  }
  window.Audio = FakeAudio;
}

function installMicrophone(window, rig) {
  const mic = rig.mic;
  Object.defineProperty(window.navigator, "permissions", {
    configurable: true,
    value: {
      query: async (descriptor) => {
        mic.queries.push(descriptor);
        if (mic.queryError) throw mic.queryError;
        return { state: mic.state };
      },
    },
  });
  Object.defineProperty(window.navigator, "mediaDevices", {
    configurable: true,
    value: {
      getUserMedia: async (constraints) => {
        mic.requests.push(plain(constraints));
        if (mic.streamError) throw mic.streamError;
        const stream = {
          stopped: 0,
          getTracks: () => [{ stop: () => (stream.stopped += 1) }, { stop: () => (stream.stopped += 1) }],
        };
        mic.streams.push(stream);
        return stream;
      },
    },
  });
}

function installAudioGraph(window, rig) {
  const graph = rig.graph;
  class FakeAudioContext {
    constructor() {
      this.sampleRate = graph.sampleRate;
      this.closed = false;
      this.sources = [];
      this.audioWorklet = {
        addModule: async (url) => {
          graph.modules.push(url);
          if (graph.moduleError) throw graph.moduleError;
        },
      };
      graph.contexts.push(this);
    }

    createMediaStreamSource(stream) {
      if (graph.sourceError) throw graph.sourceError;
      const source = {
        stream,
        connected: null,
        disconnected: false,
        connect(node) {
          source.connected = node;
        },
        disconnect() {
          source.disconnected = true;
        },
      };
      this.sources.push(source);
      return source;
    }

    async close() {
      this.closed = true;
    }
  }
  class FakeAudioWorkletNode {
    constructor(context, name, options) {
      if (graph.nodeError) throw graph.nodeError;
      this.context = context;
      this.name = name;
      this.options = plain(options);
      this.port = {
        onmessage: null,
        closed: false,
        close: () => {
          this.port.closed = true;
        },
      };
      graph.nodes.push(this);
    }
  }
  window.AudioContext = FakeAudioContext;
  window.AudioWorkletNode = FakeAudioWorkletNode;
}

function installTimers(window, rig) {
  const timers = rig.timers;
  let nextId = 1;
  window.setInterval = (fn, ms) => {
    const timer = { id: nextId++, fn, ms, cleared: false };
    timers.intervals.push(timer);
    return timer.id;
  };
  window.setTimeout = (fn, ms) => {
    const timer = { id: nextId++, fn, ms, cleared: false };
    timers.timeouts.push(timer);
    return timer.id;
  };
  window.clearTimeout = (id) => {
    for (const timer of timers.timeouts) if (timer.id === id) timer.cleared = true;
  };
  window.clearInterval = (id) => {
    for (const timer of timers.intervals) if (timer.id === id) timer.cleared = true;
  };
}

// jsdom does no layout: positions and sizes are all 0. A test supplies them through layout when it needs them.
function installLayout(window, rig) {
  const layout = rig.layout;
  const proto = window.HTMLElement.prototype;
  proto.getBoundingClientRect = function () {
    return { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0, ...layout.rectFor(this) };
  };
  for (const [name, key] of [
    ["offsetWidth", "width"],
    ["offsetHeight", "height"],
    ["scrollHeight", "scrollHeight"],
  ]) {
    Object.defineProperty(proto, name, { configurable: true, get() { return layout.sizeFor(this)[key] ?? 0; } });
  }
}

function pendingTimeouts(rig) {
  return rig.timers.timeouts.filter((timer) => !timer.cleared);
}

function createRig() {
  const rig = {
    calls: [],
    unrouted: [],
    routes: new Map(),
    messages: [],
    replies: { "get-cue": { state: "no-video", cue: null } },
    tabsCreated: [],
    tabs: { factory: (_options, nextTabId) => ({ id: nextTabId.value++ }) },
    sounds: { instances: [], behaviour: () => Promise.resolve() },
    mic: { state: "granted", queryError: null, streamError: null, queries: [], requests: [], streams: [] },
    graph: { sampleRate: 48000, modules: [], contexts: [], nodes: [], moduleError: null, sourceError: null, nodeError: null },
    timers: { intervals: [], timeouts: [] },
    layout: { rectFor: () => ({}), sizeFor: () => ({}) },
    server: { up: true },
    data: { cards: [], words: [] },
  };
  rig.routes.set("GET /health", () => json({ ok: true }));
  rig.routes.set("GET /cards", () => json({ cards: rig.data.cards }));
  rig.routes.set("GET /words", () => json({ words: rig.data.words }));
  return rig;
}

// A brand-new jsdom for every test. `options.routes` looks like { "POST /cards": handler },
// `options.cards` / `options.words` are the data already on the server.
async function createPanel(t, options = {}) {
  const dom = loadDocument();
  const { window } = dom;
  const { document } = window;
  const rig = createRig();
  Object.assign(rig.data, { cards: options.cards || [], words: options.words || [] });
  Object.assign(rig.server, options.server);
  if (options.cue !== undefined) rig.replies["get-cue"] = options.cue;
  if (options.mic) Object.assign(rig.mic, options.mic);
  for (const [key, handler] of Object.entries(options.routes || {})) rig.routes.set(key, handler);

  installFetch(window, rig);
  installChrome(window, rig);
  installAudio(window, rig);
  installMicrophone(window, rig);
  installAudioGraph(window, rig);
  installTimers(window, rig);
  installLayout(window, rig);
  t?.after(() => window.close());

  const $ = (selector) => document.querySelector(selector);
  const $$ = (selector) => [...document.querySelectorAll(selector)];
  const fire = (target, type, init = {}) => target.dispatchEvent(new window.Event(type, { bubbles: true, cancelable: true, ...init }));
  const panel = {
    ...rig,
    dom,
    window,
    document,
    $,
    $$,
    flush,
    json,
    deferred,
    route: (key, handler) => rig.routes.set(key, handler),
    callsTo: (key) => rig.calls.filter((call) => `${call.method} ${call.path}` === key),
    async click(target) {
      (typeof target === "string" ? $(target) : target).click();
      await flush();
    },
    async press(target, key) {
      const node = typeof target === "string" ? $(target) : target;
      const event = new window.KeyboardEvent("keydown", { key, bubbles: true, cancelable: true });
      node.dispatchEvent(event);
      await flush();
      return event;
    },
    async pointerDown(target) {
      fire(target, "pointerdown");
      await flush();
    },
    async type(selector, value) {
      const node = $(selector);
      node.value = value;
      fire(node, "input");
      await flush();
    },
    async cue(cue, state = "ok") {
      rig.replies["get-cue"] = { state, cue };
      await panel.pollCue();
    },
    intervalFor(ms) {
      return rig.timers.intervals.find((timer) => timer.ms === ms && !timer.cleared);
    },
    async pollHealth() {
      panel.intervalFor(2000).fn();
      await flush();
    },
    async pollCue() {
      panel.intervalFor(400).fn();
      await flush();
    },
    pendingTimeouts: () => pendingTimeouts(rig),
    async runTimeouts() {
      const due = pendingTimeouts(rig);
      for (const timer of due) timer.cleared = true;
      for (const timer of due) timer.fn();
      await flush();
    },
    push: (samples) => {
      const node = rig.graph.nodes.at(-1);
      node.port.onmessage({ data: Float32Array.from(samples) });
    },
    sound: () => rig.sounds.instances.at(-1),
    hidden: (selector) => $(selector).hidden,
    text: (selector) => $(selector).textContent,
  };

  runScript(dom, "cues.js");
  runScript(dom, "audio.js");
  runScript(dom, "sidepanel.js");
  await flush();
  return panel;
}

const card = (overrides = {}) => ({
  id: "c1",
  text: "Hello there world.",
  source: "paste",
  score: null,
  latest_attempt_id: null,
  ...overrides,
});

const word = (overrides = {}) => ({
  id: "w1",
  word: "hello",
  ipa: "həˈləʊ",
  definition: "你好\n第二行",
  score: null,
  latest_attempt_id: null,
  source_sentence: null,
  ...overrides,
});

const ph = (phone, bad = false) => ({ phone, bad });

module.exports = { createPanel, json, deferred, flush, networkError, card, word, ph, EXTENSION_ID };
