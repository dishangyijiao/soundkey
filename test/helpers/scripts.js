// 把扩展里的普通浏览器脚本放进隔离的 vm / jsdom 环境运行，供各脚本的测试共用。
// 脚本必须带 file:// 文件名执行，node 的覆盖率才会算到 extension/ 下的源文件上。
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { pathToFileURL } = require("node:url");
const { JSDOM } = require("jsdom");

const EXTENSION_DIR = path.join(__dirname, "..", "..", "extension");
const WATCH_URL = "https://www.youtube.com/watch?v=abc";

function runExtensionFile(context, name) {
  const file = path.join(EXTENSION_DIR, name);
  const script = new vm.Script(fs.readFileSync(file, "utf8"), { filename: pathToFileURL(file).href });
  return script.runInContext(context);
}

// vm 上下文里造出来的对象原型不同，深比较前先转成本领域的普通对象。
function plain(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

// 等待所有已排队的微任务（promise 链）跑完。
function flush() {
  return new Promise((resolve) => setImmediate(resolve));
}

// 可控的时钟：手动推进，或者 auto 模式下 setTimeout 立刻"睡完"（时间前进，回调进微任务）。
function createClock(start = 1_700_000_000_000) {
  const timers = new Map();
  let nextId = 1;
  const clock = {
    now: start,
    auto: false,
    onSleep: null,
    timers,
    nowFn: () => clock.now,
    setTimeout(fn, ms = 0) {
      const id = nextId++;
      timers.set(id, { fn, ms, at: clock.now + ms, repeat: false });
      if (clock.auto) {
        queueMicrotask(() => {
          if (!timers.delete(id)) return;
          clock.now += ms;
          clock.onSleep?.(ms);
          fn();
        });
      }
      return id;
    },
    setInterval(fn, ms = 0) {
      const id = nextId++;
      timers.set(id, { fn, ms, at: clock.now + ms, repeat: true });
      return id;
    },
    clearTimeout(id) {
      timers.delete(id);
    },
    clearInterval(id) {
      timers.delete(id);
    },
    advance(ms) {
      const target = clock.now + ms;
      for (;;) {
        let nextId_ = null;
        let next = null;
        for (const [id, timer] of timers) {
          if (timer.at <= target && (!next || timer.at < next.at)) {
            next = timer;
            nextId_ = id;
          }
        }
        if (!next) break;
        clock.now = Math.max(clock.now, next.at);
        if (next.repeat) next.at += next.ms;
        else timers.delete(nextId_);
        next.fn();
      }
      clock.now = target;
    },
    // 不动时间，直接触发所有 setInterval 回调。
    tickIntervals() {
      for (const timer of [...timers.values()]) if (timer.repeat) timer.fn();
    },
    intervals() {
      return [...timers.values()].filter((timer) => timer.repeat);
    },
    pending() {
      return [...timers.values()].filter((timer) => !timer.repeat);
    },
  };
  return clock;
}

function installClock(context, clock) {
  vm.runInContext("(fn) => { Date.now = fn; }", context)(clock.nowFn);
}

// chrome.* 的桩。行为放在 behavior 里，测试可以随时改。
function createChrome(overrides = {}) {
  const calls = {
    sendMessage: [],
    tabsQuery: [],
    tabsSendMessage: [],
    reload: [],
    create: [],
    executeScript: [],
    setPanelBehavior: [],
  };
  const messageListeners = [];
  const installedListeners = [];
  const behavior = {
    sendMessage: () => Promise.resolve(undefined),
    setPanelBehavior: () => Promise.resolve(),
    tabs: [],
    tabsSendMessageResponse: undefined,
    tabsSendMessageError: null,
    tabsSendMessagePromise: () => Promise.resolve(),
    executeScript: () => Promise.resolve([{ result: [] }]),
    ...overrides,
  };
  const chrome = {
    runtime: {
      id: "fengsong-extension-id",
      lastError: undefined,
      onMessage: { addListener: (listener) => messageListeners.push(listener) },
      onInstalled: { addListener: (listener) => installedListeners.push(listener) },
      sendMessage: (message) => {
        calls.sendMessage.push(message);
        return behavior.sendMessage(message);
      },
    },
    sidePanel: {
      setPanelBehavior: (options) => {
        calls.setPanelBehavior.push(options);
        return behavior.setPanelBehavior(options);
      },
    },
    tabs: {
      query: (filter, callback) => {
        calls.tabsQuery.push(filter);
        callback(behavior.tabs);
      },
      sendMessage: (tabId, message, callback) => {
        calls.tabsSendMessage.push({ tabId, message });
        if (typeof callback !== "function") return behavior.tabsSendMessagePromise();
        chrome.runtime.lastError = behavior.tabsSendMessageError
          ? { message: behavior.tabsSendMessageError }
          : undefined;
        try {
          callback(behavior.tabsSendMessageResponse);
        } finally {
          chrome.runtime.lastError = undefined;
        }
        return undefined;
      },
      reload: (tabId) => calls.reload.push(tabId),
      create: (options) => calls.create.push(options),
    },
    scripting: {
      executeScript: (details) => {
        calls.executeScript.push(details);
        return behavior.executeScript(details);
      },
    },
  };
  return { chrome, calls, behavior, messageListeners, installedListeners };
}

// 调用 onMessage 监听器，收集同步/异步给出的响应。
function dispatchMessage(listener, message, sender = {}) {
  const responses = [];
  const returned = listener(message, sender, (response) => responses.push(response));
  return { returned, responses };
}

function createDomEnv({ html = "<!DOCTYPE html><body></body>", url = WATCH_URL } = {}) {
  const dom = new JSDOM(html, { runScripts: "outside-only", url });
  const { window } = dom;
  const context = dom.getInternalVMContext();
  const clock = createClock();
  installClock(context, clock);
  window.setTimeout = clock.setTimeout;
  window.setInterval = clock.setInterval;
  window.clearTimeout = clock.clearTimeout;
  window.clearInterval = clock.clearInterval;
  return { dom, window, document: window.document, context, clock };
}

function navigate(window, url) {
  window.history.pushState({}, "", url);
}

// ---- background.js ----
function loadBackground(overrides = {}) {
  const stub = createChrome(overrides);
  const clock = createClock();
  const window = {};
  const context = vm.createContext({ chrome: stub.chrome, window });
  installClock(context, clock);
  runExtensionFile(context, "background.js");
  return {
    ...stub,
    clock,
    window,
    context,
    onMessage: stub.messageListeners[0],
    onInstalled: stub.installedListeners[0],
  };
}

// ---- content.js ----
function addVideo(document, { currentTime = 0 } = {}) {
  const element = document.createElement("video");
  document.body.append(element);
  const handlers = new Set();
  const fake = { plays: 0, pauses: 0, handlers, removed: [] };
  Object.defineProperty(element, "currentTime", { value: currentTime, writable: true, configurable: true });
  element.play = () => {
    fake.plays += 1;
  };
  element.pause = () => {
    fake.pauses += 1;
  };
  element.addEventListener = (type, handler) => {
    if (type === "timeupdate") handlers.add(handler);
  };
  element.removeEventListener = (type, handler) => {
    if (type === "timeupdate") {
      handlers.delete(handler);
      fake.removed.push(handler);
    }
  };
  fake.fireTimeUpdate = () => [...handlers].forEach((handler) => handler());
  element.fake = fake;
  return element;
}

function loadContent({ url = WATCH_URL, video = true, currentTime = 0, chromeOverrides } = {}) {
  const env = createDomEnv({ url });
  const stub = createChrome(chromeOverrides);
  env.window.chrome = stub.chrome;
  runExtensionFile(env.context, "sentence.js");
  const videoElement = video ? addVideo(env.document, { currentTime }) : null;
  runExtensionFile(env.context, "content.js");
  return {
    ...env,
    ...stub,
    video: videoElement,
    onMessage: stub.messageListeners[0],
    cueMessages: () => stub.calls.sendMessage.filter((message) => message.type === "cue"),
    lastCue: () => plain(stub.calls.sendMessage.filter((message) => message.type === "cue").at(-1)),
    loadCuesCalls: () => stub.calls.sendMessage.filter((message) => message.type === "load-cues").length,
    tick: async () => {
      env.clock.tickIntervals();
      await flush();
    },
  };
}

// ---- page.js ----
// 每次新建一个类，page.js 才不会在上一次打过补丁的原型上再叠一层。
function createFakeXHR() {
  return class FakeXHR {
    constructor() {
      this.responseType = "";
      this.response = null;
      this.responseText = "";
      this.responseURL = "";
      this.opened = [];
      this.sent = [];
      this.listeners = {};
    }

    open(...args) {
      this.opened.push(args);
      return "opened";
    }

    send(...args) {
      this.sent.push(args);
      return "sent";
    }

    addEventListener(type, handler) {
      (this.listeners[type] ||= []).push(handler);
    }

    fire(type) {
      (this.listeners[type] || []).forEach((handler) => handler());
    }
  };
}

function fakeResponse({ url = "", body = "", cloneError = false, textError = false } = {}) {
  const textOf = () => (textError ? Promise.reject(new Error("读取失败")) : Promise.resolve(body));
  const response = {
    url,
    cloned: 0,
    text: textOf,
    clone() {
      response.cloned += 1;
      return { text: textOf };
    },
  };
  if (cloneError) response.clone = () => ({ text: () => Promise.reject(new Error("读取失败")) });
  return response;
}

function addPlayer(document, members = {}) {
  const element = document.createElement("div");
  element.id = "movie_player";
  Object.assign(element, members);
  document.body.append(element);
  return element;
}

function addSubtitlesButton(document, { pressed = false } = {}) {
  const element = document.createElement("button");
  element.className = "ytp-subtitles-button";
  if (pressed) element.setAttribute("aria-pressed", "true");
  const fake = { clicks: 0 };
  element.addEventListener("click", () => {
    fake.clicks += 1;
  });
  element.fake = fake;
  document.body.append(element);
  return element;
}

function setTextTracks(video, tracks) {
  Object.defineProperty(video, "textTracks", { value: tracks, configurable: true });
}

function loadPage({ url = WATCH_URL, auto = true, fetchImpl, loadTwice = false } = {}) {
  const env = createDomEnv({ url });
  const { window, clock } = env;
  clock.auto = auto;
  const fetchCalls = [];
  const behavior = {
    fetch: fetchImpl || (() => Promise.resolve(fakeResponse())),
  };
  const originalFetch = function fetch(input, init) {
    fetchCalls.push({ input, init, self: this });
    return behavior.fetch(input, init);
  };
  window.fetch = originalFetch;
  const FakeXHR = createFakeXHR();
  window.XMLHttpRequest = FakeXHR;
  window.TextDecoder = TextDecoder;
  const originals = { open: FakeXHR.prototype.open, send: FakeXHR.prototype.send };
  runExtensionFile(env.context, "page.js");
  const patched = { fetch: window.fetch, open: window.XMLHttpRequest.prototype.open, load: window.__fengsongLoad };
  if (loadTwice) runExtensionFile(env.context, "page.js");

  const page = {
    ...env,
    behavior,
    fetchCalls,
    originals,
    originalFetch,
    patched,
    load: () => window.__fengsongLoad(),
    // 模拟页面发出一个 XHR 并收到响应。
    xhr({ url, responseURL = url ?? "", setup, ...fields } = {}) {
      const xhr = new window.XMLHttpRequest();
      if (url !== undefined) xhr.open("GET", url);
      xhr.send();
      Object.assign(xhr, { responseURL }, fields);
      setup?.(xhr);
      xhr.fire("load");
      return xhr;
    },
    // 模拟页面里读到了一份字幕 JSON。
    captureTimedtext(body, { v = "abc", extra = "" } = {}) {
      return page.xhr({
        url: `https://www.youtube.com/api/timedtext?v=${v}&lang=en${extra}`,
        response: body,
      });
    },
  };
  return page;
}

// ---- mic.js ----
function loadMic({ permission = { state: "prompt" }, getUserMedia, url = "https://fengsong-ext.example/mic.html" } = {}) {
  const env = createDomEnv({
    url,
    html: '<!DOCTYPE html><body><p id="text"></p><button id="settings" type="button" hidden></button></body>',
  });
  const { window } = env;
  const stub = createChrome();
  const closes = [];
  window.chrome = stub.chrome;
  window.close = () => closes.push(true);
  Object.defineProperty(window.navigator, "permissions", {
    value: { query: typeof permission === "function" ? permission : () => Promise.resolve(permission) },
    configurable: true,
  });
  Object.defineProperty(window.navigator, "mediaDevices", {
    value: { getUserMedia: getUserMedia || (() => Promise.reject(new Error("没有权限"))) },
    configurable: true,
  });
  runExtensionFile(env.context, "mic.js");
  return {
    ...env,
    ...stub,
    closes,
    text: env.document.querySelector("#text"),
    settings: env.document.querySelector("#settings"),
  };
}

// ---- recorder-worklet.js ----
function loadWorklet() {
  const registered = [];
  class AudioWorkletProcessor {
    constructor() {
      this.posted = [];
      this.port = { postMessage: (message) => this.posted.push(message) };
    }
  }
  const context = vm.createContext({
    AudioWorkletProcessor,
    registerProcessor: (name, processor) => registered.push({ name, processor }),
  });
  runExtensionFile(context, "recorder-worklet.js");
  return { registered, AudioWorkletProcessor };
}

module.exports = {
  WATCH_URL,
  addPlayer,
  addSubtitlesButton,
  addVideo,
  createChrome,
  createClock,
  createDomEnv,
  dispatchMessage,
  fakeResponse,
  flush,
  loadBackground,
  loadContent,
  loadMic,
  loadPage,
  loadWorklet,
  navigate,
  plain,
  runExtensionFile,
  setTextTracks,
};
