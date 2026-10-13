// Hands a link to the SiriLoader app. First the app's loopback inbox (works whenever the app is
// open and confirms it arrived); if that fails the app is probably closed, so fall back to the
// siriloader:// deep link to have macOS launch it.
const INBOX = "http://127.0.0.1:47821/send";

/** @returns {Promise<"ok" | "launch" | "bad">} */
export async function send({ url, referer = "", title = "" }, tabId) {
  if (!/^https?:\/\//i.test(url ?? "")) return "bad";
  const clean = (title ?? "").replace(/\s+/g, " ").trim();
  try {
    const r = await fetch(INBOX, {
      method: "POST",
      headers: { "X-SiriLoader": "1" },
      body: [url, referer ?? "", clean].join("\n"),
    });
    if (!r.ok) throw new Error(String(r.status));
    return "ok";
  } catch {
    const q = new URLSearchParams({ url, referer: referer ?? "", title: clean });
    chrome.tabs.update(tabId, { url: "siriloader://download?" + q });
    return "launch";
  }
}
