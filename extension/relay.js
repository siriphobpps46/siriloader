// Isolated world: hook.js can't reach the extension, so it posts here and this forwards it
// with the frame's full URL (the referer the video host expects). It also answers the
// popup's "what's the cover?" — a sniffed playlist has no thumbnail of its own.
window.addEventListener("message", (e) => {
  const m = e.source === window && e.data?.__siriloader;
  if (m && typeof m.url === "string" && /^https?:/.test(m.url)) {
    chrome.runtime.sendMessage({ sniffed: { ...m, referer: location.href } }).catch(() => {});
  }
});

function abs(u) {
  try {
    const x = new URL(u, location.href).href;
    return /^https?:/.test(x) ? x : "";
  } catch {
    return "";
  }
}

const metaImage = () => {
  const m = document.querySelector(
    'meta[property="og:image"], meta[name="og:image"], meta[name="twitter:image"], meta[property="twitter:image"], meta[itemprop="thumbnailUrl"], link[rel="image_src"]',
  );
  return m ? abs(m.content || m.href) : "";
};

// Players (JW, video.js, Plyr…) paint the cover as a div background rather than <video poster>.
function playerCover() {
  const poster = [...document.querySelectorAll("video")].find((v) => v.poster)?.poster;
  if (poster) return abs(poster);
  for (const el of document.querySelectorAll('[class*="poster" i], [class*="preview" i]')) {
    const bg = getComputedStyle(el).backgroundImage.match(/url\(["']?(.+?)["']?\)/)?.[1];
    const u = bg && abs(bg);
    if (u) return u;
  }
  return "";
}

// Last resort: a frame of whatever is playing, small enough to keep in the app's history.
function snapshot() {
  const v = [...document.querySelectorAll("video")]
    .filter((v) => v.readyState >= 2 && v.videoWidth)
    .sort((a, b) => b.videoWidth * b.videoHeight - a.videoWidth * a.videoHeight)[0];
  if (!v) return "";
  try {
    const c = document.createElement("canvas");
    c.width = 320;
    c.height = Math.round((320 * v.videoHeight) / v.videoWidth);
    c.getContext("2d").drawImage(v, 0, 0, c.width, c.height);
    return c.toDataURL("image/jpeg", 0.7);
  } catch {
    return ""; // cross-origin video taints the canvas
  }
}

chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  // "player": the frame the stream came from. "page": the top frame, whose thumbnail-ish
  // classes are usually other videos' tiles, so only trust its meta tags.
  if (msg?.thumb === "player") reply(playerCover() || snapshot() || metaImage());
  else if (msg?.thumb === "page") reply(metaImage() || playerCover() || snapshot());
});
