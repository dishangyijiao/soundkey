function readCaptionCues() {
  if (typeof window.__fengsongLoad === "function") return window.__fengsongLoad();
  return [];
}

let latest = null;

chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});

chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason !== "install" && details.reason !== "update") return;
  chrome.tabs.query({ url: "https://www.youtube.com/*" }, (tabs) => {
    for (const tab of tabs) {
      if (tab.id != null) chrome.tabs.reload(tab.id);
    }
  });
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "cue") {
    latest = {
      cue: message.cue,
      state: message.state,
      tabId: sender.tab?.id ?? null,
      at: Date.now(),
    };
    return;
  }

  if (message.type === "adjust-cue" || message.type === "reset-cue") {
    if (latest?.tabId != null) chrome.tabs.sendMessage(latest.tabId, message).catch(() => {});
    return;
  }

  if (message.type === "get-cue") {
    if (!latest || Date.now() - latest.at > 5000) {
      sendResponse({ cue: null, state: "no-video" });
      return;
    }
    sendResponse({ cue: latest.cue, state: latest.state });
    return;
  }

  if (message.type === "load-cues") {
    const tabId = sender.tab?.id;
    if (!tabId) {
      sendResponse({ cues: [] });
      return;
    }
    chrome.scripting
      .executeScript({ target: { tabId }, world: "MAIN", func: readCaptionCues })
      .then((results) => sendResponse({ cues: results?.[0]?.result || [] }))
      .catch(() => sendResponse({ cues: [] }));
    return true;
  }

  if (message.type === "play-range") {
    chrome.tabs.query({ url: "https://www.youtube.com/watch*" }, (tabs) => {
      const tab = tabs.find((item) => (item.url || "").includes(`v=${message.videoId}`));
      if (!tab?.id) {
        sendResponse({ ok: false, error: "打开原来的视频才能听原声" });
        return;
      }
      chrome.tabs.sendMessage(tab.id, message, (response) => {
        if (chrome.runtime.lastError) {
          sendResponse({ ok: false, error: "打开原来的视频才能听原声" });
          return;
        }
        sendResponse(response || { ok: false, error: "打开原来的视频才能听原声" });
      });
    });
    return true;
  }
});
