# SiriLoader

<div align="center">

<img src="assets/logo/icon.svg" width="128" alt="โลโก้ SiriLoader" />

**วางลิงก์ เลือกความชัด ได้ไฟล์** แอป macOS ตัวเล็กสำหรับดาวน์โหลดวิดีโอและเสียง พร้อม extension Chrome ที่หาวิดีโอเจอแม้บนเว็บที่โปรแกรมอื่นอ่านไม่ออก

Tauri v2 · React · Rust · yt-dlp + ffmpeg · ทำงานในเครื่องทั้งหมด

[English →](README.md)

</div>

---

## จุดเด่น

- **เลือกความชัดได้ถึง 8K** มีทุกความละเอียดที่เว็บมีให้ พร้อมขนาดไฟล์โดยประมาณ หรือเลือกเอาเฉพาะเสียงเป็น MP3
- **"MP4 เปิดได้ทุกที่"** ติ๊กช่องเดียว แอปจะเลือกภาพ H.264 + เสียง AAC ให้ไฟล์เปิดได้ใน QuickTime, iPhone และทีวี ถ้าทำให้ความชัดลดลง แอปจะบอก (YouTube ส่วนใหญ่มี H.264 ถึงแค่ 1080p)
- **ความคืบหน้าแบบ real-time** บอก % ความเร็ว และเวลาที่เหลือ แสดง "กำลังรวมไฟล์" ตอน ffmpeg รวมภาพกับเสียง กดยกเลิก ลองใหม่ (โหลดต่อจากไฟล์ที่ค้างไว้) หรือเปิดใน Finder ได้
- **Extension Chrome แบบ Video DownloadHelper** ดูจากไฟล์ที่ player โหลดจริง เลยเจอ playlist แบบ HLS/DASH แม้เว็บจะปลอมนามสกุลเป็น `.txt`/`.jpg` หรือโหลดผ่าน service worker ใน popup เรียงอันที่ยาวที่สุดไว้บน วิดีโอหลักจะอยู่เหนือโฆษณา 15 วินาที และส่งหน้าเว็บไปเป็น Referer กับใช้ชื่อหน้าเว็บเป็นชื่อไฟล์
- **หน้าตาแบบแอป Mac ทั่วไป** แถบด้านบนรวมช่องลิงก์ แถบด้านข้างกรองตามสถานะและแหล่งที่มา หน้าต่าง sheet สำหรับเลือกความชัด ตั้งค่าด้วย `⌘,` ไปที่ช่องลิงก์ด้วย `⌘L` และเลือกธีม สว่าง / มืด / ตามระบบ ได้

## ดาวน์โหลด

ไม่ต้อง build เอง ใช้ได้ทั้ง Mac ชิป Apple และ Intel

1. ติดตั้งเครื่องมือดาวน์โหลดครั้งเดียว (ต้องมี [Homebrew](https://brew.sh)):

   ```bash
   brew install yt-dlp ffmpeg
   ```

2. โหลดไฟล์ **`SiriLoader_…_universal.dmg`** จาก [Releases](https://github.com/siriphobpps46/siriloader/releases/latest) แล้วลาก SiriLoader ใส่ Applications
3. **เปิดครั้งแรก:** แอปยังไม่ได้ผ่านการรับรอง (notarize) กับ Apple macOS จะไม่ยอมเปิดในครั้งแรก ให้ลองเปิดหนึ่งครั้ง แล้วไปที่ **System Settings → Privacy & Security** กด **Open Anyway** (หรือรันใน Terminal: `xattr -dr com.apple.quarantine /Applications/SiriLoader.app`)
4. **Extension Chrome:** โหลดไฟล์ **`SiriLoader-extension-….zip`** จาก release เดียวกัน แตกไฟล์ แล้วทำตามหัวข้อ [Extension Chrome](#extension-chrome) ด้านล่าง

## Build เอง

- macOS (Apple Silicon หรือ Intel)
- [Homebrew](https://brew.sh) สำหรับติดตั้งเครื่องมือดาวน์โหลด:

  ```bash
  brew install yt-dlp ffmpeg
  ```

  ต้องมี ffmpeg เพราะ YouTube ไม่ส่งภาพกับเสียงมาเป็นไฟล์เดียวแล้ว ถ้าแอปหาเครื่องมือตัวไหนไม่เจอ จะแจ้งพร้อมคำสั่งนี้ให้
- ถ้าจะ build เอง: Node.js 18 ขึ้นไป และ Rust (`rustup`)

```bash
git clone https://github.com/siriphobpps46/siriloader.git
cd siriloader
npm install
npm run install:app   # build แบบ release แล้วติดตั้งลง /Applications
```

ถ้าจะพัฒนาต่อแบบ hot reload ใช้ `npm run tauri dev`

### Extension Chrome

1. เปิด `chrome://extensions` แล้วเปิด **Developer mode**
2. กด **Load unpacked** แล้วเลือกโฟลเดอร์ที่แตกจาก zip (หรือ `extension/` ใน repo นี้)
3. ปักหมุดไอคอน SiriLoader ไว้บนแถบเครื่องมือ

วิธีใช้: เปิดหน้าเว็บ กดเล่นวิดีโอ แล้วกดไอคอน ตัวเลขบนไอคอนบอกว่าเจอกี่ไฟล์ เลือกไฟล์ที่ต้องการ หรือกด **ส่งหน้านี้** สำหรับเว็บที่ yt-dlp รู้จักอยู่แล้ว (YouTube, X, TikTok, Instagram ฯลฯ) คลิกขวาก็ได้: *ส่งลิงก์นี้ / ส่งวิดีโอนี้เข้า SiriLoader*

Extension ขอสิทธิ์เข้าถึงทุกเว็บ เพราะต้องเห็นว่าแต่ละหน้าโหลดไฟล์อะไรบ้าง

## ทำงานยังไง

```
Extension Chrome ──POST 127.0.0.1:47821──▶ แอป SiriLoader ──▶ yt-dlp (+ ffmpeg) ──▶ ~/Downloads
                 └─ deep link siriloader:// (เปิดแอปให้ถ้ายังไม่ได้เปิด)
```

- ตัวแอปเป็นหน้าต่าง Tauri ฝั่ง Rust เรียก `yt-dlp` ตรง ๆ แล้วส่งความคืบหน้าไปที่หน้าจอ ไม่มีเซิร์ฟเวอร์ Python หรือโปรแกรมรันเบื้องหลัง
- Extension ส่งลิงก์ผ่านช่องทางในเครื่อง (loopback) ที่รับเฉพาะคำขอที่มี header พิเศษ ซึ่งหน้าเว็บทั่วไปส่งไม่ได้ ลิงก์ที่ส่งเข้ามาจะแค่กรอกในช่องและดึงข้อมูลมาให้ดู **ไม่มีอะไรถูกดาวน์โหลดจนกว่าคุณจะกดดาวน์โหลดเอง**
- ทุกอย่างอยู่ในเครื่องคุณ ไม่มีบัญชี ไม่มีการเก็บสถิติ

## ข้อจำกัด

- บริการที่มี DRM (Netflix, Disney+, Spotify ฯลฯ) ดาวน์โหลดไม่ได้
- เพลย์ลิสต์ยังโหลดได้ทีละคลิป
- เว็บที่ต้องล็อกอินอาจไม่ยอมให้โหลด (ยังไม่ได้ส่ง cookies จากเบราว์เซอร์)
- YouTube บางครั้งตอบ `HTTP 403` ให้กด **ลองใหม่**

ดาวน์โหลดเฉพาะสิ่งที่คุณมีสิทธิ์ เคารพเงื่อนไขของเว็บและลิขสิทธิ์ของเจ้าของผลงาน

## โครงสร้างโปรเจกต์

```
src/                 หน้าจอ React (App.tsx, icons.tsx, styles.css)
src-tauri/src/       Rust: dl.rs (yt-dlp), inbox.rs (รับลิงก์จาก extension), shell_path.rs
extension/           Extension Chrome MV3 (hook.js จับ playlist, popup แสดงรายการ)
assets/logo/         ชุดโลโก้: icon, tile, mark, wordmark, alternates/
```

`npm run icons` สร้างไอคอนแอปใหม่จาก `assets/logo/icon.svg`

## License

[MIT](LICENSE)
