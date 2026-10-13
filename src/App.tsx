import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import { openPath, revealItemInDir } from "@tauri-apps/plugin-opener";
import { getCurrent, onOpenUrl } from "@tauri-apps/plugin-deep-link";
import mark from "../assets/logo/mark-navy.svg";
import { Icon, type IconName } from "./icons";

type Tools = { ytdlp: string | null; ffmpeg: string | null; version: string | null };
type Quality = { id: string; label: string; detail: string; size: number | null; format: string; audio_only: boolean };
type Info = {
  title: string;
  thumbnail: string | null;
  uploader: string | null;
  duration: number | null;
  site: string;
  qualities: Quality[];
  h264_max: number | null;
};
type Incoming = { url: string; referer?: string | null; title?: string | null };
type Status = "downloading" | "processing" | "done" | "error" | "cancelled";
type Job = {
  id: string;
  url: string;
  title: string;
  thumbnail: string | null;
  site?: string;
  quality: string;
  format: string;
  audioOnly: boolean;
  compat?: boolean;
  referer?: string | null;
  name?: string | null;
  dir: string;
  status: Status;
  done?: number | null;
  total?: number | null;
  speed?: number | null;
  eta?: number | null;
  audio?: boolean;
  path?: string;
  error?: string;
};
type Ev =
  | { kind: "progress"; id: string; done: number | null; total: number | null; speed: number | null; eta: number | null; audio: boolean }
  | { kind: "processing"; id: string }
  | { kind: "done"; id: string; path: string }
  | { kind: "error"; id: string; message: string }
  | { kind: "cancelled"; id: string };
type Filter = { by: "status"; value: "all" | "running" | "done" | "failed" } | { by: "site"; value: string };

// localStorage only remembers conveniences (folder, last quality, history); losing it is harmless.
const store = {
  get<T>(k: string, fallback: T): T {
    try {
      const v = localStorage.getItem(k);
      return v ? (JSON.parse(v) as T) : fallback;
    } catch {
      return fallback;
    }
  },
  set(k: string, v: unknown) {
    try {
      localStorage.setItem(k, JSON.stringify(v));
    } catch {}
  },
};

const isWeb = (s?: string | null) => !!s && /^https?:\/\//i.test(s);
const running = (j: Job) => j.status === "downloading" || j.status === "processing";
const failed = (j: Job) => j.status === "error" || j.status === "cancelled";

// siriloader://download?url=&referer=&title= — the extension's fallback when the app is closed.
// Like the loopback inbox, it only fills the box and probes; the user still clicks Download.
function fromDeepLink(deep: string): Incoming | null {
  try {
    const p = new URL(deep).searchParams;
    return { url: p.get("url") ?? "", referer: p.get("referer"), title: p.get("title") };
  } catch {
    return null;
  }
}

// yt-dlp's extractor key → what people call the site. Anything generic is "other sites".
function siteName(key?: string) {
  if (!key || /^(generic|html5mediaembed)$/i.test(key)) return "เว็บอื่น ๆ";
  const known: Record<string, string> = { youtube: "YouTube", twitter: "X", tiktok: "TikTok", facebook: "Facebook" };
  return known[key.toLowerCase()] ?? key;
}

const siteIcon = (name: string): IconName => (name === "YouTube" ? "play" : "globe");

function bytes(n?: number | null) {
  if (!n) return "";
  const u = ["B", "KB", "MB", "GB"];
  let i = 0;
  while (n >= 1024 && i < u.length - 1) (n /= 1024), i++;
  return `${n.toFixed(i > 1 ? 1 : 0)} ${u[i]}`;
}

function clock(s?: number | null) {
  if (s == null) return "";
  s = Math.round(s);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}

const homeShort = (p: string) => p.replace(/^\/Users\/[^/]+/, "~");

function qualityLabel(q: Quality) {
  const base = q.id === "best" ? `ชัดที่สุด — ${q.detail}` : q.detail.startsWith(q.label) ? q.detail : `${q.label} — ${q.detail}`;
  return q.size ? `${base} (~${bytes(q.size)})` : base;
}

export default function App() {
  const [tools, setTools] = useState<Tools | null>(null);
  const [url, setUrl] = useState("");
  const [info, setInfo] = useState<Info | null>(null);
  const [probing, setProbing] = useState(false);
  const [error, setError] = useState("");
  const [qualityId, setQualityId] = useState(() => store.get("quality", "best"));
  const [audioMode, setAudioMode] = useState(() => store.get("audioMode", false));
  const [dir, setDir] = useState(() => store.get("dir", ""));
  const [compat, setCompat] = useState(() => store.get("compat", false));
  const [settings, setSettings] = useState(false);
  const [filter, setFilter] = useState<Filter>({ by: "status", value: "all" });
  // Referer + page title that came with a sniffed link; dropped as soon as the user edits the box.
  const [source, setSource] = useState<Incoming | null>(null);
  const [jobs, setJobs] = useState<Job[]>(() =>
    store.get<Job[]>("jobs", []).map((j) => (running(j) ? { ...j, status: "cancelled" } : j)),
  );
  const probeSeq = useRef(0);
  const field = useRef<HTMLInputElement>(null);

  useEffect(() => {
    invoke<Tools>("tools").then(setTools);
    if (!dir) invoke<string>("default_dir").then(setDir);
    const off = listen<Ev>("dl", ({ payload: e }) =>
      setJobs((js) =>
        js.map((j) => {
          if (j.id !== e.id) return j;
          switch (e.kind) {
            case "progress":
              return { ...j, status: "downloading", done: e.done, total: e.total, speed: e.speed, eta: e.eta, audio: e.audio };
            case "processing":
              return { ...j, status: "processing" };
            case "done":
              return { ...j, status: "done", path: e.path };
            case "error":
              return { ...j, status: "error", error: e.message };
            case "cancelled":
              return { ...j, status: "cancelled" };
          }
        }),
      ),
    );
    const take = (inc: Incoming | null) => {
      if (!inc || !isWeb(inc.url)) return;
      const src = { ...inc, referer: isWeb(inc.referer) ? inc.referer : null };
      setUrl(src.url);
      setSource(src);
      probe(src.url, src);
    };
    getCurrent().then((urls) => take(urls?.[0] ? fromDeepLink(urls[0]) : null));
    const offLink = onOpenUrl((urls) => take(fromDeepLink(urls[0])));
    const offInbox = listen<Incoming>("open-url", (e) => take(e.payload));
    // ⌘L jumps to the link field, ⌘, opens settings — the usual Mac shortcuts.
    const onKey = (e: KeyboardEvent) => {
      if (!e.metaKey) return;
      if (e.key === "l") {
        e.preventDefault();
        field.current?.select();
      } else if (e.key === ",") {
        e.preventDefault();
        setSettings(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      off.then((f) => f());
      offLink.then((f) => f());
      offInbox.then((f) => f());
      window.removeEventListener("keydown", onKey);
    };
  }, []);

  useEffect(() => store.set("jobs", jobs.slice(0, 100)), [jobs]);
  useEffect(() => store.set("dir", dir), [dir]);
  useEffect(() => store.set("quality", qualityId), [qualityId]);
  useEffect(() => store.set("audioMode", audioMode), [audioMode]);
  useEffect(() => store.set("compat", compat), [compat]);

  async function probe(target = url, src = source) {
    if (!target.trim()) return;
    const seq = ++probeSeq.current;
    setProbing(true);
    setError("");
    setInfo(null);
    try {
      const i = await invoke<Info>("probe", { url: target, referer: src?.referer ?? null });
      // A sniffed stream is titled "master"/"index"; the page title is what the user knows it by.
      if (seq === probeSeq.current) setInfo(src?.title ? { ...i, title: src.title } : i);
    } catch (e) {
      if (seq === probeSeq.current) setError(String(e));
    } finally {
      if (seq === probeSeq.current) setProbing(false);
    }
  }

  const videoQualities = info?.qualities.filter((q) => !q.audio_only) ?? [];
  const audioQuality = info?.qualities.find((q) => q.audio_only);
  const useAudio = audioMode && !!audioQuality;
  const quality = useAudio ? audioQuality : (videoQualities.find((q) => q.id === qualityId) ?? videoQualities[0]);
  const useCompat = compat && !useAudio;
  const qualityHeight = Number(quality?.detail.match(/^(\d+)p/)?.[1] ?? 0);
  // Only warn when MP4 mode will actually land below what was picked.
  const compatCap = useCompat && info?.h264_max && qualityHeight > info.h264_max ? info.h264_max : null;

  function closeSheet() {
    probeSeq.current++;
    setInfo(null);
    setProbing(false);
  }

  async function download() {
    if (!info || !quality) return;
    const job: Job = {
      id: crypto.randomUUID(),
      url: url.trim(),
      title: info.title,
      thumbnail: info.thumbnail,
      site: siteName(info.site),
      quality: (useAudio ? "MP3" : quality.id === "best" ? `ชัดที่สุด · ${quality.detail}` : quality.label) + (useCompat ? " · MP4" : ""),
      format: quality.format,
      audioOnly: quality.audio_only,
      compat: useCompat,
      referer: source?.referer,
      name: source?.title,
      dir,
      status: "downloading",
    };
    setJobs((js) => [job, ...js]);
    setUrl("");
    setSource(null);
    setInfo(null);
    setFilter({ by: "status", value: "all" });
    run(job);
  }

  // Also used by Retry: same id, so yt-dlp picks up its own .part files.
  async function run(job: Job) {
    setJobs((js) => js.map((j) => (j.id === job.id ? { ...j, status: "downloading", error: undefined, done: null, total: null } : j)));
    try {
      await invoke("start", {
        id: job.id,
        url: job.url,
        format: job.format,
        audioOnly: job.audioOnly,
        compat: !!job.compat,
        dir: job.dir,
        referer: job.referer ?? null,
        name: job.name ?? null,
      });
    } catch (e) {
      setJobs((js) => js.map((j) => (j.id === job.id ? { ...j, status: "error", error: String(e) } : j)));
    }
  }

  async function pickDir() {
    const d = await open({ directory: true, defaultPath: dir });
    if (typeof d === "string") setDir(d);
  }

  const missing = !!tools && (!tools.ytdlp || !tools.ffmpeg);
  const active = jobs.filter(running);
  const speed = active.reduce((s, j) => s + (j.status === "downloading" ? (j.speed ?? 0) : 0), 0);
  const sites = [...new Set(jobs.map((j) => j.site ?? "เว็บอื่น ๆ"))];
  const shown = jobs.filter((j) =>
    filter.by === "site"
      ? (j.site ?? "เว็บอื่น ๆ") === filter.value
      : filter.value === "running"
        ? running(j)
        : filter.value === "done"
          ? j.status === "done"
          : filter.value === "failed"
            ? failed(j)
            : true,
  );
  const isOn = (f: Filter) => f.by === filter.by && f.value === filter.value;
  const sideItem = (f: Filter, icon: IconName, label: string, count: number) => (
    <button key={f.by + f.value} className={isOn(f) ? "item on" : "item"} onClick={() => setFilter(f)}>
      <Icon name={icon} />
      <span>{label}</span>
      <b>{count || ""}</b>
    </button>
  );

  return (
    <div className="app">
      <header className="toolbar" data-tauri-drag-region>
        <form
          className="field"
          onSubmit={(e) => {
            e.preventDefault();
            probe();
          }}
        >
          <Icon name="link" />
          <input
            ref={field}
            autoFocus
            value={url}
            placeholder="วางลิงก์วิดีโอหรือเสียง…"
            spellCheck={false}
            onChange={(e) => {
              setUrl(e.target.value);
              setSource(null);
            }}
            onPaste={(e) => {
              const t = e.clipboardData.getData("text").trim();
              if (isWeb(t)) {
                e.preventDefault();
                setUrl(t);
                setSource(null);
                probe(t, null);
              }
            }}
          />
        </form>
        <button className="btn primary" disabled={probing || !url.trim()} onClick={() => probe()}>
          {probing ? <span className="spin" /> : "ดาวน์โหลด"}
        </button>
        <button className="tool" title="เปิดโฟลเดอร์ที่บันทึก" onClick={() => openPath(dir)}>
          <Icon name="folder" size={18} />
        </button>
        <button className="tool" title="ตั้งค่า (⌘,)" onClick={() => setSettings(true)}>
          <Icon name="gear" size={18} />
        </button>
      </header>

      <div className="body">
        <nav className="side">
          <h6>ดาวน์โหลด</h6>
          {sideItem({ by: "status", value: "all" }, "tray", "ทั้งหมด", jobs.length)}
          {sideItem({ by: "status", value: "running" }, "clock", "กำลังโหลด", active.length)}
          {sideItem({ by: "status", value: "done" }, "check", "เสร็จแล้ว", jobs.filter((j) => j.status === "done").length)}
          {sideItem({ by: "status", value: "failed" }, "warn", "ไม่สำเร็จ", jobs.filter(failed).length)}
          {sites.length > 0 && <h6>แหล่งที่มา</h6>}
          {sites.map((s) =>
            sideItem({ by: "site", value: s }, siteIcon(s), s, jobs.filter((j) => (j.site ?? "เว็บอื่น ๆ") === s).length),
          )}
        </nav>

        <main className="main">
          {missing && (
            <div className="banner">
              <Icon name="warn" />
              <span>
                ยังไม่พบ {[!tools.ytdlp && "yt-dlp", !tools.ffmpeg && "ffmpeg"].filter(Boolean).join(" และ ")} — รัน{" "}
                <code>brew install yt-dlp ffmpeg</code> ใน Terminal
              </span>
              <button className="link" onClick={() => invoke<Tools>("tools").then(setTools)}>
                ตรวจใหม่
              </button>
            </div>
          )}
          {error && (
            <div className="banner bad">
              <Icon name="warn" />
              <span>{error}</span>
              <button className="link" onClick={() => setError("")}>
                ปิด
              </button>
            </div>
          )}

          {shown.length === 0 ? (
            <div className="empty">
              <img src={mark} alt="" />
              <p>{jobs.length ? "ไม่มีรายการในหมวดนี้" : "วางลิงก์ที่ช่องด้านบน หรือส่งจาก extension ใน Chrome"}</p>
            </div>
          ) : (
            <ul className="list">
              {shown.map((j) => (
                <Row key={j.id} job={j} onRetry={() => run(j)} />
              ))}
            </ul>
          )}

          <footer className="status">
            <button className="link quiet" onClick={pickDir} title={dir}>
              บันทึกที่ {homeShort(dir)}
            </button>
            {tools?.version && <span>yt-dlp {tools.version}</span>}
            <span className="grow" />
            {jobs.some((j) => !running(j)) && (
              <button className="link quiet" onClick={() => setJobs((js) => js.filter(running))}>
                ล้างรายการที่จบแล้ว
              </button>
            )}
            {active.length > 0 && (
              <span>
                {active.length} กำลังโหลด{speed ? ` · ${bytes(speed)}/s` : ""}
              </span>
            )}
          </footer>
        </main>
      </div>

      {(info || probing) && (
        <Sheet onCancel={closeSheet} onConfirm={download}>
          {!info ? (
            <div className="loading">
              <span className="spin dark" /> กำลังดึงข้อมูล…
            </div>
          ) : (
            <>
              <div className="meta">
                {info.thumbnail ? (
                  <img src={info.thumbnail} alt="" referrerPolicy="no-referrer" />
                ) : (
                  <div className="thumb">
                    <Icon name="film" size={22} />
                  </div>
                )}
                <div>
                  <h2>{info.title}</h2>
                  <p>{[siteName(info.site), info.uploader, info.duration && clock(info.duration)].filter(Boolean).join(" · ")}</p>
                </div>
              </div>
              <div className="form">
                <label htmlFor="kind">รูปแบบ</label>
                <select id="kind" value={useAudio ? "audio" : "video"} onChange={(e) => setAudioMode(e.target.value === "audio")}>
                  <option value="video">วิดีโอ</option>
                  {audioQuality && <option value="audio">เสียงอย่างเดียว (MP3)</option>}
                </select>
                {!useAudio && (
                  <>
                    <label htmlFor="q">ความชัด</label>
                    <select id="q" value={quality?.id} onChange={(e) => setQualityId(e.target.value)}>
                      {videoQualities.map((q) => (
                        <option key={q.id} value={q.id}>
                          {qualityLabel(q)}
                        </option>
                      ))}
                    </select>
                    <span />
                    <label className="check">
                      <input type="checkbox" checked={compat} onChange={(e) => setCompat(e.target.checked)} />
                      MP4 เปิดได้ทุกที่
                      <em>{compatCap ? `· คลิปนี้ได้สูงสุด ${compatCap}p` : "· QuickTime, iPhone, ทีวี"}</em>
                    </label>
                  </>
                )}
                {useAudio && audioQuality?.size ? (
                  <>
                    <span />
                    <em className="note">~{bytes(audioQuality.size)}</em>
                  </>
                ) : null}
                <label>บันทึกที่</label>
                <button className="select" onClick={pickDir} title={dir}>
                  <Icon name="folder" />
                  <span>{dir.split("/").pop() || dir}</span>
                </button>
              </div>
            </>
          )}
          <div className="buttons">
            <button className="btn" onClick={closeSheet}>
              ยกเลิก
            </button>
            <button className="btn primary" disabled={!info} onClick={download}>
              ดาวน์โหลด
            </button>
          </div>
        </Sheet>
      )}

      {settings && (
        <Sheet onCancel={() => setSettings(false)} onConfirm={() => setSettings(false)}>
          <h2 className="sheet-title">ตั้งค่า</h2>
          <div className="form">
            <label>บันทึกที่</label>
            <button className="select" onClick={pickDir} title={dir}>
              <Icon name="folder" />
              <span>{homeShort(dir)}</span>
            </button>
            <label>ค่าเริ่มต้น</label>
            <label className="check">
              <input type="checkbox" checked={compat} onChange={(e) => setCompat(e.target.checked)} />
              MP4 เปิดได้ทุกที่
            </label>
            <label>yt-dlp</label>
            <span className={tools?.ytdlp ? "fact" : "fact bad"}>{tools?.ytdlp ? `${tools.version} · ${tools.ytdlp}` : "ไม่พบ"}</span>
            <label>ffmpeg</label>
            <span className={tools?.ffmpeg ? "fact" : "fact bad"}>{tools?.ffmpeg ?? "ไม่พบ"}</span>
          </div>
          <div className="buttons">
            <button className="btn" onClick={() => invoke<Tools>("tools").then(setTools)}>
              ตรวจเครื่องมือใหม่
            </button>
            <button className="btn primary" onClick={() => setSettings(false)}>
              เสร็จ
            </button>
          </div>
        </Sheet>
      )}
    </div>
  );
}

/** macOS-style sheet: drops from under the toolbar, Esc cancels, Enter confirms. */
function Sheet({ children, onCancel, onConfirm }: { children: React.ReactNode; onCancel: () => void; onConfirm: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
      else if (e.key === "Enter" && !(e.target instanceof HTMLSelectElement) && !(e.target instanceof HTMLButtonElement)) {
        e.preventDefault();
        onConfirm();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });
  return (
    <>
      <div className="dim" onClick={onCancel} />
      <div className="sheet" role="dialog" aria-modal>
        {children}
      </div>
    </>
  );
}

function Row({ job: j, onRetry }: { job: Job; onRetry: () => void }) {
  const pct = j.total && j.done != null ? Math.min(100, (j.done / j.total) * 100) : null;
  const act = running(j);
  const sub =
    j.status === "downloading"
      ? [
          j.site,
          j.quality,
          j.audio ? "เสียง" : null,
          pct != null && `${pct.toFixed(0)}%`,
          j.speed && `${bytes(j.speed)}/s`,
          j.eta != null && `เหลือ ${clock(j.eta)}`,
        ]
      : j.status === "processing"
        ? [j.site, j.quality, "กำลังรวมไฟล์…"]
        : j.status === "done"
          ? [j.site, j.quality]
          : j.status === "cancelled"
            ? [j.site, "ยกเลิกแล้ว"]
            : [j.error];
  return (
    <li className={`row ${j.status}`} onDoubleClick={() => j.path && revealItemInDir(j.path)}>
      {j.thumbnail ? (
        <img src={j.thumbnail} alt="" referrerPolicy="no-referrer" />
      ) : (
        <div className="thumb">
          <Icon name="film" />
        </div>
      )}
      <div className="text">
        <div className="title">{j.title}</div>
        <div className="sub">{sub.filter(Boolean).join(" · ")}</div>
        {act && (
          <div className="bar">
            <i className={pct == null || j.status === "processing" ? "busy" : ""} style={{ width: pct != null ? `${pct}%` : undefined }} />
          </div>
        )}
      </div>
      {act && (
        <button className="tool" title="ยกเลิก" onClick={() => invoke("cancel", { id: j.id })}>
          <Icon name="x" />
        </button>
      )}
      {failed(j) && j.format && (
        <button className="tool" title="ลองใหม่" onClick={onRetry}>
          <Icon name="retry" />
        </button>
      )}
      {j.status === "done" && j.path && (
        <button className="tool" title="แสดงใน Finder" onClick={() => revealItemInDir(j.path!)}>
          <Icon name="reveal" />
        </button>
      )}
    </li>
  );
}
