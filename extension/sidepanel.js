const API = "http://127.0.0.1:17321";

const SPEAKER =
  '<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">' +
  '<path d="M2 6h2.5L8 3v10L4.5 10H2z" fill="currentColor"/>' +
  '<path d="M10.5 5.5a3.5 3.5 0 0 1 0 5M12.5 3.5a6.5 6.5 0 0 1 0 9" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>' +
  "</svg>";

const state = {
  connected: false,
  cards: [],
  selectedId: null,
  liveCue: null,
  liveState: "no-video",
  recording: false,
  recordingFor: null,
  readHint: "",
  liveHint: "",
  wordHint: "",
  askingMic: false,
  words: [],
  activeTab: "cards",
  editing: false,
  wordId: null,
};

const $ = (selector) => document.querySelector(selector);
const main = $("#main");
const liveText = $("#live-text");
const cardSentence = $("#card-sentence");
const cardText = $("#card-text");
const scoreBox = $("#score");
const list = $("#list");
const wordList = $("#word-list");
const popover = $("#word-popover");
const wordView = $("#word-view");
let saveTimer = 0;
let cardKey = "";
let wordPhonesKey = "";
let popoverToken = null;
let popoverTicket = 0;
let player = null;
const phoneCache = new Map();

function el(tag, className = "", text = "") {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

function iconButton(title, onClick) {
  const button = el("button", "icon-button");
  button.type = "button";
  button.title = title;
  button.innerHTML = SPEAKER;
  button.addEventListener("click", (event) => {
    event.stopPropagation();
    onClick();
  });
  return button;
}

function selectedCard() {
  return state.cards.find((card) => card.id === state.selectedId) || null;
}

function selectedWordEntry() {
  return state.words.find((word) => word.id === state.wordId) || null;
}

function cardCue(card) {
  if (card?.source !== "youtube") return null;
  return { videoId: card.video_id, startMs: card.start_ms, endMs: card.end_ms };
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

function showIpa(ipa) {
  if (!ipa) return "";
  return /^[/[]/.test(ipa) ? ipa : `/${ipa}/`;
}

// ---- 播放 ----

// One player for everything, so a new sound cuts off the previous one.
function play(url) {
  if (player) player.pause();
  player = new Audio(url);
  return player.play();
}

function setHint(kind, message) {
  if (kind === "word") state.wordHint = message;
  else state.readHint = message;
  renderCard();
  renderWordView();
}

function playPhone(ipa) {
  play(`${API}/speak?ipa=${encodeURIComponent(ipa)}`).catch(() => {
    setHint(state.wordId ? "word" : "card", `暂时无法播放音素 ${ipa}`);
  });
}

function speakText(text, kind = "card") {
  play(`${API}/speak?text=${encodeURIComponent(text)}`).catch(() => setHint(kind, "标准音暂时无法播放"));
}

async function playRange(videoId, startMs, endMs) {
  const response = await chrome.runtime.sendMessage({ type: "play-range", videoId, startMs, endMs });
  return response?.ok ? "" : response?.error || "打开原来的视频才能听原声";
}

// ---- 音素 ----

function phoneCell(phone) {
  const cell = el("button", "phone");
  cell.type = "button";
  cell.disabled = !phone;
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
function phoneGrid(columns) {
  const grid = el("div", "phone-cols");
  for (const column of columns) {
    const pair = el("div", "pcol");
    pair.append(phoneCell(column.expected), phoneCell(column.heard));
    grid.append(pair);
  }
  return grid;
}

function phoneChips(phones) {
  const box = el("div", "chips");
  for (const phone of phones) {
    const chip = el("button", FengsongCues.isVowel(phone) ? "chip vowel" : "chip consonant", phone);
    chip.type = "button";
    chip.title = `播放 ${phone}`;
    chip.addEventListener("click", () => playPhone(phone));
    box.append(chip);
  }
  return box;
}

async function phonesFor(text) {
  const key = text.toLowerCase();
  if (phoneCache.has(key)) return phoneCache.get(key);
  try {
    const response = await fetch(`${API}/phones?text=${encodeURIComponent(text)}`);
    if (!response.ok) return null;
    const { phones } = await response.json();
    phoneCache.set(key, phones);
    return phones;
  } catch (_error) {
    return null;
  }
}

// ---- 句子：每个词都可以点 ----

function renderSentence(container, text, score, source) {
  const segments = FengsongCues.tokenize(text);
  const scores = FengsongCues.wordScores(segments, score);
  container.replaceChildren(
    ...segments.map((segment, index) => {
      if (!segment.word) return document.createTextNode(segment.text);
      const token = el("span", "tok", segment.text);
      const scored = scores[index];
      if (scored?.bad) token.classList.add("bad");
      token.tabIndex = 0;
      token.setAttribute("role", "button");
      const open = () => openPopover(token, { word: segment.text, scored, score, ...source });
      token.addEventListener("click", open);
      token.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          open();
        }
      });
      return token;
    }),
  );
}

// ---- 单词弹窗 ----

function positionPopover(anchor) {
  const rect = anchor.getBoundingClientRect();
  const left = Math.max(8, Math.min(rect.left - 12, innerWidth - popover.offsetWidth - 8));
  let top = rect.bottom + 6;
  if (top + popover.offsetHeight > innerHeight - 8) top = Math.max(8, rect.top - popover.offsetHeight - 6);
  popover.style.left = `${left}px`;
  popover.style.top = `${top}px`;
}

function closePopover() {
  popoverTicket += 1;
  popover.hidden = true;
  popoverToken?.classList.remove("active");
  popoverToken = null;
}

async function lookupWord(word) {
  try {
    const response = await fetch(`${API}/lookup?word=${encodeURIComponent(word)}`);
    const data = await response.json();
    if (!response.ok) return { result: null, note: data.error || "查询失败" };
    return { result: data, note: data.definition ? "" : "没有词典释义" };
  } catch (_error) {
    return { result: null, note: "本机程序没开" };
  }
}

function savedWord(key, result) {
  const names = [key.toLowerCase(), result?.word?.toLowerCase()].filter(Boolean);
  return state.words.find((word) => names.includes(word.word)) || null;
}

function collectButton(button, info, result) {
  const saved = savedWord(FengsongCues.lookupKey(info.word), result);
  button.disabled = false;
  if (saved) {
    button.textContent = "已收藏 · 查看";
    button.onclick = () => openWordView(saved.id);
    return;
  }
  button.textContent = "收藏";
  button.onclick = async () => {
    button.disabled = true;
    const body = FengsongCues.wordPayload({ word: FengsongCues.lookupKey(info.word), result, sentence: info.sentence, cue: info.cue });
    try {
      const response = await fetch(`${API}/words`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!response.ok) throw new Error();
      await refreshWords();
      collectButton(button, info, result);
    } catch (_error) {
      button.textContent = "没有收藏上，再试一次";
      button.disabled = false;
    }
  };
}

async function openPopover(token, info) {
  closePopover();
  const ticket = popoverTicket;
  const stillOpen = () => ticket === popoverTicket;
  popoverToken = token;
  token.classList.add("active");

  const key = FengsongCues.lookupKey(info.word);
  const head = el("div", "pop-head");
  head.append(el("strong", "", info.word), iconButton("朗读这个词", () => speakText(key)));
  const ipa = el("span", "ipa");
  const definition = el("span", "definition", "查询中…");
  const phones = el("div", "pop-phones");
  const collect = el("button", "secondary", "收藏");
  collect.type = "button";
  collect.disabled = true;
  popover.replaceChildren(head, ipa, definition, phones, collect);
  popover.hidden = false;
  positionPopover(token);

  const columns = FengsongCues.wordColumns(info.score, info.scored);
  if (columns.length) {
    const label = info.scored.bad ? "上 标准 · 下 你的　红色没读准，点音素听" : "上 标准 · 下 你的　这个词读准了";
    phones.append(el("span", "legend", label), phoneGrid(columns));
  } else {
    phonesFor(key).then((list) => {
      if (!stillOpen() || !list?.length) return;
      phones.replaceChildren(phoneChips(list));
      positionPopover(token);
    });
  }

  const { result, note } = await lookupWord(key);
  if (!stillOpen()) return;
  ipa.textContent = showIpa(result?.ipa);
  definition.textContent = result?.definition || note;
  collectButton(collect, info, result);
  positionPopover(token);
}

// ---- 渲染 ----

function renderStatus() {
  $("#dot").classList.toggle("on", state.connected);
  $("#status-text").textContent = state.connected ? "本机已连接" : "本机程序没开";
}

function readState(kind, hasTarget, hasScore) {
  const mine = state.recordingFor === kind;
  const button = FengsongCues.readButton({
    connected: state.connected,
    hasCard: hasTarget,
    recording: mine ? state.recording : false,
    hasScore,
  });
  if (state.recording && !mine) return { ...button, disabled: true };
  return button;
}

function renderLiveText() {
  const cue = state.liveCue;
  if (popoverToken && liveText.contains(popoverToken)) closePopover();
  if (cue?.text) {
    renderSentence(liveText, cue.text, null, { sentence: cue.text, cue });
  } else {
    liveText.replaceChildren();
  }
}

function renderLive() {
  const cue = state.liveCue;
  liveText.dataset.placeholder = state.liveState === "no-caption" ? "这一句没有字幕" : "打开一个 YouTube 视频";
  $("#live-meta").textContent = cue ? fmt(cue.startMs) : "";
  $("#clip").disabled = !state.connected || !cue?.text;
  $("#live-play").disabled = !cue;
  $("#adjust").hidden = !cue;
  $("#live-hint").textContent = state.liveHint;
}

function renderScore(box, score, { grid }) {
  box.replaceChildren();
  if (!score) return;
  const hit = el("p", "hit");
  const ratio = el("span", "", "命中 ");
  ratio.append(el("span", "ratio", `${score.match_count}/${score.expected_count}`));
  hit.append(ratio);
  const byWord = !grid && score.words?.length;
  let legend = "上 标准 · 下 你的";
  if (byWord) {
    const bad = score.words.filter((word) => word.bad).length;
    legend = bad ? `${bad} 个词没读准，点红色的词看看` : "每个词都读准了";
  }
  hit.append(el("span", "legend", legend));
  box.append(hit);
  if (!byWord) box.append(phoneGrid(FengsongCues.scoreColumns(score)));
}

function renderCard() {
  const card = selectedCard();
  const edit = $("#edit");
  edit.hidden = !card;
  edit.textContent = state.editing ? "完成" : "编辑";
  cardText.hidden = !state.editing || !card;
  cardSentence.hidden = state.editing && Boolean(card);
  if (document.activeElement !== cardText) {
    cardText.value = card?.text || "";
    if (!cardText.hidden) resizeTextarea(cardText);
  }

  // Rebuilding the sentence would drop the word the popover points at, so it
  // only happens when what is shown actually changes.
  const key = JSON.stringify([card?.id, card?.text, card?.latest_attempt_id, Boolean(card?.score)]);
  if (key !== cardKey) {
    cardKey = key;
    if (popoverToken && cardSentence.contains(popoverToken)) closePopover();
    if (card) renderSentence(cardSentence, card.text, card.score, { sentence: card.text, cue: cardCue(card) });
    else cardSentence.replaceChildren();
    renderScore(scoreBox, card?.score, { grid: false });
  }
  cardSentence.dataset.placeholder = "摘下一句，或者在下面贴一句";

  const { label, disabled } = readState("card", Boolean(card), Boolean(card?.score) && cardText.value.trim() === card.text);
  const read = $("#read");
  read.textContent = label;
  read.disabled = disabled;
  read.classList.toggle("recording", state.recordingFor === "card" && Boolean(state.recording) && state.recording !== "uploading");
  $("#allow-mic").hidden = state.readHint !== "需要麦克风权限";
  $("#card-play").hidden = !card;
  $("#mine").hidden = !card?.latest_attempt_id;
  $("#read-hint").textContent = state.readHint;
  $("#add").disabled = !state.connected;
}

function renderList() {
  list.replaceChildren();
  if (state.cards.length === 0) {
    list.append(el("li", "empty", "还没有摘过句子"));
    return;
  }
  for (const card of state.cards) {
    const item = el("li", card.id === state.selectedId ? "selected" : "", card.text);
    item.addEventListener("click", () => {
      state.selectedId = card.id;
      state.readHint = "";
      state.editing = false;
      renderCard();
      renderList();
    });
    list.append(item);
  }
}

function wordRow(word) {
  const item = el("li", "word-item");
  const body = el("span", "word-body");
  body.append(el("strong", "", word.word));
  if (word.ipa) body.append(el("span", "ipa", showIpa(word.ipa)));
  const firstLine = (word.definition || "").split("\n")[0];
  if (firstLine) body.append(el("span", "word-def", firstLine));
  item.append(iconButton(`朗读 ${word.word}`, () => speakText(word.word)), body);
  if (word.score) {
    const badge = el("span", "badge", `${word.score.match_count}/${word.score.expected_count}`);
    badge.classList.add(word.score.match_count === word.score.expected_count ? "good" : "bad");
    badge.title = "上次跟读的命中";
    item.append(badge);
  }
  item.title = "打开这个词";
  item.addEventListener("click", () => openWordView(word.id));
  return item;
}

function renderWords() {
  wordList.replaceChildren();
  if (state.words.length === 0) {
    wordList.append(el("li", "empty", "还没有生词。点句子里的词，就能收藏。"));
    return;
  }
  wordList.append(...state.words.map(wordRow));
}

function renderTabs() {
  const words = state.activeTab === "words";
  $("#cards-tab").classList.toggle("active", !words);
  $("#words-tab").classList.toggle("active", words);
  list.hidden = words;
  wordList.hidden = !words;
  $("#paste").hidden = words;
  $("#add").hidden = words;
}

// ---- 单词详情 ----

function openWordView(id) {
  closePopover();
  state.wordId = id;
  state.wordHint = "";
  wordPhonesKey = "";
  main.hidden = true;
  wordView.hidden = false;
  renderWordView();
  wordView.scrollTop = 0;
}

function closeWordView() {
  state.wordId = null;
  wordView.hidden = true;
  main.hidden = false;
  state.activeTab = "words";
  renderTabs();
  renderWords();
}

function renderWordView() {
  if (!state.wordId) return;
  const word = selectedWordEntry();
  if (!word) {
    closeWordView();
    return;
  }
  $("#wv-word").textContent = word.word;
  $("#wv-ipa").textContent = showIpa(word.ipa);
  $("#wv-def").textContent = word.definition || "";

  if (wordPhonesKey !== word.id) {
    wordPhonesKey = word.id;
    const box = $("#wv-phones");
    box.replaceChildren(el("span", "legend", "正在拆音素…"));
    phonesFor(word.word).then((phones) => {
      if (state.wordId !== word.id) return;
      box.replaceChildren(phones?.length ? phoneChips(phones) : el("span", "legend", "暂时拿不到音素，本机程序开了吗？"));
      if (!phones?.length) wordPhonesKey = "";
    });
  }

  renderScore($("#wv-score"), word.score, { grid: true });
  const { label, disabled } = readState("word", true, Boolean(word.score));
  const read = $("#wv-read");
  read.textContent = label === "朗读" ? "跟读" : label;
  read.disabled = disabled;
  read.classList.toggle("recording", state.recordingFor === "word" && Boolean(state.recording) && state.recording !== "uploading");
  $("#wv-mine").hidden = !word.latest_attempt_id;
  $("#wv-actions").hidden = !word.latest_attempt_id;
  $("#wv-hint").textContent = state.wordHint;

  $("#wv-source").hidden = !word.source_sentence;
  $("#wv-sentence").textContent = word.source_sentence || "";
  $("#wv-source-play").hidden = !(word.video_id && word.start_ms != null);
}

// ---- 数据 ----

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

async function refreshWords() {
  const response = await fetch(`${API}/words`);
  const data = await response.json();
  state.words = data.words || [];
  renderWords();
  renderWordView();
}

async function pollHealth() {
  const was = state.connected;
  try {
    const response = await fetch(`${API}/health`);
    state.connected = response.ok;
  } catch (_error) {
    state.connected = false;
  }
  if (state.connected && !was) {
    refreshCards().catch(() => {});
    refreshWords().catch(() => {});
  }
  renderStatus();
  renderLive();
  renderCard();
  renderWordView();
}

async function pollCue() {
  const data = await chrome.runtime.sendMessage({ type: "get-cue" });
  state.liveState = data?.state || "no-video";
  const next = data?.cue ? { ...data.cue, text: FengsongCues.cleanCue(data.cue.text) } : null;
  const changed =
    next?.startMs !== state.liveCue?.startMs ||
    next?.endMs !== state.liveCue?.endMs ||
    next?.videoId !== state.liveCue?.videoId ||
    next?.text !== state.liveCue?.text;
  state.liveCue = next;
  if (changed) renderLiveText();
  renderLive();
}

async function clip() {
  const cue = state.liveCue;
  if (!cue?.text) return;
  state.liveHint = "";
  const response = await fetch(`${API}/cards`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      text: cue.text,
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
  state.editing = false;
  await refreshCards();
}

async function addPaste() {
  const text = $("#paste").value.trim();
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
  $("#paste").value = "";
  state.selectedId = data.card.id;
  state.readHint = "";
  state.editing = false;
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

// ---- 录音 ----

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

function renderRecording() {
  renderCard();
  renderWordView();
}

// `kind` is "card" or "word"; the recording is scored against that card's
// sentence or that word.
async function toggleRecord(kind, id) {
  if (state.recording === "uploading") return;
  if (state.recording) {
    if (state.recordingFor === kind) state.recording.stop();
    return;
  }
  if (!id) return;
  setHint(kind, "");
  if ((await microphoneState()) !== "granted") {
    const allowed = await askMicrophone();
    if (!allowed) {
      setHint(kind, "需要麦克风权限");
      return;
    }
  }
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch (_error) {
    setHint(kind, "需要麦克风权限");
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
    setHint(kind, "录音组件没有加载出来");
    return;
  }
  recorder.port.onmessage = (event) => chunks.push(event.data);
  source.connect(recorder);
  const url = kind === "word" ? `${API}/words/${id}/attempts` : `${API}/cards/${id}/attempts`;
  state.recordingFor = kind;
  state.recording = {
    stop: async () => {
      source.disconnect();
      recorder.port.close();
      stream.getTracks().forEach((track) => track.stop());
      const sampleRate = context.sampleRate;
      await context.close();
      state.recording = "uploading";
      renderRecording();
      const samples = FengsongAudio.resample(FengsongAudio.concat(chunks), sampleRate, 16000);
      let hint = "";
      try {
        const response = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "audio/wav" },
          body: FengsongAudio.encodeWav(samples, 16000),
        });
        const data = await response.json();
        if (!response.ok) hint = data.error || "没有评出来";
      } catch (_error) {
        hint = "本机程序没开";
      }
      state.recording = false;
      state.recordingFor = null;
      if (kind === "word") await refreshWords().catch(() => {});
      else await refreshCards().catch(() => {});
      setHint(kind, hint);
    },
  };
  renderRecording();
}

// ---- 事件 ----

$("#clip").addEventListener("click", clip);
$("#read").addEventListener("click", () => toggleRecord("card", state.selectedId));
$("#add").addEventListener("click", addPaste);
$("#paste").addEventListener("keydown", (event) => {
  if (event.key === "Enter") addPaste();
});
$("#allow-mic").addEventListener("click", async () => {
  const allowed = await askMicrophone();
  if (allowed) toggleRecord("card", state.selectedId);
  else setHint("card", "需要麦克风权限");
});
$("#live-play").addEventListener("click", async () => {
  const cue = state.liveCue;
  if (!cue) return;
  state.liveHint = await playRange(cue.videoId, cue.startMs, cue.endMs);
  renderLive();
});
$("#card-play").addEventListener("click", async () => {
  const card = selectedCard();
  if (!card) return;
  if (card.source === "youtube") {
    setHint("card", await playRange(card.video_id, card.start_ms, card.end_ms));
    return;
  }
  speakText(card.text);
});
$("#mine").addEventListener("click", () => {
  const card = selectedCard();
  if (card?.latest_attempt_id) play(`${API}/attempts/${card.latest_attempt_id}/audio`).catch(() => {});
});
$("#edit").addEventListener("click", () => {
  state.editing = !state.editing;
  closePopover();
  cardKey = "";
  renderCard();
  if (state.editing) {
    resizeTextarea(cardText);
    cardText.focus();
  }
});
for (const [id, edge, delta] of [
  ["#start-more", "start", -1],
  ["#start-less", "start", 1],
  ["#end-less", "end", -1],
  ["#end-more", "end", 1],
]) {
  $(id).addEventListener("click", () => chrome.runtime.sendMessage({ type: "adjust-cue", edge, delta }));
}
$("#reset-cue").addEventListener("click", () => chrome.runtime.sendMessage({ type: "reset-cue" }));
cardText.addEventListener("input", () => {
  resizeTextarea(cardText);
  scheduleSave();
});
$("#cards-tab").addEventListener("click", () => {
  state.activeTab = "cards";
  renderTabs();
});
$("#words-tab").addEventListener("click", () => {
  state.activeTab = "words";
  renderTabs();
  refreshWords().catch(() => {});
});

$("#wv-play").innerHTML = SPEAKER;
$("#wv-play").addEventListener("click", () => {
  const word = selectedWordEntry();
  if (word) speakText(word.word, "word");
});
$("#word-back").addEventListener("click", closeWordView);
$("#word-delete").addEventListener("click", async () => {
  const word = selectedWordEntry();
  if (!word) return;
  await fetch(`${API}/words/${word.id}`, { method: "DELETE" }).catch(() => {});
  closeWordView();
  await refreshWords().catch(() => {});
});
$("#wv-read").addEventListener("click", () => toggleRecord("word", state.wordId));
$("#wv-mine").addEventListener("click", () => {
  const word = selectedWordEntry();
  if (word?.latest_attempt_id) play(`${API}/attempts/${word.latest_attempt_id}/audio`).catch(() => {});
});
$("#wv-source-play").addEventListener("click", async () => {
  const word = selectedWordEntry();
  if (!word) return;
  setHint("word", await playRange(word.video_id, word.start_ms, word.end_ms));
});

document.addEventListener("pointerdown", (event) => {
  if (popover.hidden || popover.contains(event.target) || event.target.closest?.(".tok")) return;
  closePopover();
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") closePopover();
});

pollHealth();
refreshCards().catch(() => {});
refreshWords().catch(() => {});
setInterval(pollHealth, 2000);
setInterval(() => pollCue().catch(() => {}), 400);
renderLive();
renderCard();
renderList();
renderWords();
renderTabs();
