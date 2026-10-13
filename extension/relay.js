// Isolated world: hook.js can't reach the extension, so it posts here and this forwards it,
// adding the frame's full URL — the referer the video host actually expects.
window.addEventListener("message", (e) => {
  const m = e.source === window && e.data?.__siriloader;
  if (m && typeof m.url === "string" && /^https?:/.test(m.url)) {
    chrome.runtime.sendMessage({ sniffed: { ...m, referer: location.href } }).catch(() => {});
  }
});
