//! Everything that talks to yt-dlp: which tools exist, what a URL offers, and running
//! downloads with progress streamed to the UI as `dl` events.

use std::collections::{BTreeMap, HashMap};
use std::io::{BufRead, BufReader, Read};
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};

use serde::Serialize;
use serde_json::Value;
use tauri::{AppHandle, Emitter, State};

use crate::shell_path::{home_dir, login_shell_path, which};

/// Running downloads by job id, so Cancel can kill the right yt-dlp.
#[derive(Default)]
pub struct Jobs(Arc<Mutex<HashMap<String, Child>>>);

#[derive(Serialize)]
pub struct Tools {
    ytdlp: Option<String>,
    ffmpeg: Option<String>,
    version: Option<String>,
}

#[derive(Serialize)]
pub struct Quality {
    id: String,
    label: String,
    detail: String,
    size: Option<f64>,
    format: String,
    audio_only: bool,
}

#[derive(Serialize)]
pub struct Info {
    title: String,
    thumbnail: Option<String>,
    uploader: Option<String>,
    duration: Option<f64>,
    site: String,
    qualities: Vec<Quality>,
    /// Tallest H.264 stream: the ceiling for "MP4 plays anywhere" mode.
    h264_max: Option<u64>,
}

#[derive(Serialize, Clone)]
#[serde(tag = "kind", rename_all = "lowercase")]
enum Ev {
    Progress { id: String, done: Option<f64>, total: Option<f64>, speed: Option<f64>, eta: Option<f64>, audio: bool },
    Processing { id: String },
    Done { id: String, path: String },
    Error { id: String, message: String },
    Cancelled { id: String },
}

const NOT_INSTALLED: &str = "ยังไม่ได้ติดตั้ง yt-dlp";

#[tauri::command]
pub async fn tools() -> Tools {
    tauri::async_runtime::spawn_blocking(|| {
        let ytdlp = which("yt-dlp");
        let version = ytdlp
            .as_ref()
            .and_then(|p| Command::new(p).arg("--version").output().ok())
            .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string());
        Tools {
            ytdlp: ytdlp.map(|p| p.to_string_lossy().into_owned()),
            ffmpeg: which("ffmpeg").map(|p| p.to_string_lossy().into_owned()),
            version,
        }
    })
    .await
    .unwrap_or(Tools { ytdlp: None, ffmpeg: None, version: None })
}

#[tauri::command]
pub fn default_dir() -> String {
    home_dir().map(|h| h.join("Downloads")).unwrap_or_default().to_string_lossy().into_owned()
}

/// yt-dlp with the user's PATH and the flags every call needs.
fn ytdlp() -> Result<Command, String> {
    let mut cmd = Command::new(which("yt-dlp").ok_or(NOT_INSTALLED)?);
    cmd.env("PATH", login_shell_path()).args(["--no-playlist", "--no-warnings"]);
    // YouTube needs a JS runtime now; yt-dlp only looks for deno unless told otherwise.
    if which("deno").is_none() {
        if let Some(node) = which("node") {
            cmd.arg("--js-runtimes").arg(format!("node:{}", node.display()));
        }
    }
    if let Some(ff) = which("ffmpeg") {
        cmd.arg("--ffmpeg-location").arg(ff);
    }
    Ok(cmd)
}

/// The one line of stderr worth showing; yt-dlp prefixes it with "ERROR:".
fn last_error(stderr: &str) -> String {
    stderr
        .lines()
        .rev()
        .find(|l| l.starts_with("ERROR:"))
        .or_else(|| stderr.lines().rev().find(|l| !l.trim().is_empty()))
        .map(|l| l.trim_start_matches("ERROR:").trim().to_string())
        .unwrap_or_else(|| "yt-dlp ทำงานไม่สำเร็จ".into())
}

#[tauri::command]
pub async fn probe(url: String, referer: Option<String>) -> Result<Info, String> {
    let mut cmd = ytdlp()?;
    with_referer(&mut cmd, referer);
    cmd.args(["-J", "--", url.trim()]);
    let out = tauri::async_runtime::spawn_blocking(move || cmd.output())
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| format!("เรียก yt-dlp ไม่สำเร็จ: {e}"))?;
    if !out.status.success() {
        return Err(last_error(&String::from_utf8_lossy(&out.stderr)));
    }
    let v: Value = serde_json::from_slice(&out.stdout).map_err(|e| format!("อ่านผลจาก yt-dlp ไม่ได้: {e}"))?;
    if v["_type"] == "playlist" {
        return Err("ลิงก์นี้เป็นเพลย์ลิสต์ ตอนนี้ยังรองรับทีละคลิป".into());
    }
    Ok(summarize(&v))
}

fn height_label(h: u64) -> String {
    match h {
        4320.. => "8K".into(),
        2160.. => "4K".into(),
        1440.. => "2K".into(),
        _ => format!("{h}p"),
    }
}

/// Collapse yt-dlp's dozens of formats into one choice per resolution plus audio-only.
fn summarize(v: &Value) -> Info {
    let formats = v["formats"].as_array().map(Vec::as_slice).unwrap_or_default();
    let size = |f: &Value| f["filesize"].as_f64().or_else(|| f["filesize_approx"].as_f64());
    let codec = |f: &Value, k: &str| f[k].as_str().unwrap_or("").to_string();

    let audio_size = formats
        .iter()
        .filter(|f| codec(f, "vcodec") == "none" && !matches!(codec(f, "acodec").as_str(), "none" | ""))
        .filter_map(size)
        .fold(None, |m: Option<f64>, s| Some(m.map_or(s, |m| m.max(s))));
    let has_audio = audio_size.is_some() || formats.iter().any(|f| !matches!(codec(f, "acodec").as_str(), "none" | ""));

    // height → (best fps, biggest file) across every video format at that height.
    let mut heights: BTreeMap<u64, (f64, Option<f64>)> = BTreeMap::new();
    for f in formats.iter().filter(|f| codec(f, "vcodec") != "none") {
        let Some(h) = f["height"].as_u64().filter(|h| *h > 0) else { continue };
        let e = heights.entry(h).or_insert((0.0, None));
        e.0 = e.0.max(f["fps"].as_f64().unwrap_or(0.0));
        if let Some(s) = size(f) {
            e.1 = Some(e.1.map_or(s, |m: f64| m.max(s)));
        }
    }
    let h264_max = formats
        .iter()
        .filter(|f| codec(f, "vcodec").starts_with("avc1") || codec(f, "vcodec").starts_with("h264"))
        .filter_map(|f| f["height"].as_u64())
        .max();
    let with_audio = |s: Option<f64>| s.map(|s| s + audio_size.unwrap_or(0.0));
    let detail = |h: u64, fps: f64| if fps > 0.0 { format!("{h}p · {fps:.0}fps") } else { format!("{h}p") };

    let mut qualities = Vec::new();
    let top = heights.iter().next_back();
    qualities.push(Quality {
        id: "best".into(),
        label: "ชัดที่สุด".into(),
        detail: top.map(|(h, (fps, _))| detail(*h, *fps)).unwrap_or_else(|| "ต้นฉบับ".into()),
        size: top.and_then(|(_, (_, s))| with_audio(*s)),
        format: "bv*+ba/b".into(),
        audio_only: false,
    });
    for (h, (fps, s)) in heights.iter().rev() {
        qualities.push(Quality {
            id: format!("h{h}"),
            label: height_label(*h),
            detail: detail(*h, *fps),
            size: with_audio(*s),
            format: format!("bv*[height<={h}]+ba/b[height<={h}]"),
            audio_only: false,
        });
    }
    if has_audio {
        qualities.push(Quality {
            id: "audio".into(),
            label: "เสียงอย่างเดียว".into(),
            detail: "MP3".into(),
            size: audio_size,
            format: "ba/b".into(),
            audio_only: true,
        });
    }

    Info {
        title: v["title"].as_str().unwrap_or("ไม่มีชื่อ").into(),
        thumbnail: v["thumbnail"].as_str().map(Into::into),
        uploader: v["uploader"].as_str().or_else(|| v["channel"].as_str()).map(Into::into),
        duration: v["duration"].as_f64(),
        site: v["extractor_key"].as_str().unwrap_or("Web").into(),
        qualities,
        h264_max,
    }
}

fn with_referer(cmd: &mut Command, referer: Option<String>) {
    if let Some(r) = referer.filter(|r| r.starts_with("http")) {
        cmd.arg("--referer").arg(r);
    }
}

/// A page title as a yt-dlp output template: no path separators, `%` escaped, not too long.
fn name_template(name: &str) -> String {
    let clean: String = name
        .chars()
        .map(|c| if matches!(c, '/' | ':' | '\\') || c.is_control() { ' ' } else { c })
        .take(150)
        .collect();
    format!("{}.%(ext)s", clean.trim().replace('%', "%%"))
}

fn num(s: Option<&str>) -> Option<f64> {
    s.and_then(|s| s.parse().ok())
}

#[tauri::command]
pub fn start(
    app: AppHandle,
    jobs: State<'_, Jobs>,
    id: String,
    url: String,
    format: String,
    audio_only: bool,
    compat: bool,
    dir: String,
    referer: Option<String>,
    name: Option<String>,
) -> Result<(), String> {
    let mut cmd = ytdlp()?;
    with_referer(&mut cmd, referer);
    let output = match name.as_deref().map(str::trim).filter(|n| !n.is_empty()) {
        Some(n) => name_template(n),
        None => "%(title).150B [%(id)s].%(ext)s".into(),
    };
    cmd.args(["--newline", "--no-simulate", "--progress", "--no-quiet", "-f", &format])
        .arg("-P")
        .arg(PathBuf::from(&dir))
        .arg("-o")
        .arg(output)
        .args([
            "--progress-template",
            "download:SLP|%(progress.downloaded_bytes)s|%(progress.total_bytes)s|%(progress.total_bytes_estimate)s|%(progress.speed)s|%(progress.eta)s|%(info.vcodec)s",
            "--print",
            "after_move:SLDONE|%(filepath)s",
        ]);
    if audio_only {
        cmd.args(["-x", "--audio-format", "mp3", "--audio-quality", "0"]);
    } else if compat {
        // H.264 + AAC in MP4 plays in QuickTime, iPhone, TVs; codec outranks resolution here.
        cmd.args(["-S", "vcodec:h264,res,acodec:aac", "--merge-output-format", "mp4", "--remux-video", "mp4"]);
    }
    cmd.args(["--", url.trim()]).stdout(Stdio::piped()).stderr(Stdio::piped());

    let mut child = cmd.spawn().map_err(|e| format!("เรียก yt-dlp ไม่สำเร็จ: {e}"))?;
    let stdout = child.stdout.take().ok_or("อ่าน output ของ yt-dlp ไม่ได้")?;
    let mut stderr = child.stderr.take().ok_or("อ่าน output ของ yt-dlp ไม่ได้")?;
    jobs.0.lock().unwrap().insert(id.clone(), child);
    let jobs = jobs.0.clone();

    std::thread::spawn(move || {
        let err_reader = std::thread::spawn(move || {
            let mut s = String::new();
            let _ = stderr.read_to_string(&mut s);
            s
        });
        let send = |ev: Ev| {
            let _ = app.emit("dl", ev);
        };
        let mut path = None;
        for line in BufReader::new(stdout).lines().map_while(Result::ok) {
            if let Some(rest) = line.strip_prefix("SLP|") {
                let p: Vec<&str> = rest.split('|').collect();
                send(Ev::Progress {
                    id: id.clone(),
                    done: num(p.first().copied()),
                    total: num(p.get(1).copied()).or_else(|| num(p.get(2).copied())),
                    speed: num(p.get(3).copied()),
                    eta: num(p.get(4).copied()),
                    audio: p.get(5) == Some(&"none"),
                });
            } else if let Some(p) = line.strip_prefix("SLDONE|") {
                path = Some(p.to_string());
            } else if line.starts_with("[Merger]") || line.starts_with("[ExtractAudio]") || line.starts_with("[FixupM3u8]") {
                send(Ev::Processing { id: id.clone() });
            }
        }
        let stderr = err_reader.join().unwrap_or_default();
        // Cancel already took the child out of the map; nothing left to report but that.
        let Some(mut child) = jobs.lock().unwrap().remove(&id) else {
            return send(Ev::Cancelled { id });
        };
        let ok = child.wait().map(|s| s.success()).unwrap_or(false);
        send(match (ok, path) {
            (true, Some(path)) => Ev::Done { id, path },
            _ => Ev::Error { id, message: last_error(&stderr) },
        });
    });
    Ok(())
}

#[tauri::command]
pub fn cancel(jobs: State<'_, Jobs>, id: String) {
    // ponytail: leaves yt-dlp's .part files behind; yt-dlp resumes them if the same file is retried.
    if let Some(mut child) = jobs.0.lock().unwrap().remove(&id) {
        let _ = child.kill();
        let _ = child.wait();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn summarize_groups_by_height_and_adds_audio() {
        let v = json!({
            "title": "t", "extractor_key": "Youtube",
            "formats": [
                {"vcodec": "none", "acodec": "mp4a", "filesize": 100.0},
                {"vcodec": "avc1", "acodec": "none", "height": 1080, "fps": 30.0, "filesize": 1000.0},
                {"vcodec": "vp9", "acodec": "none", "height": 1080, "fps": 60.0, "filesize_approx": 1500.0},
                {"vcodec": "avc1", "acodec": "none", "height": 2160, "fps": 60.0, "filesize": 5000.0},
            ]
        });
        let i = summarize(&v);
        let ids: Vec<_> = i.qualities.iter().map(|q| q.id.as_str()).collect();
        assert_eq!(ids, ["best", "h2160", "h1080", "audio"]);
        assert_eq!(i.qualities[0].size, Some(5100.0));
        assert_eq!(i.qualities[1].label, "4K");
        assert_eq!(i.qualities[2].detail, "1080p · 60fps");
        assert_eq!(i.qualities[2].size, Some(1600.0));
        assert_eq!(i.h264_max, Some(2160));
    }

    #[test]
    fn direct_file_with_no_metadata_still_offers_best() {
        let i = summarize(&json!({"formats": [{"url": "x"}]}));
        assert_eq!(i.qualities.len(), 1);
        assert_eq!(i.qualities[0].format, "bv*+ba/b");
    }

    #[test]
    fn name_template_is_safe() {
        assert_eq!(name_template("a/b: 100% c"), "a b  100%% c.%(ext)s");
    }

    #[test]
    fn last_error_prefers_error_line() {
        assert_eq!(last_error("WARNING: a\nERROR: boom\nmore"), "boom");
    }
}
