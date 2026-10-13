import { send } from "./send.js";

const $ = (id) => document.getElementById(id);
const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
const k = `t${tab.id}`;
// Longest first: the main video is long, ads are 15–30 s. Unknown length (master playlists,
// plain files) goes by resolution, then newest.
const found = ((await chrome.storage.session.get(k))[k] ?? [])
  .slice()
  .sort((a, b) => (b.duration ?? 0) - (a.duration ?? 0) || (b.height ?? 0) - (a.height ?? 0) || b.at - a.at);

function size(n) {
  if (!n) return "";
  const u = ["B", "KB", "MB", "GB"];
  let i = 0;
  while (n >= 1024 && i < u.length - 1) (n /= 1024), i++;
  return `${n.toFixed(i > 1 ? 1 : 0)} ${u[i]}`;
}

function clock(s) {
  if (!s) return "";
  s = Math.round(s);
  const h = Math.floor(s / 3600);
  const mm = String(Math.floor((s % 3600) / 60)).padStart(h ? 2 : 1, "0");
  return `${h ? h + ":" : ""}${mm}:${String(s % 60).padStart(2, "0")}`;
}

// Ask relay.js for a cover: first the frame the stream came from, then the top frame.
// "" when the page has no content script (opened before the extension was reloaded).
const ask = (frameId, mode) => chrome.tabs.sendMessage(tab.id, { thumb: mode }, { frameId }).catch(() => "");
const cover = async (frameId) => (frameId != null && frameId !== 0 && (await ask(frameId, "player"))) || (await ask(0, "page")) || "";

async function go(item, frameId) {
  const result = await send({ ...item, thumbnail: await cover(frameId) }, tab.id);
  $("status").className = result === "bad" ? "bad" : "";
  $("status").textContent = {
    ok: "ส่งเข้า SiriLoader แล้ว ✓",
    launch: "กำลังเปิด SiriLoader… ถ้าไม่ขึ้น ให้เปิดแอปเองแล้วกดอีกครั้ง",
    bad: "หน้านี้ส่งไม่ได้ — ต้องเป็นหน้าเว็บ http/https",
  }[result];
  if (result === "ok") setTimeout(() => window.close(), 700);
}

$("page").onclick = () => go({ url: tab.url });
$("empty").hidden = found.length > 0;

for (const m of found) {
  const u = new URL(m.url);
  const li = document.createElement("li");
  const b = document.createElement("button");
  const last = u.pathname.split("/").filter(Boolean).pop() ?? u.hostname;
  let name = last;
  try {
    name = decodeURIComponent(last);
  } catch {}
  const facts = [clock(m.duration), m.height && `${m.height}p`, size(m.size)].filter(Boolean).join(" · ");
  const label = m.master ? "หลายความชัด" : name;
  for (const [cls, text] of [["kind", m.kind], ["file", label], ["size", facts], ["host", u.hostname]]) {
    const s = document.createElement("span");
    s.className = cls;
    s.textContent = text;
    b.append(s);
  }
  b.title = m.url;
  b.onclick = () => go({ url: m.url, referer: m.referer || tab.url, title: tab.title }, m.frameId);
  li.append(b);
  $("list").append(li);
}
