//! Tiny loopback endpoint the browser extension posts links to. Chrome won't reliably let an
//! extension launch a custom URL scheme, but a fetch to 127.0.0.1 always works and tells it
//! whether the app got the link.

use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::time::Duration;

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};

pub const PORT: u16 = 47821;

/// What the extension hands over: the URL, plus for sniffed media the page it played on
/// (sites refuse the file without it) and that page's title (a sniffed stream has none).
#[derive(Serialize, Clone, Debug, PartialEq)]
pub struct Incoming {
    url: String,
    referer: Option<String>,
    title: Option<String>,
    thumbnail: Option<String>,
}

pub fn serve(app: AppHandle) {
    std::thread::spawn(move || {
        // Port taken (second copy of the app, say): the deep link still works, so just skip.
        let Ok(listener) = TcpListener::bind(("127.0.0.1", PORT)) else { return };
        for stream in listener.incoming().flatten() {
            handle(&app, stream);
        }
    });
}

fn handle(app: &AppHandle, mut s: TcpStream) {
    let _ = s.set_read_timeout(Some(Duration::from_secs(2)));
    // ponytail: one read; the request is a short URL, so it arrives in one packet in practice.
    let mut buf = [0u8; 16 * 1024];
    let n = s.read(&mut buf).unwrap_or(0);
    let status = match accept(&String::from_utf8_lossy(&buf[..n])) {
        Some(incoming) => {
            let _ = app.emit("open-url", incoming);
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.unminimize();
                let _ = w.show();
                let _ = w.set_focus();
            }
            "204 No Content"
        }
        None => "403 Forbidden",
    };
    let _ = write!(s, "HTTP/1.1 {status}\r\nContent-Length: 0\r\nConnection: close\r\n\r\n");
}

/// The URL from `POST /send`, if the request is ours. Web pages can't set the custom
/// header without a CORS preflight we never answer, so only the extension (or curl) gets in.
fn accept(req: &str) -> Option<Incoming> {
    let (head, body) = req.split_once("\r\n\r\n")?;
    let mut lines = head.lines();
    if !lines.next()?.starts_with("POST /send ") {
        return None;
    }
    if !lines.any(|l| l.split_once(':').is_some_and(|(k, v)| k.trim().eq_ignore_ascii_case("x-siriloader") && v.trim() == "1")) {
        return None;
    }
    let web = |s: &&str| s.starts_with("http://") || s.starts_with("https://");
    let mut parts = body.lines().map(str::trim);
    let url = parts.next().filter(web)?.to_string();
    let referer = parts.next().filter(web).map(str::to_string);
    let title = parts.next().filter(|t| !t.is_empty()).map(str::to_string);
    let thumbnail = parts.next().filter(web).map(str::to_string);
    Some(Incoming { url, referer, title, thumbnail })
}

#[cfg(test)]
mod tests {
    use super::{accept, Incoming};

    #[test]
    fn takes_extension_post() {
        let r = "POST /send HTTP/1.1\r\nHost: x\r\nX-SiriLoader: 1\r\n\r\nhttps://a.b/c";
        let only_url = Incoming { url: "https://a.b/c".into(), referer: None, title: None, thumbnail: None };
        assert_eq!(accept(r), Some(only_url));
        let r = "POST /send HTTP/1.1\r\nx-siriloader: 1\r\n\r\nhttps://cdn.x/m.m3u8\nhttps://site.x/v/1\nMy clip\nhttps://site.x/cover.jpg";
        let sniffed = Incoming {
            url: "https://cdn.x/m.m3u8".into(),
            referer: Some("https://site.x/v/1".into()),
            title: Some("My clip".into()),
            thumbnail: Some("https://site.x/cover.jpg".into()),
        };
        assert_eq!(accept(r), Some(sniffed));
    }

    #[test]
    fn rejects_missing_header_and_non_http() {
        assert_eq!(accept("POST /send HTTP/1.1\r\n\r\nhttps://a.b"), None);
        assert_eq!(accept("POST /send HTTP/1.1\r\nx-siriloader: 1\r\n\r\nfile:///etc/passwd"), None);
        assert_eq!(accept("GET /send HTTP/1.1\r\nx-siriloader: 1\r\n\r\nhttps://a.b"), None);
    }
}
