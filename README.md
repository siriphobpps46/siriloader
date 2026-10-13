# SiriLoader

<div align="center">

<img src="assets/logo/icon.svg" width="128" alt="SiriLoader logo" />

**Paste a link, pick a quality, get the file.** A small native macOS app for downloading video and audio, plus a Chrome extension that finds the video on pages nothing else understands.

Tauri v2 · React · Rust · yt-dlp + ffmpeg · 100% local

[ภาษาไทย →](README.th.md)

</div>

---

## Highlights

- **Any quality, up to 8K.** Every resolution the site offers, with estimated file size, or audio only as MP3.
- **"MP4 plays anywhere".** One checkbox picks H.264 + AAC so the file opens in QuickTime, on an iPhone or a TV. The app tells you when that caps the resolution (YouTube usually tops out at 1080p in H.264).
- **Live progress.** Percent, speed, time left, and a "merging" state while ffmpeg joins video and audio. Cancel, retry (resumes partial files), reveal in Finder.
- **Chrome extension, Video DownloadHelper-style.** It reads what the page's player actually loads, so it finds HLS/DASH playlists even when sites disguise them as `.txt`/`.jpg` or fetch them through a service worker. The popup lists them longest first, so the real video sits above 15-second ads, and passes the page as referer and its title as the file name.
- **Feels like a Mac app.** Unified toolbar, sidebar filters by status and source, a sheet for choosing quality, `⌘,` settings, `⌘L` to focus the link field, light / dark / follow system.

## Requirements

- macOS (Apple Silicon or Intel)
- [Homebrew](https://brew.sh) for the download tools:

  ```bash
  brew install yt-dlp ffmpeg
  ```

  ffmpeg is required: YouTube no longer serves video and audio in one file. If the app can't find either tool it says so and shows this command.
- To build: Node.js 18+ and the Rust toolchain (`rustup`)

## Install

```bash
git clone https://github.com/siriphobpps46/siriloader.git
cd siriloader
npm install
npm run install:app   # release build, copied to /Applications
```

For development with hot reload: `npm run tauri dev`.

### Chrome extension

1. Open `chrome://extensions` and turn on **Developer mode**
2. **Load unpacked** → choose the `extension/` folder
3. Pin the SiriLoader icon

On a page: play the video, then click the icon. The badge counts what was found; pick an entry, or **Send this page** for sites yt-dlp already knows (YouTube, X, TikTok, Instagram…). Right-click works too: *Send this link / video to SiriLoader*.

The extension asks for access to all sites because it has to see which files each page loads.

## How it works

```
Chrome extension ──POST 127.0.0.1:47821──▶ SiriLoader app ──▶ yt-dlp (+ ffmpeg) ──▶ ~/Downloads
                 └─ siriloader:// deep link (launches the app when it's closed)
```

- The app is a Tauri window; Rust runs `yt-dlp` directly and streams its progress to the UI. No Python server, no background service.
- The extension hands links over a loopback endpoint that only accepts requests carrying a custom header, which web pages cannot send without a CORS preflight the app never answers. A link that arrives only fills the box and fetches the info; **nothing downloads until you press Download**.
- Everything stays on your machine. No accounts, no analytics.

## Limits

- DRM-protected services (Netflix, Disney+, Spotify…) can't be downloaded, by design.
- Playlists are one clip at a time for now.
- Sites that need you to be logged in may refuse (browser cookies aren't passed yet).
- YouTube sometimes answers `HTTP 403`; press **Retry**.

Download only what you have the right to. Respect the site's terms and the creator's copyright.

## Project layout

```
src/                 React UI (App.tsx, icons.tsx, styles.css)
src-tauri/src/       Rust: dl.rs (yt-dlp), inbox.rs (extension endpoint), shell_path.rs
extension/           Chrome MV3 extension (hook.js sniffs playlists, popup lists them)
assets/logo/         Logo set: icon, tile, marks, wordmark, alternates/
```

`npm run icons` regenerates the app icons from `assets/logo/icon.svg`.

## License

[MIT](LICENSE)
