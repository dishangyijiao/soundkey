function readCaptionCues() {
  if (typeof window.__soundkeyLoad === "function") return window.__soundkeyLoad();
  return [];
}

let latest = null;

chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});

// The panel is for YouTube only: off everywhere by default, switched on per tab. The extension can read a tab's
// address only on the hosts it has permission for, so any tab without a readable address stays off.
const YOUTUBE = /^https:\/\/www\.youtube\.com\//;

function setPanel(tabId, enabled) {
  chrome.sidePanel.setOptions({ tabId, path: "sidepanel.html", enabled }).catch(() => {});
}

chrome.sidePanel.setOptions({ enabled: false }).catch(() => {});
chrome.tabs.query({ url: "https://www.youtube.com/*" }, (tabs) => {
  // A call without a tab id would change the default for every tab, so a tab without one is skipped.
  for (const tab of tabs) if (tab.id != null) setPanel(tab.id, true);
});
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.url !== undefined) setPanel(tabId, YOUTUBE.test(tab.url || ""));
});

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
      at: Date.now(),
    };
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
