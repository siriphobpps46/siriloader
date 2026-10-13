// Hands a URL to the SiriLoader app. First try the app's loopback inbox (works whenever the
// app is open and tells us it arrived); if the app isn't running, fall back to the
// siriloader:// deep link so macOS launches it.
const INBOX = "http://127.0.0.1:47821/send";

function flag(tabId, text, title, color = "#172C66") {
  chrome.action.setBadgeBackgroundColor({ tabId, color });
  chrome.action.setBadgeText({ tabId, text });
  chrome.action.setTitle({ tabId, title });
  setTimeout(() => {
    chrome.action.setBadgeText({ tabId, text: "" });
    chrome.action.setTitle({ tabId, title: "ส่งหน้านี้เข้า SiriLoader" });
  }, 3000);
}

async function send(url, tabId) {
  if (!/^https?:\/\//i.test(url ?? "")) {
    return flag(tabId, "!", "ส่งได้เฉพาะหน้าเว็บ http/https", "#C0392B");
  }
  try {
    const r = await fetch(INBOX, { method: "POST", headers: { "X-SiriLoader": "1" }, body: url });
    if (!r.ok) throw new Error(String(r.status));
    flag(tabId, "✓", "ส่งเข้า SiriLoader แล้ว");
  } catch {
    chrome.tabs.update(tabId, { url: "siriloader://download?url=" + encodeURIComponent(url) });
    flag(tabId, "…", "กำลังเปิด SiriLoader — ถ้าไม่ขึ้น ให้เปิดแอปเองแล้วกดอีกครั้ง");
  }
}

chrome.action.onClicked.addListener((tab) => send(tab.url, tab.id));

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({ id: "page", title: "ส่งหน้านี้เข้า SiriLoader", contexts: ["page"] });
  chrome.contextMenus.create({ id: "link", title: "ส่งลิงก์นี้เข้า SiriLoader", contexts: ["link"] });
  chrome.contextMenus.create({ id: "media", title: "ส่งวิดีโอ/เสียงนี้เข้า SiriLoader", contexts: ["video", "audio"] });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  // A <video> src is often a blob: URL yt-dlp can't fetch; fall back to the page.
  const url = { link: info.linkUrl, media: info.srcUrl, page: info.pageUrl }[info.menuItemId];
  send(/^https?:/i.test(url ?? "") ? url : info.pageUrl, tab.id);
});
