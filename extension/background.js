// Hands a URL to the SiriLoader app through its siriloader:// deep link.
// Chrome asks "Open SiriLoader?" the first time; the page itself stays put.
function send(url, tabId) {
  if (!/^https?:\/\//i.test(url ?? "")) return;
  chrome.tabs.update(tabId, { url: "siriloader://download?url=" + encodeURIComponent(url) });
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
