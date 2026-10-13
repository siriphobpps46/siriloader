import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { getCurrent, onOpenUrl } from "@tauri-apps/plugin-deep-link";
import logo from "../assets/logo/tile.svg";

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
type Incoming = { url: string; referer?: string | null; title?: string | null; thumbnail?: string | null };
type Status = "downloading" | "processing" | "done" | "error" | "cancelled";
type Job = {
  id: string;
  url: string;
  title: string;
  thumbnail: string | null;
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

// siriloader://download?url=&referer=&title= — the extension's fallback when the app is closed.
// Like the loopback inbox, it only fills the box and probes; the user still clicks Download.
function fromDeepLink(deep: string): Incoming | null {
  try {
    const p = new URL(deep).searchParams;
    return { url: p.get("url") ?? "", referer: p.get("referer"), title: p.get("title"), thumbnail: p.get("thumbnail") };
  } catch {
    return null;
  }
}

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

export default function App() {
  const [tools, setTools] = useState<Tools | null>(null);
  const [url, setUrl] = useState("");
  const [info, setInfo] = useState<Info | null>(null);
  const [probing, setProbing] = useState(false);
  const [error, setError] = useState("");
  const [qualityId, setQualityId] = useState(() => store.get("quality", "best"));
  const [dir, setDir] = useState(() => store.get("dir", ""));
  const [compat, setCompat] = useState(() => store.get("compat", false));
  // Referer + page title that came with a sniffed link; dropped as soon as the user edits the box.
  const [source, setSource] = useState<Incoming | null>(null);
  const [jobs, setJobs] = useState<Job[]>(() =>
    store.get<Job[]>("jobs", []).map((j) =>
      j.status === "downloading" || j.status === "processing" ? { ...j, status: "cancelled" } : j,
    ),
  );
  const probeSeq = useRef(0);

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
      const src = {
        ...inc,
        referer: isWeb(inc.referer) ? inc.referer : null,
        thumbnail: isWeb(inc.thumbnail) || inc.thumbnail?.startsWith("data:image/") ? inc.thumbnail : null,
      };
      setUrl(src.url);
      setSource(src);
      probe(src.url, src);
    };
    getCurrent().then((urls) => take(urls?.[0] ? fromDeepLink(urls[0]) : null));
    const offLink = onOpenUrl((urls) => take(fromDeepLink(urls[0])));
    const offInbox = listen<Incoming>("open-url", (e) => take(e.payload));
    return () => {
      off.then((f) => f());
      offLink.then((f) => f());
      offInbox.then((f) => f());
    };
  }, []);

  useEffect(() => store.set("jobs", jobs.slice(0, 100)), [jobs]);
  useEffect(() => store.set("dir", dir), [dir]);
  useEffect(() => store.set("quality", qualityId), [qualityId]);
  useEffect(() => store.set("compat", compat), [compat]);

  async function probe(target = url, src = source) {
    if (!target.trim()) return;
    const seq = ++probeSeq.current;
    setProbing(true);
    setError("");
    setInfo(null);
    try {
      const i = await invoke<Info>("probe", { url: target, referer: src?.referer ?? null });
      // A sniffed stream is titled "master"/"index" and has no cover; the page supplies both.
      if (seq === probeSeq.current)
        setInfo({ ...i, title: src?.title || i.title, thumbnail: i.thumbnail || src?.thumbnail || null });
    } catch (e) {
      if (seq === probeSeq.current) setError(String(e));
    } finally {
      if (seq === probeSeq.current) setProbing(false);
    }
  }

  const quality = info?.qualities.find((q) => q.id === qualityId) ?? info?.qualities[0];
  const useCompat = compat && !quality?.audio_only;
  const qualityHeight = Number(quality?.detail.match(/^(\d+)p/)?.[1] ?? 0);
  // Only warn when MP4 mode will actually land below what was picked.
  const compatCap = useCompat && info?.h264_max && qualityHeight > info.h264_max ? info.h264_max : null;

  async function download() {
    if (!info || !quality) return;
    const job: Job = {
      id: crypto.randomUUID(),
      url: url.trim(),
      title: info.title,
      thumbnail: info.thumbnail,
      quality: (quality.id === "best" ? `ชัดที่สุด · ${quality.detail}` : quality.label) + (useCompat ? " · MP4" : ""),
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

  const missing = tools && (!tools.ytdlp || !tools.ffmpeg);

  return (
    <div className="app">
      <header className="bar" data-tauri-drag-region>
        <img src={logo} className="logo" alt="" data-tauri-drag-region />
        <span className="name" data-tauri-drag-region>
          <b>Siri</b>Loader
        </span>
        {tools?.version && <span className="ver">yt-dlp {tools.version}</span>}
      </header>

      <main>
        {missing && (
          <div className="notice">
            <b>ต้องติดตั้งเครื่องมืออีกนิดก่อนใช้งาน</b>
            <span>
              ยังไม่พบ {[!tools.ytdlp && "yt-dlp", !tools.ffmpeg && "ffmpeg"].filter(Boolean).join(" และ ")} — รันคำสั่งนี้ใน
              Terminal แล้วกดตรวจใหม่
            </span>
            <div className="row">
              <code>brew install yt-dlp ffmpeg</code>
              <button className="ghost" onClick={() => navigator.clipboard.writeText("brew install yt-dlp ffmpeg")}>
                คัดลอก
              </button>
              <button className="ghost" onClick={() => invoke<Tools>("tools").then(setTools)}>
                ตรวจใหม่
              </button>
            </div>
          </div>
        )}

        <section className="hero">
          <h1>วางลิงก์วิดีโอหรือเสียง</h1>
          <p>รองรับ YouTube, X, TikTok, Instagram, Facebook และเว็บอีกนับพัน</p>
          <form
            className="input"
            onSubmit={(e) => {
              e.preventDefault();
              probe();
            }}
          >
            <input
              autoFocus
              value={url}
              placeholder="https://…"
              onChange={(e) => {
                setUrl(e.target.value);
                setSource(null);
              }}
              onPaste={(e) => {
                const t = e.clipboardData.getData("text").trim();
                if (/^https?:\/\//i.test(t)) {
                  e.preventDefault();
                  setUrl(t);
                  setSource(null);
                  probe(t, null);
                }
              }}
            />
            <button className="primary" disabled={probing || !url.trim()}>
              {probing ? <span className="spin" /> : "ดึงข้อมูล"}
            </button>
          </form>
          {error && <p className="err">{error}</p>}
        </section>

        {probing && <div className="card skeleton" />}

        {info && quality && (
          <section className="card">
            <div className="meta">
              {info.thumbnail && <img src={info.thumbnail} alt="" referrerPolicy="no-referrer" />}
              <div>
                <span className="site">{info.site}</span>
                <h2>{info.title}</h2>
                <p>{[info.uploader, info.duration && clock(info.duration)].filter(Boolean).join(" · ")}</p>
              </div>
            </div>

            <div className="qualities" role="radiogroup" aria-label="ความชัด">
              {info.qualities.map((q) => (
                <button
                  key={q.id}
                  role="radio"
                  aria-checked={q.id === quality.id}
                  className={q.id === quality.id ? "q on" : "q"}
                  onClick={() => setQualityId(q.id)}
                >
                  <b>{q.label}</b>
                  <span>{q.detail}</span>
                  {q.size ? <small>~{bytes(q.size)}</small> : null}
                </button>
              ))}
            </div>

            {!quality.audio_only && (
              <label className="toggle">
                <input type="checkbox" checked={compat} onChange={(e) => setCompat(e.target.checked)} />
                <span>
                  <b>MP4 เปิดได้ทุกที่</b>
                  {compatCap
                    ? ` · คลิปนี้ได้สูงสุด ${compatCap}p (ภาพ H.264)`
                    : " · เปิดใน QuickTime, iPhone, ทีวีได้"}
                </span>
              </label>
            )}

            <div className="row end">
              <button className="folder" onClick={pickDir} title={dir}>
                บันทึกที่ <b>{dir.split("/").pop() || dir}</b>
              </button>
              <button className="primary big" onClick={download}>
                ดาวน์โหลด
              </button>
            </div>
          </section>
        )}

        {jobs.length > 0 && (
          <section className="jobs">
            <div className="row">
              <h3>รายการดาวน์โหลด</h3>
              <button
                className="ghost"
                onClick={() => setJobs((js) => js.filter((j) => j.status === "downloading" || j.status === "processing"))}
              >
                ล้างที่เสร็จแล้ว
              </button>
            </div>
            {jobs.map((j) => (
              <JobRow key={j.id} job={j} onRetry={() => run(j)} />
            ))}
          </section>
        )}
      </main>
    </div>
  );
}

function JobRow({ job: j, onRetry }: { job: Job; onRetry: () => void }) {
  const pct = j.total && j.done != null ? Math.min(100, (j.done / j.total) * 100) : null;
  const running = j.status === "downloading" || j.status === "processing";
  return (
    <div className={`job ${j.status}`}>
      {j.thumbnail ? <img src={j.thumbnail} alt="" referrerPolicy="no-referrer" /> : <div className="thumb" />}
      <div className="body">
        <div className="title">{j.title}</div>
        <div className="sub">
          {j.status === "downloading" &&
            [
              j.audio ? "เสียง" : "ภาพ",
              pct != null && `${pct.toFixed(0)}%`,
              j.speed && `${bytes(j.speed)}/s`,
              j.eta != null && `เหลือ ${clock(j.eta)}`,
              j.total && bytes(j.total),
            ]
              .filter(Boolean)
              .join(" · ")}
          {j.status === "processing" && "กำลังรวมไฟล์…"}
          {j.status === "done" && `เสร็จแล้ว · ${j.quality}`}
          {j.status === "error" && <span className="err">{j.error}</span>}
          {j.status === "cancelled" && "ยกเลิกแล้ว"}
        </div>
        {running && (
          <div className="track">
            <div className={pct == null || j.status === "processing" ? "fill busy" : "fill"} style={{ width: pct != null ? `${pct}%` : undefined }} />
          </div>
        )}
      </div>
      {running && (
        <button className="ghost" onClick={() => invoke("cancel", { id: j.id })}>
          ยกเลิก
        </button>
      )}
      {(j.status === "error" || j.status === "cancelled") && j.format && (
        <button className="ghost" onClick={onRetry}>
          ลองใหม่
        </button>
      )}
      {j.status === "done" && j.path && (
        <button className="ghost" onClick={() => revealItemInDir(j.path!)}>
          แสดงใน Finder
        </button>
      )}
    </div>
  );
}
