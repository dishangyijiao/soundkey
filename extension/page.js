(() => {
  if (window.__soundkeyLoad) return;

  const state = { videoId: "", cues: [], url: "" };

  function videoId() {
    return new URLSearchParams(location.search).get("v") || "";
  }

  function reset(id) {
    if (state.videoId === id) return;
    state.videoId = id;
    state.cues = [];
    state.url = "";
  }

  function parseJson3(data) {
    const events = data?.events || [];
    const cues = [];
    for (let index = 0; index < events.length; index += 1) {
      const event = events[index];
      if (event.tStartMs == null) continue;
      const text = (event.segs || [])
        .map((segment) => segment.utf8 || "")
        .join("")
        .replace(/\s+/g, " ")
        .trim();
      if (!text) continue;
      let endMs = event.dDurationMs ? event.tStartMs + event.dDurationMs : 0;
      if (!endMs) {
        const next = events.slice(index + 1).find((item) => item.tStartMs > event.tStartMs);
        endMs = next ? next.tStartMs : event.tStartMs + 4000;
      }
      cues.push({ text, startMs: event.tStartMs, endMs });
    }
    return cues;
  }

  function parseXml(xml) {
    const doc = new DOMParser().parseFromString(xml, "text/xml");
    const cues = [];
    for (const node of doc.querySelectorAll("text, p")) {
      const raw = (node.textContent || "").replace(/\s+/g, " ").trim();
      if (!raw) continue;
      const milliseconds = node.hasAttribute("t") || node.hasAttribute("d");
      const start = Number(node.getAttribute("t") || node.getAttribute("start") || 0);
      const duration = Number(node.getAttribute("d") || node.getAttribute("dur") || 0);
      const startMs = milliseconds ? start : Math.round(start * 1000);
      const durMs = milliseconds ? duration : Math.round(duration * 1000);
      cues.push({ text: raw, startMs, endMs: startMs + (durMs || 4000) });
    }
    return cues;
  }

  function parseBody(body) {
    const text = String(body || "").replace(/^\)]}'\s*/, "").trim();
    if (!text) return [];
    if (text.startsWith("{") || text.startsWith("[")) {
      try {
        return parseJson3(JSON.parse(text));
      } catch (_error) {
        return [];
      }
    }
    if (text.startsWith("<")) return parseXml(text);
    return [];
  }

  function note(rawUrl, body) {
    let parsed;
    try {
      parsed = new URL(rawUrl, location.origin);
    } catch (_error) {
      return;
    }
    if (!parsed.pathname.includes("/api/timedtext")) return;
    if (parsed.searchParams.get("tlang")) return;
    const lang = (parsed.searchParams.get("lang") || "en").toLowerCase();
    if (!lang.startsWith("en")) return;
    const id = parsed.searchParams.get("v") || videoId();
    if (!id) return;
    reset(id);
    if (parsed.searchParams.get("pot")) state.url = parsed.href;
    const cues = parseBody(body);
    if (cues.length) state.cues = cues;
  }

  function readXhrBody(xhr, url) {
    try {
      if (xhr.responseType === "json" && xhr.response) {
        note(url, JSON.stringify(xhr.response));
        return;
      }
      if (xhr.responseType === "arraybuffer" && xhr.response) {
        note(url, new TextDecoder().decode(xhr.response));
        return;
      }
      if (xhr.response instanceof Blob) {
        xhr.response.text().then((body) => note(url, body)).catch(() => {});
        return;
      }
      if (typeof xhr.response === "string" && xhr.response) {
        note(url, xhr.response);
        return;
      }
      note(url, xhr.responseText || "");
    } catch (_error) {
      note(url, "");
    }
  }

  const originalOpen = XMLHttpRequest.prototype.open;
  const originalSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function open(method, url, ...rest) {
    this.__soundkeyUrl = String(url);
    return originalOpen.call(this, method, url, ...rest);
  };
  XMLHttpRequest.prototype.send = function send(...args) {
    this.addEventListener("load", () => {
      const url = this.responseURL || this.__soundkeyUrl || "";
      if (url.includes("timedtext")) readXhrBody(this, url);
    });
    return originalSend.apply(this, args);
  };

  const originalFetch = window.fetch;
  window.fetch = function fetch(input, init) {
    const url = typeof input === "string" ? input : input?.url || "";
    return originalFetch.call(this, input, init).then((response) => {
      if (String(url).includes("timedtext")) {
        response.clone().text().then((body) => note(response.url || url, body)).catch(() => {});
      }
      return response;
    });
  };

  function fromTextTracks() {
    const video = document.querySelector("video");
    if (!video?.textTracks) return [];
    for (const track of video.textTracks) {
      const lang = (track.language || "").toLowerCase();
      if (lang && !lang.startsWith("en")) continue;
      if (track.mode === "disabled") track.mode = "hidden";
      if (!track.cues?.length) continue;
      const cues = [];
      for (const cue of track.cues) {
        const text = String(cue.text || "").replace(/\s+/g, " ").trim();
        if (!text) continue;
        cues.push({
          text,
          startMs: Math.round(cue.startTime * 1000),
          endMs: Math.round(cue.endTime * 1000),
        });
      }
      if (cues.length) return cues;
    }
    return [];
  }

  let enabledOnce = false;

  function enableEnglish() {
    if (enabledOnce) return;
    const player = document.getElementById("movie_player");
    const button = document.querySelector(".ytp-subtitles-button");
    if (!player || !button) return;
    enabledOnce = true;
    if (button.getAttribute("aria-pressed") === "true") return;
    try {
      const list = player.getOption?.("captions", "tracklist") || [];
      const english = list.filter((item) => (item.languageCode || "").toLowerCase().startsWith("en"));
      const chosen = english.find((item) => item.kind !== "asr") || english[0];
      if (chosen && typeof player.setOption === "function") {
        player.setOption("captions", "track", chosen);
        return;
      }
    } catch (_error) {
      /* When no track can be selected, click the player's caption button instead. */
    }
    if (typeof player.toggleSubtitles === "function") player.toggleSubtitles();
    else button.click();
  }

  function urlWithPot(id) {
    const player = document.getElementById("movie_player");
    const response = player?.getPlayerResponse?.() || window.ytInitialPlayerResponse;
    const tracks = response?.captions?.playerCaptionsTracklistRenderer?.captionTracks || [];
    const english = tracks.filter((track) => (track.languageCode || "").toLowerCase().startsWith("en"));
    const track = english.find((item) => item.kind !== "asr") || english[0];
    if (!track?.baseUrl) return "";
    let pot = "";
    let potc = "";
    const audioTracks = player?.getAudioTrack?.()?.captionTracks || [];
    for (const item of audioTracks) {
      try {
        const url = new URL(item.url, location.origin);
        if (url.searchParams.get("v") && url.searchParams.get("v") !== id) continue;
        const lang = (url.searchParams.get("lang") || "").toLowerCase();
        if (lang && !lang.startsWith("en")) continue;
        if (!url.searchParams.get("pot")) continue;
        pot = url.searchParams.get("pot");
        potc = url.searchParams.get("potc") || "";
        break;
      } catch (_error) {
        /* This track URL is not a caption link. */
      }
    }
    if (!pot && state.url) {
      // note() only records state.url, as a resolved href, when it carries pot, so this cannot throw and pot is always set.
      const cached = new URL(state.url).searchParams;
      pot = cached.get("pot");
      potc = cached.get("potc") || "";
    }
    if (!pot) return "";
    const url = new URL(track.baseUrl, location.origin);
    url.searchParams.set("fmt", "json3");
    url.searchParams.set("c", "WEB");
    url.searchParams.set("pot", pot);
    if (potc) url.searchParams.set("potc", potc);
    return url.href;
  }

  async function fetchCues(url) {
    const response = await originalFetch(url, { credentials: "include" });
    return parseBody(await response.text());
  }

  window.__soundkeyLoad = async function load() {
    const id = videoId();
    if (!id) return [];
    if (state.videoId !== id) enabledOnce = false;
    reset(id);
    if (state.cues.length) return state.cues;
    const native = fromTextTracks();
    if (native.length) {
      state.cues = native;
      return native;
    }
    enableEnglish();
    const deadline = Date.now() + 8000;
    let tried = "";
    while (Date.now() < deadline) {
      if (videoId() !== id) return [];
      if (state.cues.length) return state.cues;
      const nativeAgain = fromTextTracks();
      if (nativeAgain.length) {
        state.cues = nativeAgain;
        return nativeAgain;
      }
      const captured = state.url && state.url !== tried ? state.url : "";
      const minted = !captured ? urlWithPot(id) : "";
      const next = captured || (minted && minted !== tried ? minted : "");
      if (next) {
        tried = next;
        try {
          const cues = await fetchCues(next);
          if (videoId() === id && cues.length) {
            state.cues = cues;
            return cues;
          }
        } catch (_error) {
          /* This URL is not usable yet; wait for the player's next request. */
        }
      } else {
        enableEnglish();
      }
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
    return videoId() === id ? state.cues : [];
  };
})();
