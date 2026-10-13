//! A GUI app launched from the Dock inherits a bare PATH (/usr/bin:/bin:/usr/sbin:/sbin),
//! so Homebrew's yt-dlp and ffmpeg are not findable. Ask the user's
//! login shell for the PATH it would give a terminal, once, and reuse it for every spawn.

use std::path::PathBuf;
use std::process::Command;
use std::sync::OnceLock;

static PATH: OnceLock<String> = OnceLock::new();

/// PATH as the user's login shell sees it, falling back to the usual install locations.
pub fn login_shell_path() -> &'static str {
    PATH.get_or_init(|| {
        let from_shell = std::env::var("SHELL").ok().and_then(|shell| {
            let out = Command::new(&shell)
                .args(["-l", "-c", "printf %s \"$PATH\""])
                .output()
                .ok()?;
            let p = String::from_utf8_lossy(&out.stdout).trim().to_string();
            (!p.is_empty()).then_some(p)
        });

        let mut parts: Vec<String> = from_shell
            .or_else(|| std::env::var("PATH").ok())
            .unwrap_or_default()
            .split(':')
            .filter(|s| !s.is_empty())
            .map(str::to_string)
            .collect();

        // Common user install spots; harmless if already present or absent.
        if let Some(home) = home_dir() {
            let local_bin = home.join(".local/bin").to_string_lossy().into_owned();
            if !parts.contains(&local_bin) {
                parts.insert(0, local_bin);
            }
        }
        for extra in ["/opt/homebrew/bin", "/usr/local/bin"] {
            if !parts.iter().any(|p| p == extra) {
                parts.push(extra.to_string());
            }
        }
        parts.join(":")
    })
}

/// First match for `bin` on the resolved PATH, so we can spawn by absolute path.
pub fn which(bin: &str) -> Option<PathBuf> {
    login_shell_path().split(':').find_map(|dir| {
        let candidate = PathBuf::from(dir).join(bin);
        candidate.is_file().then_some(candidate)
    })
}

pub fn home_dir() -> Option<PathBuf> {
    std::env::var_os("HOME").map(PathBuf::from)
}

