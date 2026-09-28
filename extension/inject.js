(function () {
  function tracks() {
    const player = document.getElementById("movie_player");
    let response = null;
    try {
      if (player && typeof player.getPlayerResponse === "function") {
        response = player.getPlayerResponse();
      }
    } catch (_error) {
      response = null;
    }
    if (!response) response = window.ytInitialPlayerResponse || null;
    const list = response?.captions?.playerCaptionsTracklistRenderer?.captionTracks || [];
    return list.map((track) => ({
      baseUrl: track.baseUrl,
      languageCode: track.languageCode || "",
      kind: track.kind || "",
    }));
  }

  window.addEventListener("message", (event) => {
    if (event.source !== window || event.data?.source !== "fengsong") return;
    if (event.data.type === "tracks") {
      window.postMessage({ source: "fengsong-page", type: "tracks", tracks: tracks() }, "*");
    }
  });
})();
