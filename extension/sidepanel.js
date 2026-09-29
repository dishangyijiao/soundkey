const API = "http://127.0.0.1:17321";

const state = {
  connected: false,
  cards: [],
  selectedId: null,
  liveCue: null,
  liveState: "no-video",
  recording: false,
  readHint: "",
  liveHint: "",
  askingMic: false,
};

const liveText = document.querySelector("#live-text");
const cardText = document.querySelector("#card-text");
const scoreBox = document.querySelector("#score");
const list = document.querySelector("#list");
let saveTimer = 0;

function selectedCard() {
  return state.cards.find((card) => card.id === state.selectedId) || null;
}

function fmt(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const seconds = String(total % 60).padStart(2, "0");
  const minutes = Math.floor(total / 60) % 60;
  const hours = Math.floor(total / 3600);
  if (hours > 0) return `${hours}:${String(minutes).padStart(2, "0")}:${seconds}`;
  return `${minutes}:${seconds}`;
}

function chipEl(chip) {
  const el = document.createElement("span");
  el.className = `chip ${chip.tone}`;
  const tag = document.createElement("span");
  tag.className = "chip-tag";
  tag.textContent = chip.tag;
  const body = document.createElement("span");
  body.className = "chip-body";
  if (chip.kind === "sub") body.textContent = `${chip.from} → ${chip.to}`;
  else body.textContent = `${chip.kindLabel} ${chip.from ?? chip.to}`;
  el.append(tag, body);
  if (chip.count > 1) {
    const count = document.createElement("span");
    count.className = "chip-count";
    count.textContent = `×${chip.count}`;
    el.append(count);
  }
  return el;
}

function phoneRow(label, phones) {
  const row = document.createElement("div");
  row.className = "phones";
  const tag = document.createElement("span");
  tag.className = "tag";
  tag.textContent = label;
  const cells = document.createElement("div");
  cells.className = "cells";
  for (const phone of phones) {
    const cell = document.createElement("span");
    cell.className = phone.bad ? "phone bad" : "phone";
    cell.textContent = phone.phone;
    cells.append(cell);
  }
  row.append(tag, cells);
  return row;
}

async function refreshCards() {
  const response = await fetch(`${API}/cards`);
  const data = await response.json();
  state.cards = data.cards || [];
  if (!state.selectedId && state.cards[0]) state.selectedId = state.cards[0].id;
  if (state.selectedId && !state.cards.some((card) => card.id === state.selectedId)) {
    state.selectedId = state.cards[0]?.id || null;
  }
  renderCard();
  renderList();
}

async function pollHealth() {
  try {
    const response = await fetch(`${API}/health`);
    state.connected = response.ok;
  } catch (_error) {
    state.connected = false;
  }
  renderStatus();
  renderLive();
  renderCard();
}

async function pollCue() {
  const data = await chrome.runtime.sendMessage({ type: "get-cue" });
  state.liveState = data?.state || "no-video";
  const next = data?.cue || null;
  const changed =
    next?.startMs !== state.liveCue?.startMs ||
    next?.endMs !== state.liveCue?.endMs ||
    next?.videoId !== state.liveCue?.videoId;
  state.liveCue = next;
  if (changed && document.activeElement !== liveText) {
    liveText.value = next?.text || "";
  }
  renderLive();
}

function renderStatus() {
  document.querySelector("#dot").classList.toggle("on", state.connected);
  document.querySelector("#status-text").textContent = state.connected ? "本机已连接" : "本机程序没开";
}

function renderLive() {
  const cue = state.liveCue;
  if (!cue && document.activeElement !== liveText && !liveText.value) {
    liveText.placeholder = state.liveState === "no-caption" ? "这一句没有字幕" : "打开一个 YouTube 视频";
  } else {
    liveText.placeholder = "";
  }
  document.querySelector("#live-meta").textContent = cue ? fmt(cue.startMs) : "";
  document.querySelector("#clip").disabled = !state.connected || !cue || !liveText.value.trim();
  document.querySelector("#live-play").disabled = !cue;
  document.querySelector("#adjust").hidden = !cue;
  document.querySelector("#live-hint").textContent = state.liveHint;
}

function renderCard() {
  const card = selectedCard();
  if (document.activeElement !== cardText) {
    cardText.value = card?.text || "";
  }
  const dirty = Boolean(card) && cardText.value.trim() !== card.text;
  const hasScore = Boolean(card?.score) && !dirty;
  const readLabel = state.recording === "uploading" ? "正在听" : state.recording ? "停止" : hasScore ? "再读一次" : "朗读";
  document.querySelector("#read").textContent = readLabel;
  document.querySelector("#read").disabled = !state.connected || !card || state.recording === "uploading";
  document.querySelector("#allow-mic").hidden = state.readHint !== "需要麦克风权限";
  document.querySelector("#card-play").hidden = !card || card.source !== "youtube";
  document.querySelector("#card-play").disabled = !card || card.source !== "youtube";
  document.querySelector("#mine").hidden = !card?.latest_attempt_id;
  document.querySelector("#read-hint").textContent = state.readHint;
  document.querySelector("#add").disabled = !state.connected;

  scoreBox.replaceChildren();
  if (!card?.score) return;
  const hit = document.createElement("p");
  hit.className = "hit";
  hit.textContent = `命中 ${card.score.match_count}/${card.score.expected_count}`;
  scoreBox.append(hit, phoneRow("标准", card.score.expected), phoneRow("你的", card.score.heard));
  if (card.score.errors.length) {
    const chips = document.createElement("div");
    chips.className = "chips";
    for (const error of FengsongChips.sortErrors(card.score.errors)) {
      chips.append(chipEl(FengsongChips.errorChip(error)));
    }
    scoreBox.append(chips);
  }
}

function renderList() {
  list.replaceChildren();
  if (state.cards.length === 0) {
    const item = document.createElement("li");
    item.className = "empty";
    item.textContent = "还没有摘过句子";
    list.append(item);
    return;
  }
  for (const card of state.cards) {
    const item = document.createElement("li");
    item.textContent = card.text;
    if (card.id === state.selectedId) item.className = "selected";
    item.addEventListener("click", () => {
      state.selectedId = card.id;
      state.readHint = "";
      cardText.value = card.text;
      renderCard();
      renderList();
    });
    list.append(item);
  }
}

async function clip() {
  const cue = state.liveCue;
  if (!cue) return;
  state.liveHint = "";
  const response = await fetch(`${API}/cards`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      text: liveText.value.trim(),
      source: "youtube",
      video_id: cue.videoId,
      start_ms: cue.startMs,
      end_ms: cue.endMs,
    }),
  });
  const data = await response.json();
  if (!response.ok) {
    state.liveHint = data.error || "没有摘下来";
    renderLive();
    return;
  }
  state.selectedId = data.card.id;
  await refreshCards();
}

async function addPaste() {
  const text = document.querySelector("#paste").value.trim();
  if (!text) return;
  const response = await fetch(`${API}/cards`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text, source: "paste" }),
  });
  const data = await response.json();
  if (!response.ok) {
    state.readHint = data.error || "没有加入";
    renderCard();
    return;
  }
  document.querySelector("#paste").value = "";
  state.selectedId = data.card.id;
  state.readHint = "";
  await refreshCards();
}

function scheduleSave() {
  const card = selectedCard();
  if (!card) return;
  state.readHint = "";
  renderCard();
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    const text = cardText.value.trim();
    if (!text || text === card.text) return;
    await fetch(`${API}/cards/${card.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
    await refreshCards();
  }, 400);
}

async function playRange(videoId, startMs, endMs) {
  const response = await chrome.runtime.sendMessage({ type: "play-range", videoId, startMs, endMs });
  return response?.ok ? "" : response?.error || "打开原来的视频才能听原声";
}

async function microphoneState() {
  try {
    return (await navigator.permissions.query({ name: "microphone" })).state;
  } catch (_error) {
    return "prompt";
  }
}

function openMicPage() {
  return new Promise((resolve) => {
    chrome.tabs.create({ url: chrome.runtime.getURL("mic.html"), active: true }, (tab) => {
      if (!tab?.id) {
        resolve();
        return;
      }
      const listener = (tabId) => {
        if (tabId !== tab.id) return;
        chrome.tabs.onRemoved.removeListener(listener);
        resolve();
      };
      chrome.tabs.onRemoved.addListener(listener);
    });
  });
}

async function askMicrophone() {
  if (state.askingMic) return false;
  state.askingMic = true;
  try {
    const current = await microphoneState();
    if (current === "granted") return true;
    if (current === "denied") {
      await chrome.tabs.create({
        url: `chrome://settings/content/siteDetails?site=${encodeURIComponent(`chrome-extension://${chrome.runtime.id}/`)}`,
      });
      return false;
    }
    await openMicPage();
    return (await microphoneState()) === "granted";
  } finally {
    state.askingMic = false;
  }
}

async function toggleRecord() {
  if (state.recording === "uploading") return;
  if (state.recording) {
    state.recording.stop();
    return;
  }
  const card = selectedCard();
  if (!card) return;
  state.readHint = "";
  if ((await microphoneState()) !== "granted") {
    const allowed = await askMicrophone();
    if (!allowed) {
      state.readHint = "需要麦克风权限";
      renderCard();
      return;
    }
  }
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch (_error) {
    state.readHint = "需要麦克风权限";
    renderCard();
    return;
  }
  const context = new AudioContext();
  const source = context.createMediaStreamSource(stream);
  const processor = context.createScriptProcessor(4096, 1, 1);
  const silent = context.createGain();
  silent.gain.value = 0;
  const chunks = [];
  processor.onaudioprocess = (event) => {
    chunks.push(new Float32Array(event.inputBuffer.getChannelData(0)));
  };
  source.connect(processor);
  processor.connect(silent);
  silent.connect(context.destination);
  state.recording = {
    stop: async () => {
      processor.disconnect();
      source.disconnect();
      stream.getTracks().forEach((track) => track.stop());
      const sampleRate = context.sampleRate;
      await context.close();
      state.recording = "uploading";
      renderCard();
      const samples = resample(concat(chunks), sampleRate, 16000);
      try {
        const response = await fetch(`${API}/cards/${card.id}/attempts`, {
          method: "POST",
          headers: { "Content-Type": "audio/wav" },
          body: encodeWav(samples, 16000),
        });
        const data = await response.json();
        if (!response.ok) state.readHint = data.error || "没有评出来";
      } catch (_error) {
        state.readHint = "本机程序没开";
      }
      state.recording = false;
      await refreshCards();
    },
  };
  renderCard();
}

function concat(chunks) {
  const length = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const samples = new Float32Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    samples.set(chunk, offset);
    offset += chunk.length;
  }
  return samples;
}

function resample(samples, from, to) {
  if (from === to) return samples;
  const length = Math.round(samples.length * to / from);
  const output = new Float32Array(length);
  for (let index = 0; index < length; index++) {
    const position = index * from / to;
    const left = Math.floor(position);
    const right = Math.min(left + 1, samples.length - 1);
    const fraction = position - left;
    output[index] = samples[left] * (1 - fraction) + samples[right] * fraction;
  }
  return output;
}

function encodeWav(samples, sampleRate) {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const write = (offset, text) => {
    for (let index = 0; index < text.length; index++) view.setUint8(offset + index, text.charCodeAt(index));
  };
  write(0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  write(8, "WAVE");
  write(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  write(36, "data");
  view.setUint32(40, samples.length * 2, true);
  for (let index = 0; index < samples.length; index++) {
    const sample = Math.max(-1, Math.min(1, samples[index]));
    view.setInt16(44 + index * 2, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
  }
  return buffer;
}

document.querySelector("#clip").addEventListener("click", clip);
document.querySelector("#add").addEventListener("click", addPaste);
document.querySelector("#paste").addEventListener("keydown", (event) => {
  if (event.key === "Enter") addPaste();
});
document.querySelector("#read").addEventListener("click", toggleRecord);
document.querySelector("#allow-mic").addEventListener("click", async () => {
  const allowed = await askMicrophone();
  if (allowed) toggleRecord();
  else {
    state.readHint = "需要麦克风权限";
    renderCard();
  }
});
document.querySelector("#live-play").addEventListener("click", async () => {
  const cue = state.liveCue;
  if (!cue) return;
  state.liveHint = await playRange(cue.videoId, cue.startMs, cue.endMs);
  renderLive();
});
document.querySelector("#card-play").addEventListener("click", async () => {
  const card = selectedCard();
  if (!card) return;
  state.readHint = await playRange(card.video_id, card.start_ms, card.end_ms);
  renderCard();
});
document.querySelector("#mine").addEventListener("click", () => {
  const card = selectedCard();
  if (!card?.latest_attempt_id) return;
  const audio = new Audio(`${API}/attempts/${card.latest_attempt_id}/audio`);
  audio.play();
});
for (const [id, edge, delta] of [
  ["#start-more", "start", -1],
  ["#start-less", "start", 1],
  ["#end-less", "end", -1],
  ["#end-more", "end", 1],
]) {
  document.querySelector(id).addEventListener("click", () => {
    chrome.runtime.sendMessage({ type: "adjust-cue", edge, delta });
  });
}
document.querySelector("#reset-cue").addEventListener("click", () => {
  chrome.runtime.sendMessage({ type: "reset-cue" });
});
liveText.addEventListener("input", renderLive);
cardText.addEventListener("input", scheduleSave);

pollHealth();
refreshCards().catch(() => {});
setInterval(pollHealth, 2000);
setInterval(() => pollCue().catch(() => {}), 400);
renderLive();
renderCard();
renderList();
