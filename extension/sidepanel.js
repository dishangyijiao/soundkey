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
  words: [],
  activeTab: "cards",
};

const liveText = document.querySelector("#live-text");
const cardText = document.querySelector("#card-text");
const scoreBox = document.querySelector("#score");
const list = document.querySelector("#list");
const wordList = document.querySelector("#word-list");
const popover = document.querySelector("#word-popover");
let saveTimer = 0;

function selectedCard() {
  return state.cards.find((card) => card.id === state.selectedId) || null;
}

function resizeTextarea(textarea) {
  textarea.style.height = "auto";
  textarea.style.height = `${textarea.scrollHeight}px`;
}

function fmt(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const seconds = String(total % 60).padStart(2, "0");
  const minutes = Math.floor(total / 60) % 60;
  const hours = Math.floor(total / 3600);
  if (hours > 0) return `${hours}:${String(minutes).padStart(2, "0")}:${seconds}`;
  return `${minutes}:${seconds}`;
}

function phoneCell(phone) {
  const cell = document.createElement("button");
  cell.type = "button";
  cell.disabled = !phone;
  cell.className = "phone";
  if (!phone) return cell;
  if (phone.bad) cell.classList.add("bad");
  if (FengsongCues.isVowel(phone.phone)) cell.classList.add("vowel");
  cell.textContent = phone.phone;
  cell.title = `播放 ${phone.phone}`;
  cell.addEventListener("click", () => playPhone(phone.phone));
  return cell;
}

// Each column is one aligned pair (standard above, yours below). Columns wrap
// as a whole, so a long sentence stays aligned instead of running off the edge.
function phoneGrid(score) {
  const grid = document.createElement("div");
  grid.className = "phone-cols";
  for (const column of FengsongCues.scoreColumns(score)) {
    const pair = document.createElement("div");
    pair.className = "pcol";
    pair.append(phoneCell(column.expected), phoneCell(column.heard));
    grid.append(pair);
  }
  return grid;
}

async function playPhone(ipa) {
  try {
    await new Audio(`${API}/speak?ipa=${encodeURIComponent(ipa)}`).play();
  } catch (_error) {
    state.readHint = `暂时无法播放音素 ${ipa}`;
    renderCard();
  }
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
  const next = data?.cue ? { ...data.cue, text: FengsongCues.cleanCue(data.cue.text) } : null;
  const changed =
    next?.startMs !== state.liveCue?.startMs ||
    next?.endMs !== state.liveCue?.endMs ||
    next?.videoId !== state.liveCue?.videoId;
  state.liveCue = next;
  if (changed && document.activeElement !== liveText) {
    liveText.value = next?.text || "";
    resizeTextarea(liveText);
  }
  renderLive();
}

function renderStatus() {
  document.querySelector("#dot").classList.toggle("on", state.connected);
  document.querySelector("#status-text").textContent = state.connected ? "本机已连接" : "本机程序没开";
}

function renderRead() {
  const card = selectedCard();
  const { label, disabled } = FengsongCues.readButton({
    connected: state.connected,
    hasCard: Boolean(card),
    recording: state.recording,
    hasScore: Boolean(card?.score) && cardText.value.trim() === card.text,
  });
  const button = document.querySelector("#read");
  button.textContent = label;
  button.disabled = disabled;
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
    resizeTextarea(cardText);
  }
  renderRead();
  document.querySelector("#allow-mic").hidden = state.readHint !== "需要麦克风权限";
  document.querySelector("#card-play").hidden = !card;
  document.querySelector("#card-play").disabled = !card;
  document.querySelector("#mine").hidden = !card?.latest_attempt_id;
  document.querySelector("#read-hint").textContent = state.readHint;
  document.querySelector("#add").disabled = !state.connected;

  scoreBox.replaceChildren();
  if (!card?.score) return;
  const hit = document.createElement("p");
  hit.className = "hit";
  hit.textContent = `命中 ${card.score.match_count}/${card.score.expected_count}`;
  const legend = document.createElement("span");
  legend.className = "legend";
  legend.textContent = "上 标准 · 下 你的";
  hit.append(legend);
  scoreBox.append(hit, phoneGrid(card.score));
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
      resizeTextarea(cardText);
      renderCard();
      renderList();
    });
    list.append(item);
  }
}

async function refreshWords() {
  const response = await fetch(`${API}/words`);
  const data = await response.json();
  state.words = data.words || [];
  renderWords();
}

function wordRow(word) {
  const item = document.createElement("li");
  item.className = "word-item";
  const body = document.createElement("span");
  const head = document.createElement("strong");
  head.textContent = word.word;
  body.append(head);
  const detail = [word.ipa, word.definition].filter(Boolean).join("  ");
  if (detail) body.append(` ${detail}`);
  const remove = document.createElement("button");
  remove.type = "button";
  remove.className = "text-button";
  remove.textContent = "删除";
  remove.addEventListener("click", async (event) => {
    event.stopPropagation();
    await fetch(`${API}/words/${word.id}`, { method: "DELETE" });
    await refreshWords();
  });
  item.append(body, remove);
  if (word.video_id && word.start_ms != null) {
    item.title = "点击回听来源";
    item.addEventListener("click", () => playRange(word.video_id, word.start_ms, word.end_ms));
  }
  return item;
}

function renderWords() {
  wordList.replaceChildren();
  if (state.words.length === 0) {
    const item = document.createElement("li");
    item.className = "empty";
    item.textContent = "还没有生词。在上面的句子里双击一个词。";
    wordList.append(item);
    return;
  }
  wordList.append(...state.words.map(wordRow));
}

async function clip() {
  const cue = state.liveCue;
  if (!cue) return;
  state.liveHint = "";
  const response = await fetch(`${API}/cards`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      text: FengsongCues.cleanCue(liveText.value),
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

function positionPopover() {
  const rect = liveText.getBoundingClientRect();
  popover.style.left = `${Math.max(8, Math.min(rect.left, innerWidth - 270))}px`;
  popover.style.top = `${Math.min(innerHeight - 100, rect.bottom + 6)}px`;
}

async function lookupWord(word) {
  try {
    const response = await fetch(`${API}/lookup?word=${encodeURIComponent(word)}`);
    const data = await response.json();
    if (!response.ok) return { result: null, note: data.error || "查询失败" };
    return { result: data, note: [data.ipa, data.definition].filter(Boolean).join(" · ") || "没有词典释义" };
  } catch (_error) {
    return { result: null, note: "本机程序没开" };
  }
}

async function showWordPopover() {
  const word = FengsongCues.selectedWord(liveText.value, liveText.selectionStart, liveText.selectionEnd);
  if (!word) {
    popover.hidden = true;
    return;
  }
  // The video keeps playing while the popover is open: remember the sentence and
  // time the word was selected in, not whatever is showing when the button is clicked.
  const source = { sentence: liveText.value, cue: state.liveCue };
  const title = document.createElement("strong");
  title.textContent = word;
  const details = document.createElement("span");
  details.textContent = "查询中…";
  const add = document.createElement("button");
  add.type = "button";
  add.className = "secondary";
  add.textContent = "加入生词本";
  add.disabled = true;
  popover.replaceChildren(title, details, add);
  positionPopover();
  popover.hidden = false;

  const { result, note } = await lookupWord(word);
  if (popover.hidden || !popover.contains(title)) return;
  details.textContent = note;
  add.disabled = false;
  add.addEventListener("click", async () => {
    const body = FengsongCues.wordPayload({ word, result, ...source });
    const response = await fetch(`${API}/words`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      details.textContent = "没有加入";
      return;
    }
    state.activeTab = "words";
    renderTabs();
    await refreshWords();
    popover.hidden = true;
  });
}

function renderTabs() {
  const words = state.activeTab === "words";
  document.querySelector("#cards-tab").classList.toggle("active", !words);
  document.querySelector("#words-tab").classList.toggle("active", words);
  list.hidden = words;
  wordList.hidden = !words;
  document.querySelector("#paste").hidden = words;
  document.querySelector("#add").hidden = words;
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
  const chunks = [];
  let source;
  let recorder;
  try {
    await context.audioWorklet.addModule(chrome.runtime.getURL("recorder-worklet.js"));
    source = context.createMediaStreamSource(stream);
    recorder = new AudioWorkletNode(context, "fengsong-recorder", { numberOfOutputs: 0 });
  } catch (_error) {
    stream.getTracks().forEach((track) => track.stop());
    await context.close();
    state.readHint = "录音组件没有加载出来";
    renderCard();
    return;
  }
  recorder.port.onmessage = (event) => chunks.push(event.data);
  source.connect(recorder);
  state.recording = {
    stop: async () => {
      source.disconnect();
      recorder.port.close();
      stream.getTracks().forEach((track) => track.stop());
      const sampleRate = context.sampleRate;
      await context.close();
      state.recording = "uploading";
      renderCard();
      const samples = FengsongAudio.resample(FengsongAudio.concat(chunks), sampleRate, 16000);
      try {
        const response = await fetch(`${API}/cards/${card.id}/attempts`, {
          method: "POST",
          headers: { "Content-Type": "audio/wav" },
          body: FengsongAudio.encodeWav(samples, 16000),
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

document.querySelector("#clip").addEventListener("click", clip);
document.querySelector("#read").addEventListener("click", toggleRecord);
document.querySelector("#add").addEventListener("click", addPaste);
document.querySelector("#paste").addEventListener("keydown", (event) => {
  if (event.key === "Enter") addPaste();
});
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
  if(card.source==="youtube") { state.readHint = await playRange(card.video_id, card.start_ms, card.end_ms); renderCard(); return; }
  try { await new Audio(`${API}/speak?text=${encodeURIComponent(card.text)}`).play(); }
  catch(_error) { state.readHint="标准音暂时无法播放"; renderCard(); }
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
liveText.addEventListener("dblclick", showWordPopover);
liveText.addEventListener("select", showWordPopover);
document.addEventListener("pointerdown",(event)=>{if(!popover.contains(event.target)&&event.target!==liveText)popover.hidden=true;});
document.querySelector("#cards-tab").addEventListener("click",()=>{state.activeTab="cards";renderTabs();});
document.querySelector("#words-tab").addEventListener("click",()=>{state.activeTab="words";renderTabs();refreshWords().catch(()=>{});});

for(const textarea of [liveText,cardText]) textarea.addEventListener("input",()=>resizeTextarea(textarea));

pollHealth();
refreshCards().catch(() => {});
refreshWords().catch(()=>{});
setInterval(pollHealth, 2000);
setInterval(() => pollCue().catch(() => {}), 400);
renderLive();
renderCard();
renderList();
renderWords();
renderTabs();
