let trackVideo = "";
let loadedFor = "";
let cues = [];
let loading = false;
let attempts = 0;

function inject() {
  if (document.getElementById("fengsong-inject")) return;
  const script = document.createElement("script");
  script.id = "fengsong-inject";
  script.src = chrome.runtime.getURL("inject.js");
  document.documentElement.appendChild(script);
}

function currentVideoId() {
  if (!location.pathname.startsWith("/watch")) return "";
  return new URLSearchParams(location.search).get("v") || "";
}

function requestTracks() {
  return new Promise((resolve) => {
    function onMessage(event) {
      if (event.source !== window || event.data?.source !== "fengsong-page") return;
      if (event.data.type !== "tracks") return;
      window.removeEventListener("message", onMessage);
      resolve(event.data.tracks || []);
    }
    window.addEventListener("message", onMessage);
    window.postMessage({ source: "fengsong", type: "tracks" }, "*");
    setTimeout(() => {
      window.removeEventListener("message", onMessage);
      resolve([]);
    }, 1500);
  });
}

function pickEnglish(tracks) {
  const english = tracks.filter((track) => track.languageCode.toLowerCase().startsWith("en"));
  return english.find((track) => track.kind !== "asr") || english[0] || null;
}

function parseCues(data) {
  const parsed = [];
  for (const event of data.events || []) {
    if (event.tStartMs == null || event.dDurationMs == null) continue;
    const text = (event.segs || [])
      .map((segment) => segment.utf8 || "")
      .join("")
      .replace(/\s+/g, " ")
      .trim();
    if (!text) continue;
    parsed.push({
      text,
      startMs: event.tStartMs,
      endMs: event.tStartMs + event.dDurationMs,
    });
  }
  return parsed;
}

function noteMiss() {
  attempts += 1;
  if (attempts >= 8) loadedFor = trackVideo;
}

async function ensureTracks(id) {
  if (loading) return;
  loading = true;
  try {
    inject();
    const tracks = await requestTracks();
    const track = pickEnglish(tracks);
    if (!track?.baseUrl) {
      cues = [];
      noteMiss();
      return;
    }
    const url = track.baseUrl + (track.baseUrl.includes("?") ? "&" : "?") + "fmt=json3";
    const response = await fetch(url);
    cues = parseCues(await response.json());
    if (cues.length === 0) noteMiss();
    else loadedFor = id;
  } catch (_error) {
    cues = [];
    noteMiss();
  } finally {
    loading = false;
  }
}

function publish() {
  const id = currentVideoId();
  const video = document.querySelector("video");
  if (!id || !video) {
    trackVideo = "";
    loadedFor = "";
    cues = [];
    attempts = 0;
    chrome.runtime.sendMessage({ type: "cue", cue: null, state: "no-video" });
    return;
  }
  if (id !== trackVideo) {
    trackVideo = id;
    loadedFor = "";
    cues = [];
    attempts = 0;
  }
  if (loadedFor !== id && !loading && attempts < 8) ensureTracks(id);
  const time = video.currentTime * 1000;
  const cue = cues.find((item) => time >= item.startMs && time < item.endMs) || null;
  chrome.runtime.sendMessage({
    type: "cue",
    state: cues.length ? "ok" : "no-caption",
    cue: cue ? { text: cue.text, startMs: cue.startMs, endMs: cue.endMs, videoId: id } : null,
  });
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
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

inject();
setInterval(publish, 300);
document.addEventListener("yt-navigate-finish", () => {
  trackVideo = "";
  loadedFor = "";
  cues = [];
  attempts = 0;
});
