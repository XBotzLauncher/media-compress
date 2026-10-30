import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import {
  compressFile,
  compressImage,
  compressImageFile,
  compressVideo,
  compressVideoFile,
} from '../src/index.js';

const hasFfmpeg = spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' }).status === 0;

function noise(w, h) {
  const raw = Buffer.allocUnsafe(w * h * 3);
  let seed = 1;
  for (let i = 0; i < raw.length; i++) {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    raw[i] = seed & 255;
  }
  return raw;
}

async function noisyJpeg(w = 320, h = 240) {
  return sharp(noise(w, h), { raw: { width: w, height: h, channels: 3 } })
    .jpeg({ quality: 100 })
    .toBuffer();
}

test('compresses JPEG and keeps dimensions', async () => {
  const src = await noisyJpeg();
  const out = await compressImage(src, { quality: 60 });
  const meta = await sharp(out).metadata();
  assert.equal(meta.format, 'jpeg');
  assert.deepEqual([meta.width, meta.height], [320, 240]);
  assert.ok(out.length < src.length, `${out.length} should be < ${src.length}`);
});

test('caps image dimensions without enlarging', async () => {
  const src = await sharp({
    create: { width: 400, height: 200, channels: 3, background: '#336699' },
  }).jpeg().toBuffer();
  const out = await compressImage(src, { maxWidth: 100 });
  const meta = await sharp(out).metadata();
  assert.deepEqual([meta.width, meta.height], [100, 50]);
});

test('keeps alpha for PNG and flattens it for JPEG', async () => {
  const src = await sharp({
    create: {
      width: 50,
      height: 50,
      channels: 4,
      background: { r: 255, g: 0, b: 0, alpha: 0.5 },
    },
  }).png().toBuffer();

  const png = await sharp(await compressImage(src, { format: 'png' })).metadata();
  assert.equal(png.hasAlpha, true);

  const jpeg = await sharp(await compressImage(src, { format: 'jpeg' })).metadata();
  assert.equal(jpeg.hasAlpha, false);
});

test('rejects invalid options', async () => {
  const src = await noisyJpeg(64, 64);
  await assert.rejects(compressImage(src, { quality: 0 }), /quality/);
  await assert.rejects(compressImage(src, { quality: 101 }), /quality/);
  await assert.rejects(compressImage(src, { format: 'gif' }), /format/);
  await assert.rejects(compressImage(src, { maxWidth: 0 }), /maxWidth/);
  await assert.rejects(compressImage(src, null), /opts must be an object/);
});

test('writes an image file and infers format from dst', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'media-compress-test-'));
  try {
    const src = join(dir, 'in.png');
    const dst = join(dir, 'out.webp');
    await writeFile(src, await sharp({
      create: { width: 80, height: 60, channels: 3, background: '#224466' },
    }).png().toBuffer());

    const result = await compressImageFile(src, dst, { quality: 70 });
    assert.equal(result.format, 'webp');
    assert.equal(result.size, (await stat(dst)).size);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('dispatches by extension', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'media-compress-test-'));
  try {
    const src = join(dir, 'in.jpg');
    const dst = join(dir, 'out.webp');
    await writeFile(src, await noisyJpeg(120, 90));
    const result = await compressFile(src, dst, { quality: 60 });
    assert.equal(result.format, 'webp');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('compresses video to MP4', { skip: !hasFfmpeg && 'ffmpeg not installed' }, async () => {
  const dir = await mkdtemp(join(tmpdir(), 'media-compress-test-'));
  try {
    const src = join(dir, 'in.mp4');
    const generated = spawnSync('ffmpeg', [
      '-hide_banner', '-loglevel', 'error', '-y',
      '-f', 'lavfi', '-i', 'testsrc2=size=320x240:rate=25',
      '-t', '1', '-c:v', 'libx264', '-crf', '18', '-pix_fmt', 'yuv420p',
      src,
    ], { stdio: 'ignore' });
    assert.equal(generated.status, 0);

    const out = await compressVideo(src, { crf: 30 });
    assert.equal(out.subarray(4, 8).toString(), 'ftyp');

    const dst = join(dir, 'out.mp4');
    const result = await compressVideoFile(src, dst, { crf: 30 });
    assert.equal(result.size, (await stat(dst)).size);
    assert.ok(result.size > 0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
