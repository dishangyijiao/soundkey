let latest = null;

chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});

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

  if (message.type === "get-cue") {
    if (!latest || Date.now() - latest.at > 5000) {
      sendResponse({ cue: null, state: "no-video" });
      return;
    }
    sendResponse({ cue: latest.cue, state: latest.state });
    return;
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
