import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, extname, join, resolve } from 'node:path';
import sharp from 'sharp';

const IMAGE_FORMATS = new Set(['jpeg', 'png', 'webp']);
const IMAGE_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp']);
const VIDEO_EXT = new Set(['.mp4', '.mkv', '.mov', '.avi', '.webm', '.m4v', '.3gp', '.ts']);
const PRESETS = new Set([
  'ultrafast', 'superfast', 'veryfast', 'faster', 'fast',
  'medium', 'slow', 'slower', 'veryslow', 'placebo',
]);

function assertObject(opts) {
  if (typeof opts !== 'object' || opts === null || Array.isArray(opts)) {
    throw new TypeError('opts must be an object');
  }
}

function assertInput(input) {
  if (typeof input === 'string' && input.length > 0) return;
  if (Buffer.isBuffer(input) || input instanceof Uint8Array) return;
  throw new TypeError('input must be a file path, Buffer, or Uint8Array');
}

function validateImageOptions(opts = {}) {
  assertObject(opts);
  const {
    format = 'auto',
    quality = 80,
    maxWidth,
    maxHeight,
    background = '#ffffff',
  } = opts;

  if (format !== 'auto' && !IMAGE_FORMATS.has(format)) {
    throw new RangeError('format must be auto, jpeg, png, or webp');
  }
  if (!Number.isInteger(quality) || quality < 1 || quality > 100) {
    throw new RangeError('quality must be an integer between 1 and 100');
  }
  for (const [name, value] of [['maxWidth', maxWidth], ['maxHeight', maxHeight]]) {
    if (value !== undefined && (!Number.isInteger(value) || value < 1)) {
      throw new RangeError(`${name} must be a positive integer`);
    }
  }
  if (typeof background !== 'string' || background.length === 0) {
    throw new TypeError('background must be a color string');
  }
  return { format, quality, maxWidth, maxHeight, background };
}

function validateVideoOptions(opts = {}) {
  assertObject(opts);
  const {
    crf = 28,
    preset = 'veryfast',
    audioBitrate = '128k',
    ffmpegPath,
  } = opts;

  if (!Number.isInteger(crf) || crf < 0 || crf > 51) {
    throw new RangeError('crf must be an integer between 0 and 51');
  }
  if (!PRESETS.has(preset)) {
    throw new RangeError(`preset must be one of: ${[...PRESETS].join(', ')}`);
  }
  if (typeof audioBitrate !== 'string' || audioBitrate.length === 0) {
    throw new TypeError('audioBitrate must be a non-empty string');
  }
  if (ffmpegPath !== undefined && (typeof ffmpegPath !== 'string' || ffmpegPath.length === 0)) {
    throw new TypeError('ffmpegPath must be a non-empty string');
  }
  return { crf, preset, audioBitrate, ffmpegPath };
}

function imageFormatFromPath(path) {
  const ext = extname(path).toLowerCase();
  if (ext === '.jpg' || ext === '.jpeg') return 'jpeg';
  if (ext === '.png') return 'png';
  if (ext === '.webp') return 'webp';
  return undefined;
}

/**
 * Compress an image in memory.
 *
 * @param {Buffer|Uint8Array|string} input image buffer or file path
 * @param {object} [opts]
 * @param {'auto'|'jpeg'|'png'|'webp'} [opts.format='auto']
 * @param {number} [opts.quality=80] JPEG/WebP quality, 1-100
 * @param {number} [opts.maxWidth] optional width cap
 * @param {number} [opts.maxHeight] optional height cap
 * @param {string} [opts.background='#ffffff'] JPEG background for transparency
 * @returns {Promise<Buffer>}
 */
export async function compressImage(input, opts = {}) {
  const { format, quality, maxWidth, maxHeight, background } = validateImageOptions(opts);
  assertInput(input);

  const img = sharp(input, { failOn: 'none' }).rotate();
  const meta = await img.metadata();
  if (!meta.width || !meta.height) throw new Error('unsupported image');
  if ((meta.pages ?? 1) > 1) throw new Error('animated images are not supported');

  const outFormat = format === 'auto'
    ? (IMAGE_FORMATS.has(meta.format) ? meta.format : 'jpeg')
    : format;

  if (maxWidth !== undefined || maxHeight !== undefined) {
    img.resize({
      width: maxWidth,
      height: maxHeight,
      fit: 'inside',
      withoutEnlargement: true,
    });
  }

  switch (outFormat) {
    case 'jpeg':
      return img.flatten({ background }).jpeg({
        quality,
        mozjpeg: true,
        progressive: true,
        chromaSubsampling: '4:2:0',
      }).toBuffer();
    case 'png':
      return img.png({ compressionLevel: 9, adaptiveFiltering: true }).toBuffer();
    case 'webp':
      return img.webp({ quality, effort: 6 }).toBuffer();
    default:
      throw new Error(`unsupported format: ${outFormat}`);
  }
}

/**
 * Compress an image file to disk.
 *
 * @returns {Promise<import('sharp').Metadata & { size: number }>}
 */
export async function compressImageFile(src, dst, opts = {}) {
  if (typeof src !== 'string' || typeof dst !== 'string') {
    throw new TypeError('src and dst must be file paths');
  }
  const options = validateImageOptions(opts);
  const inferred = imageFormatFromPath(dst);
  const buffer = await compressImage(src, {
    ...options,
    format: options.format === 'auto' && inferred ? inferred : options.format,
  });
  await mkdir(dirname(dst), { recursive: true });
  await writeFile(dst, buffer);
  return { ...(await sharp(buffer).metadata()), size: buffer.length };
}

function runFfmpeg(src, dst, opts) {
  const bin = opts.ffmpegPath || process.env.FFMPEG_PATH || 'ffmpeg';
  const args = [
    '-hide_banner', '-loglevel', 'error', '-nostdin', '-y',
    '-i', src,
    '-map', '0:v:0', '-map', '0:a?',
    '-map_metadata', '-1', '-map_chapters', '-1',
    '-c:v', 'libx264', '-crf', String(opts.crf), '-preset', opts.preset,
    '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', opts.audioBitrate,
    '-movflags', '+faststart',
    dst,
  ];

  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', (chunk) => {
      stderr = (stderr + chunk).slice(-8000);
    });
    child.on('error', (err) => {
      reject(new Error(`failed to run ffmpeg (${bin}): ${err.message}`));
    });
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg exited with code ${code}: ${stderr.trim()}`));
    });
  });
}

/**
 * Compress a video in memory. Output is always H.264/AAC MP4.
 *
 * @param {Buffer|Uint8Array|string} input video buffer or file path
 * @param {object} [opts]
 * @param {number} [opts.crf=28] 0-51, lower is better
 * @param {string} [opts.preset='veryfast'] x264 preset
 * @param {string} [opts.audioBitrate='128k']
 * @param {string} [opts.ffmpegPath] custom ffmpeg binary
 * @returns {Promise<Buffer>}
 */
export async function compressVideo(input, opts = {}) {
  const options = validateVideoOptions(opts);
  assertInput(input);

  const dir = await mkdtemp(join(tmpdir(), 'media-compress-'));
  try {
    let src = input;
    if (typeof input !== 'string') {
      src = join(dir, 'input');
      await writeFile(src, input);
    }
    const dst = join(dir, 'output.mp4');
    await runFfmpeg(src, dst, options);
    return await readFile(dst);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/**
 * Compress a video file to disk. Output must be an .mp4 path.
 *
 * @returns {Promise<{ size: number }>}
 */
export async function compressVideoFile(src, dst, opts = {}) {
  if (typeof src !== 'string' || typeof dst !== 'string') {
    throw new TypeError('src and dst must be file paths');
  }
  if (extname(dst).toLowerCase() !== '.mp4') {
    throw new RangeError('dst must end with .mp4');
  }
  if (resolve(src) === resolve(dst)) {
    throw new RangeError('src and dst must be different files');
  }
  const options = validateVideoOptions(opts);
  await mkdir(dirname(dst), { recursive: true });
  try {
    await runFfmpeg(src, dst, options);
  } catch (err) {
    await rm(dst, { force: true });
    throw err;
  }
  return { size: (await stat(dst)).size };
}

/** Compress an image or video by source extension. */
export async function compressFile(src, dst, opts = {}) {
  const ext = extname(src).toLowerCase();
  if (IMAGE_EXT.has(ext)) return compressImageFile(src, dst, opts);
  if (VIDEO_EXT.has(ext)) return compressVideoFile(src, dst, opts);
  throw new Error(`unsupported file type: ${ext || '(none)'}`);
}
