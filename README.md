# media-compress

Server-side image and video compression for Node.js.

- Images: [sharp](https://sharp.pixelplumbing.com/) (libvips), in memory
- Video: ffmpeg + libx264, output MP4 (H.264/AAC)
- No Python, no browser WASM

## Requirements

- Node.js >= 18
- ffmpeg on `PATH` for video compression (not needed for images)

```bash
# Debian/Ubuntu
sudo apt install ffmpeg

# Alpine
apk add ffmpeg

# Termux
pkg install ffmpeg
```

If ffmpeg is somewhere else, set `FFMPEG_PATH` or pass `ffmpegPath`.

## Install

```bash
npm install
```

As a local dependency from another project:

```bash
npm install /path/to/media-compress
```

## API

```js
import {
  compressImage,
  compressImageFile,
  compressVideo,
  compressVideoFile,
  compressFile,
} from 'media-compress';

// Buffer in, Buffer out
const jpeg = await compressImage(uploadBuffer, {
  quality: 80,
  maxWidth: 1920,
  maxHeight: 1920,
});

// File in, file out
const info = await compressImageFile('photo.png', 'photo.webp', {
  format: 'webp',
  quality: 78,
});
console.log(info.width, info.height, info.size);

// Video buffer/path in, MP4 buffer out
const mp4 = await compressVideo('clip.mov', { crf: 28 });

// Video file in, file out (better for large files)
const { size } = await compressVideoFile('clip.mov', 'clip.mp4', {
  crf: 28,
  preset: 'veryfast',
});

// Dispatch by source extension
await compressFile('photo.jpg', 'photo.webp', { quality: 80 });
```

### Image options

| Option | Default | Description |
| --- | --- | --- |
| `format` | `'auto'` | `auto`, `jpeg`, `png`, or `webp` |
| `quality` | `80` | JPEG/WebP quality, 1–100 |
| `maxWidth` | — | Width cap; never enlarges |
| `maxHeight` | — | Height cap; never enlarges |
| `background` | `'#ffffff'` | JPEG background for transparent images |

`auto` keeps JPEG/PNG/WebP. Other input formats become JPEG. EXIF orientation is applied, metadata is stripped. PNG output is lossless, so `quality` only affects JPEG and WebP.

### Video options

| Option | Default | Description |
| --- | --- | --- |
| `crf` | `28` | H.264 quality, 0–51; lower is better/larger |
| `preset` | `'veryfast'` | x264 speed preset |
| `audioBitrate` | `'128k'` | AAC audio bitrate |
| `ffmpegPath` | env/PATH | Custom ffmpeg binary |

Output is always MP4 (H.264 + AAC, `yuv420p`, faststart). Metadata and chapters are stripped. Animated images, alpha video, and HDR video are not handled specially.

## Express integration

```js
import express from 'express';
import multer from 'multer';
import { compressImage, compressVideoFile } from 'media-compress';

const app = express();

const imageUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 << 20 },
});

const videoUpload = multer({
  dest: 'uploads/',
  limits: { fileSize: 500 << 20 },
});

app.post('/api/compress/image', imageUpload.single('file'), async (req, res, next) => {
  try {
    const out = await compressImage(req.file.buffer, {
      quality: 80,
      maxWidth: 1920,
    });
    res.type('image/jpeg').send(out);
  } catch (err) {
    next(err);
  }
});

app.post('/api/compress/video', videoUpload.single('file'), async (req, res, next) => {
  try {
    const dst = `${req.file.path}.mp4`;
    const { size } = await compressVideoFile(req.file.path, dst, { crf: 28 });
    res.json({ size });
  } catch (err) {
    next(err);
  }
});
```

Frontend:

```js
const body = new FormData();
body.append('file', file);

const res = await fetch('/api/compress/image', { method: 'POST', body });
const blob = await res.blob();
```

Use `compressVideoFile` for uploads on disk: `compressVideo` keeps the whole output in RAM. Limit concurrent video jobs to 1–2 per CPU-heavy worker.

## CLI

```bash
node cli.js photo.jpg video.mov -o compressed
node cli.js photo.png --format webp -q 70
node cli.js clip.mov --crf 30 --preset slow
```

## Test

```bash
npm test
```

Video tests are skipped automatically when ffmpeg is not installed.

## License

MIT
