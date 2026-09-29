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

function resizeTextarea(textarea) { textarea.style.height="auto"; textarea.style.height=`${textarea.scrollHeight}px`; }

function fmt(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const seconds = String(total % 60).padStart(2, "0");
  const minutes = Math.floor(total / 60) % 60;
  const hours = Math.floor(total / 3600);
  if (hours > 0) return `${hours}:${String(minutes).padStart(2, "0")}:${seconds}`;
  return `${minutes}:${seconds}`;
}

function phoneGrid(score) {
  const columns = FengsongCues.scoreColumns(score);
  const grid = document.createElement("div");
  grid.className = "phone-grid";
  grid.style.setProperty("--columns", Math.max(1, columns.length));
  for (const label of ["标准", "你的"]) {
    const tag = document.createElement("span"); tag.className = "phone-label"; tag.textContent = label; grid.append(tag);
    for (const col of columns) {
      const phone = col[label === "标准" ? "expected" : "heard"];
      const cell = document.createElement("button");
      cell.type = "button"; cell.className = `phone${phone?.bad ? " bad" : ""}${phone && /^[aeiouyæɑɒɔəɛɜɪʊʌøœɨɯɤɐʏɚɝᵻʉɵä]/u.test(phone.phone) ? " vowel" : ""}`;
      cell.textContent = phone?.phone || ""; cell.disabled = !phone;
      cell.title = phone ? `播放 ${phone.phone}` : "";
      cell.addEventListener("click", () => playPhone(phone.phone));
      grid.append(cell);
    }
  }
  return grid;
}

async function playPhone(ipa) {
  try { const audio = new Audio(`${API}/speak?ipa=${encodeURIComponent(ipa)}`); await audio.play(); }
  catch (_error) { state.readHint = `暂时无法播放音素 ${ipa}`; renderCard(); }
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

function renderPrimary() {
  const button=document.querySelector("#primary");
  const card=selectedCard();
  const recording=Boolean(state.recording)&&state.recording!=="uploading";
  const hasScore=Boolean(card?.score)&&cardText.value.trim()===card.text;
  button.textContent=state.recording==="uploading"?"正在听":recording?"停止":state.liveCue?"摘下这句":hasScore?"再读一次":"朗读";
  button.disabled=state.recording==="uploading"||(!recording&&(!state.connected||(state.liveCue?!liveText.value.trim():!selectedCard())));
}

function renderLive() {
  const cue = state.liveCue;
  if (!cue && document.activeElement !== liveText && !liveText.value) {
    liveText.placeholder = state.liveState === "no-caption" ? "这一句没有字幕" : "打开一个 YouTube 视频";
  } else {
    liveText.placeholder = "";
  }
  document.querySelector("#live-meta").textContent = cue ? fmt(cue.startMs) : "";
  renderPrimary();
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
  renderPrimary();
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
  const response = await fetch(`${API}/words`); const data = await response.json(); state.words = data.words || []; renderWords();
}
function renderWords() {
  wordList.replaceChildren();
  if (!state.words.length) { const li=document.createElement("li"); li.className="empty"; li.textContent="还没有生词"; wordList.append(li); return; }
  for (const word of state.words) { const li=document.createElement("li"); li.className="word-item"; const body=document.createElement("span"); body.textContent=`${word.word}${word.ipa ? `  ${word.ipa}` : ""}${word.definition ? `  ${word.definition}` : ""}`; li.append(body); const remove=document.createElement("button"); remove.className="text-button"; remove.textContent="删除"; remove.onclick=async(event)=>{event.stopPropagation();await fetch(`${API}/words/${word.id}`,{method:"DELETE"}); await refreshWords();}; li.append(remove); if(word.video_id && word.start_ms!=null){li.title="点击回听来源";li.onclick=()=>playRange(word.video_id,word.start_ms,word.end_ms); } wordList.append(li); }
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

async function showWordPopover() {
  const word = FengsongCues.selectedWord(liveText.value, liveText.selectionStart, liveText.selectionEnd);
  if (!word) { popover.hidden = true; return; }
  popover.replaceChildren();
  const title=document.createElement("strong"); title.textContent=word; popover.append(title);
  const details=document.createElement("span"); details.textContent="查询中…"; popover.append(details);
  const add=document.createElement("button"); add.type="button"; add.className="text-button"; add.textContent="加入生词本"; add.disabled=true; popover.append(add);
  const rect=liveText.getBoundingClientRect(); popover.style.left=`${Math.max(8,Math.min(rect.left,innerWidth-270))}px`; popover.style.top=`${Math.min(innerHeight-100,rect.bottom+6)}px`; popover.hidden=false;
  let result={word,ipa:null,definition:null};
  try { const response=await fetch(`${API}/lookup?word=${encodeURIComponent(word)}`); if(response.ok) result=await response.json(); else details.textContent=(await response.json()).error||"查询失败"; }
  catch(_error){details.textContent="本机程序没开";}
  if(popover.hidden || title.textContent!==word) return;
  details.textContent=[result.ipa,result.definition].filter(Boolean).join(" · ") || "没有词典释义";
  add.disabled=false;
  add.onclick=async()=>{
    const cue=state.liveCue;
    const response=await fetch(`${API}/words`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({word:result.word||word,ipa:result.ipa,definition:result.definition,source_sentence:FengsongCues.cleanCue(liveText.value)||null,video_id:cue?.videoId||null,start_ms:cue?.startMs??null,end_ms:cue?.endMs??null})});
    if(response.ok){state.activeTab="words";renderTabs();await refreshWords();popover.hidden=true;}
  };
}

function renderTabs(){
  const words=state.activeTab==="words"; document.querySelector("#cards-tab").classList.toggle("active",!words);document.querySelector("#words-tab").classList.toggle("active",words);list.hidden=words;wordList.hidden=!words;document.querySelector("#paste").hidden=words;document.querySelector("#add").hidden=words;
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

document.querySelector("#primary").addEventListener("click", () => { if(state.recording&&state.recording!=="uploading") toggleRecord(); else if(state.liveCue) clip(); else toggleRecord(); });
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
