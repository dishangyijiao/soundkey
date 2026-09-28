const text = document.querySelector("#text");
const settings = document.querySelector("#settings");

function settingsUrl() {
  return `chrome://settings/content/siteDetails?site=${encodeURIComponent(`${location.origin}/`)}`;
}

settings.addEventListener("click", () => {
  chrome.tabs.create({ url: settingsUrl() });
});

async function main() {
  let state = "prompt";
  try {
    state = (await navigator.permissions.query({ name: "microphone" })).state;
  } catch (_error) {
    state = "prompt";
  }
  if (state === "denied") {
    text.textContent = "麦克风已被关掉。打开设置后，把这个扩展的麦克风改成允许。";
    settings.hidden = false;
    return;
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.getTracks().forEach((track) => track.stop());
    text.textContent = "已允许麦克风。";
    setTimeout(() => window.close(), 300);
  } catch (_error) {
    text.textContent = "没有允许麦克风。打开设置后，把这个扩展的麦克风改成允许。";
    settings.hidden = false;
  }
}

main();
