import { send } from "./send.js";

const $ = (id) => document.getElementById(id);
const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
const k = `t${tab.id}`;
const found = ((await chrome.storage.session.get(k))[k] ?? []).slice().reverse();

function size(n) {
  if (!n) return "";
  const u = ["B", "KB", "MB", "GB"];
  let i = 0;
  while (n >= 1024 && i < u.length - 1) (n /= 1024), i++;
  return `${n.toFixed(i > 1 ? 1 : 0)} ${u[i]}`;
}

async function go(item) {
  const result = await send(item, tab.id);
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
  const name = decodeURIComponent(u.pathname.split("/").filter(Boolean).pop() ?? u.hostname);
  for (const [cls, text] of [["kind", m.kind], ["file", name], ["size", size(m.size)], ["host", u.hostname]]) {
    const s = document.createElement("span");
    s.className = cls;
    s.textContent = text;
    b.append(s);
  }
  b.title = m.url;
  b.onclick = () => go({ url: m.url, referer: m.referer || tab.url, title: tab.title });
  li.append(b);
  $("list").append(li);
}
