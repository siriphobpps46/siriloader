// Two jobs: collect each tab's video streams/files (from webRequest here, and from hook.js
// which reads what the player actually loaded; the badge counts them, the popup lists them),
// and the right-click "send to SiriLoader" menu items.
import { send } from "./send.js";

const STREAM_URL = /\.(m3u8|mpd)(\?|#|$)/i;
const FILE_URL = /\.(mp4|webm|m4v|mov|mkv|flv)(\?|#|$)/i;
const STREAM_TYPE = /mpegurl|dash\+xml/i;
// Segments of a stream, and YouTube's own chunks (yt-dlp handles YouTube from the page URL).
const SKIP = /\.(ts|m4s|aac|vtt)(\?|#|$)|googlevideo\.com|video\/mp2t/i;
const MAX = 30;

const key = (tabId) => `t${tabId}`;
// The worker can be woken by many requests at once; queue writes so none clobber each other.
let queue = Promise.resolve();
const update = (tabId, fn) =>
  (queue = queue.then(async () => {
    const k = key(tabId);
    const list = fn((await chrome.storage.session.get(k))[k] ?? []);
    await chrome.storage.session.set({ [k]: list });
    badge(tabId, list.length);
  }));

function badge(tabId, n) {
  chrome.action.setBadgeBackgroundColor({ tabId, color: "#172C66" }).catch(() => {});
  chrome.action.setBadgeText({ tabId, text: n ? String(n) : "" }).catch(() => {});
}

function header(d, name) {
  return d.responseHeaders?.find((h) => h.name.toLowerCase() === name)?.value ?? "";
}

chrome.webRequest.onHeadersReceived.addListener(
  (d) => {
    if (d.tabId < 0) return;
    if (d.type === "main_frame") return void update(d.tabId, () => []);
    const type = header(d, "content-type");
    if (d.statusCode >= 400 || SKIP.test(d.url) || SKIP.test(type)) return;

    let kind = null;
    if (STREAM_URL.test(d.url) || STREAM_TYPE.test(type)) kind = /mpd|dash/i.test(d.url + type) ? "DASH" : "HLS";
    else if (FILE_URL.test(d.url) || /^video\//i.test(type)) kind = "MP4";
    if (!kind) return;

    // Range requests: the full size is after the slash in Content-Range.
    const size = Number(header(d, "content-range").split("/")[1]) || (d.statusCode === 200 && Number(header(d, "content-length"))) || null;
    // ponytail: referer is the requesting frame's origin; good enough for CDNs that check
    // origin. Upgrade path is webNavigation.getFrame for the frame's full URL.
    const referer = d.initiator && d.initiator !== "null" ? d.initiator + "/" : "";
    update(d.tabId, (list) =>
      list.some((m) => m.url === d.url) ? list : [...list, { url: d.url, kind, size, referer, at: Date.now() }].slice(-MAX),
    );
  },
  { urls: ["<all_urls>"], types: ["main_frame", "xmlhttprequest", "media", "other"] },
  ["responseHeaders"],
);

// From hook.js via relay.js: richer than webRequest (duration, height, full-frame referer),
// so it replaces a webRequest entry for the same URL.
chrome.runtime.onMessage.addListener((msg, sender) => {
  const m = msg?.sniffed;
  const tabId = sender.tab?.id;
  if (!m || tabId == null || !/^https?:/.test(m.url)) return;
  const entry = {
    url: m.url,
    kind: m.kind === "DASH" ? "DASH" : "HLS",
    master: !!m.master,
    duration: Number(m.duration) || null,
    height: Number(m.height) || null,
    size: null,
    referer: typeof m.referer === "string" ? m.referer : "",
    at: Date.now(),
  };
  update(tabId, (list) => [...list.filter((x) => x.url !== entry.url), entry].slice(-MAX));
});

chrome.tabs.onRemoved.addListener((tabId) => chrome.storage.session.remove(key(tabId)));

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({ id: "page", title: "ส่งหน้านี้เข้า SiriLoader", contexts: ["page"] });
  chrome.contextMenus.create({ id: "link", title: "ส่งลิงก์นี้เข้า SiriLoader", contexts: ["link"] });
  chrome.contextMenus.create({ id: "media", title: "ส่งวิดีโอ/เสียงนี้เข้า SiriLoader", contexts: ["video", "audio"] });
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  // A <video> src is often a blob: URL yt-dlp can't fetch; fall back to the page.
  const picked = { link: info.linkUrl, media: info.srcUrl, page: info.pageUrl }[info.menuItemId];
  const url = /^https?:/i.test(picked ?? "") ? picked : info.pageUrl;
  const sniffed = url !== info.pageUrl && info.menuItemId === "media";
  const result = await send({ url, referer: sniffed ? info.pageUrl : "", title: sniffed ? tab.title : "" }, tab.id);
  chrome.action.setBadgeText({ tabId: tab.id, text: { ok: "✓", launch: "…", bad: "!" }[result] });
  const k = key(tab.id);
  setTimeout(async () => badge(tab.id, ((await chrome.storage.session.get(k))[k] ?? []).length), 3000);
});
