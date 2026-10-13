// Runs in the page's own JS world. Players often hide their playlist behind a fake name
// (.txt, .jpg, no extension) or fetch it through a service worker, both invisible to
// webRequest. So look at what fetch/XHR actually returned: an HLS playlist always starts
// with #EXTM3U, a DASH manifest has <MPD. Found ones go to relay.js via postMessage.
(() => {
  const seen = new Set();

  function report(url, text) {
    const t = text.replace(/^﻿/, "").trimStart();
    const hls = t.startsWith("#EXTM3U");
    if (!hls && !/<MPD[\s>]/.test(t.slice(0, 2048))) return;
    let abs;
    try {
      abs = new URL(url, location.href).href;
    } catch {
      return;
    }
    if (seen.has(abs) || !/^https?:/.test(abs)) return;
    seen.add(abs);

    const master = hls && t.includes("#EXT-X-STREAM-INF");
    let duration = 0;
    if (hls && !master) for (const m of t.matchAll(/#EXTINF:\s*([\d.]+)/g)) duration += Number(m[1]);
    if (!hls) duration = isoSeconds(t.match(/mediaPresentationDuration="([^"]+)"/)?.[1]);
    const heights = [...t.matchAll(/(?:RESOLUTION=\d+x|height=")(\d+)/g)].map((m) => Number(m[1]));
    window.postMessage(
      {
        __siriloader: {
          url: abs,
          kind: hls ? "HLS" : "DASH",
          master,
          duration: duration || null,
          height: heights.length ? Math.max(...heights) : null,
        },
      },
      "*",
    );
  }

  function isoSeconds(d) {
    const m = d?.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:([\d.]+)S)?/);
    return m ? (+m[1] || 0) * 3600 + (+m[2] || 0) * 60 + (+m[3] || 0) : 0;
  }

  // Only the first bytes decide; video segments are large binary, so never decode those whole.
  const looksLikeManifest = (bytes) => {
    const head = new TextDecoder().decode(bytes.subarray(0, 1024)).replace(/^﻿/, "").trimStart();
    return head.startsWith("#EXTM3U") || /<MPD[\s>]/.test(head);
  };

  const origFetch = window.fetch;
  window.fetch = async function (...args) {
    const res = await origFetch.apply(this, args);
    (async () => {
      const reader = res.clone().body?.getReader();
      if (!reader) return;
      const first = await reader.read();
      if (first.done || !looksLikeManifest(first.value)) return reader.cancel();
      const dec = new TextDecoder();
      let text = dec.decode(first.value, { stream: true });
      for (let c = await reader.read(); !c.done; c = await reader.read()) text += dec.decode(c.value, { stream: true });
      report(res.url, text);
    })().catch(() => {});
    return res;
  };

  const { open, send } = XMLHttpRequest.prototype;
  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    this.__siriloaderUrl = url;
    return open.call(this, method, url, ...rest);
  };
  XMLHttpRequest.prototype.send = function (...args) {
    this.addEventListener("load", () => {
      try {
        const url = this.responseURL || String(this.__siriloaderUrl);
        if (this.responseType === "" || this.responseType === "text") {
          if (this.responseText.length < 5e6) report(url, this.responseText);
        } else if (this.responseType === "arraybuffer" && this.response) {
          const bytes = new Uint8Array(this.response);
          if (looksLikeManifest(bytes)) report(url, new TextDecoder().decode(bytes));
        }
      } catch {}
    });
    return send.apply(this, args);
  };
})();
