#!/usr/bin/env node
import { rm, stat } from 'node:fs/promises';
import { basename, extname, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { compressFile } from './src/index.js';

const IMAGE_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp']);
const VIDEO_EXT = new Set(['.mp4', '.mkv', '.mov', '.avi', '.webm', '.m4v', '.3gp', '.ts']);

function human(n) {
  const units = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i++;
  }
  return `${i === 0 ? n.toFixed(0) : n.toFixed(1)}${units[i]}`;
}

function usage() {
  console.log(`Usage: media-compress [options] <file...>

Options:
  -q, --quality <1-100>     Image quality (default 80)
      --format <fmt>        auto | jpeg | png | webp (default auto)
      --max-width <px>      Resize images to this width cap
      --max-height <px>     Resize images to this height cap
      --crf <0-51>          Video quality (default 28)
      --preset <name>       x264 preset (default veryfast)
      --audio-bitrate <b>   AAC bitrate (default 128k)
      --ffmpeg-path <path>  Custom ffmpeg binary
  -o, --out-dir <dir>       Output directory (default compressed)
  -h, --help`);
}

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    quality: { type: 'string', short: 'q', default: '80' },
    format: { type: 'string', default: 'auto' },
    'max-width': { type: 'string' },
    'max-height': { type: 'string' },
    crf: { type: 'string', default: '28' },
    preset: { type: 'string', default: 'veryfast' },
    'audio-bitrate': { type: 'string', default: '128k' },
    'ffmpeg-path': { type: 'string' },
    'out-dir': { type: 'string', short: 'o', default: 'compressed' },
    help: { type: 'boolean', short: 'h' },
  },
});

if (values.help) {
  usage();
  process.exit(0);
}
if (positionals.length === 0) {
  usage();
  process.exit(1);
}

const outDir = values['out-dir'];
const imageOpts = {
  quality: Number(values.quality),
  format: values.format,
  maxWidth: values['max-width'] === undefined ? undefined : Number(values['max-width']),
  maxHeight: values['max-height'] === undefined ? undefined : Number(values['max-height']),
};
const videoOpts = {
  crf: Number(values.crf),
  preset: values.preset,
  audioBitrate: values['audio-bitrate'],
  ffmpegPath: values['ffmpeg-path'],
};

let done = 0;
let skipped = 0;
let failed = 0;

for (const src of positionals) {
  const ext = extname(src).toLowerCase();
  const isVideo = VIDEO_EXT.has(ext);
  const isImage = IMAGE_EXT.has(ext);
  if (!isVideo && !isImage) {
    console.error(`skip ${src}: unsupported file type`);
    skipped++;
    continue;
  }

  const name = basename(src, ext);
  const outExt = isVideo
    ? '.mp4'
    : values.format === 'auto'
      ? ext
      : values.format === 'jpeg' ? '.jpg' : `.${values.format}`;
  let dst = join(outDir, `${name}${outExt}`);
  if (resolve(dst) === resolve(src)) dst = join(outDir, `${name}.compressed${outExt}`);

  try {
    const before = (await stat(src)).size;
    const result = await compressFile(src, dst, isVideo ? videoOpts : imageOpts);
    if (result.size >= before) {
      await rm(dst, { force: true });
      console.log(`skip ${src}: result is not smaller`);
      skipped++;
      continue;
    }
    const saved = 100 * (1 - result.size / before);
    console.log(`${src} -> ${dst}  ${human(before)} -> ${human(result.size)} (${saved.toFixed(0)}% smaller)`);
    done++;
  } catch (err) {
    await rm(dst, { force: true });
    console.error(`error ${src}: ${err.message}`);
    failed++;
  }
}

console.log(`\n${done} compressed, ${skipped} skipped, ${failed} failed`);
if (failed) process.exitCode = 1;
