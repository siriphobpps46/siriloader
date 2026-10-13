// Isolated world: hook.js can't reach the extension, so it posts here and this forwards it,
// adding the frame's full URL (the referer the video host expects) and a cover image.
// A sniffed playlist has no thumbnail of its own, but the page shows one.
function thumb() {
  const poster = [...document.querySelectorAll("video")].find((v) => v.poster)?.poster;
  const meta = document.querySelector(
    'meta[property="og:image"], meta[name="og:image"], meta[name="twitter:image"], meta[property="twitter:image"]',
  )?.content;
  if (!poster && !meta) return "";
  try {
    const u = new URL(poster || meta, location.href).href;
    return /^https?:/.test(u) ? u : "";
  } catch {
    return "";
  }
}

window.addEventListener("message", (e) => {
  const m = e.source === window && e.data?.__siriloader;
  if (m && typeof m.url === "string" && /^https?:/.test(m.url)) {
    chrome.runtime.sendMessage({ sniffed: { ...m, referer: location.href, thumb: thumb() } }).catch(() => {});
  }
});

// The popup asks the top frame for the page's cover when the entry didn't bring one.
chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  if (msg?.thumb) reply(thumb());
});
