let trackVideo = "";
let loadedFor = "";
let cues = [];
let loading = false;
let attempts = 0;
let timer = null;
let manual = null;
let shown = null;

function alive() {
  try {
    return Boolean(chrome.runtime?.id);
  } catch (_error) {
    return false;
  }
}

function stop() {
  if (timer) clearInterval(timer);
  timer = null;
}

function post(message) {
  if (!alive()) {
    stop();
    return;
  }
  try {
    chrome.runtime.sendMessage(message);
  } catch (_error) {
    stop();
  }
}

function currentVideoId() {
  if (!location.pathname.startsWith("/watch")) return "";
  return new URLSearchParams(location.search).get("v") || "";
}

async function ensureTracks(id) {
  if (loading) return;
  loading = true;
  try {
    if (!alive()) {
      stop();
      return;
    }
    const response = await chrome.runtime.sendMessage({ type: "load-cues" });
    const next = response?.cues || [];
    if (next.length) {
      cues = next;
      loadedFor = id;
      attempts = 0;
    } else {
      attempts += 1;
    }
  } catch (_error) {
    attempts += 1;
  } finally {
    loading = false;
  }
}

function currentIndex(time) {
  const covering = cues.findIndex((item) => time >= item.startMs && time < item.endMs);
  if (covering >= 0) return covering;
  let previous = -1;
  for (let index = 0; index < cues.length; index += 1) {
    if (cues[index].startMs <= time) previous = index;
    else break;
  }
  if (previous >= 0) return previous;
  return cues.findIndex((item) => item.startMs > time);
}

function activeRange(index) {
  if (manual && index >= manual.from && index <= manual.to) return manual;
  manual = null;
  return FengsongSentence.sentenceRange(cues, index);
}

function publish() {
  const id = currentVideoId();
  const video = document.querySelector("video");
  if (!id || !video) {
    trackVideo = "";
    loadedFor = "";
    cues = [];
    attempts = 0;
    post({ type: "cue", cue: null, state: "no-video" });
    return;
  }
  if (id !== trackVideo) {
    trackVideo = id;
    loadedFor = "";
    cues = [];
    attempts = 0;
  }
  const wait = attempts < 8 ? 0 : 10000;
  if (loadedFor !== id && !loading && (!attempts || Date.now() - publish.lastTry > wait)) {
    publish.lastTry = Date.now();
    ensureTracks(id);
  }
  const index = cues.length ? currentIndex(video.currentTime * 1000) : -1;
  const range = index >= 0 ? activeRange(index) : null;
  shown = range;
  const cue = range ? FengsongSentence.rangeCue(cues, range) : null;
  post({
    type: "cue",
    state: cues.length ? "ok" : "no-caption",
    cue: cue ? { ...cue, videoId: id } : null,
  });
}
publish.lastTry = 0;

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === "adjust-cue") {
    if (shown) {
      manual = FengsongSentence.moveEdge(shown, message.edge, message.delta, cues.length);
      publish();
    }
    return;
  }
  if (message.type === "reset-cue") {
    manual = null;
    publish();
    return;
  }
  if (message.type !== "play-range") return;
  const video = document.querySelector("video");
  const id = currentVideoId();
  if (!video || id !== message.videoId) {
    sendResponse({ ok: false, error: "打开原来的视频才能听原声" });
    return;
  }
  video.currentTime = message.startMs / 1000;
  video.play();
  const stop = () => {
    if (video.currentTime * 1000 >= message.endMs - 40) {
      video.pause();
      video.removeEventListener("timeupdate", stop);
    }
  };
  video.addEventListener("timeupdate", stop);
  sendResponse({ ok: true });
});

timer = setInterval(publish, 300);
document.addEventListener("yt-navigate-finish", () => {
  trackVideo = "";
  loadedFor = "";
  cues = [];
  attempts = 0;
  manual = null;
});
