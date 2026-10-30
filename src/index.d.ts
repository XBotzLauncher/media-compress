import type { Metadata } from 'sharp';

export type ImageFormat = 'auto' | 'jpeg' | 'png' | 'webp';

export type X264Preset =
  | 'ultrafast'
  | 'superfast'
  | 'veryfast'
  | 'faster'
  | 'fast'
  | 'medium'
  | 'slow'
  | 'slower'
  | 'veryslow'
  | 'placebo';

export interface ImageOptions {
  /** Output format. 'auto' keeps jpeg/png/webp, otherwise falls back to jpeg. Default 'auto'. */
  format?: ImageFormat;
  /** JPEG/WebP quality, 1-100. Default 80. */
  quality?: number;
  /** Maximum width; never enlarges. */
  maxWidth?: number;
  /** Maximum height; never enlarges. */
  maxHeight?: number;
  /** Background color used when JPEG output has transparency. Default '#ffffff'. */
  background?: string;
}

export interface VideoOptions {
  /** H.264 quality, 0-51; lower is better. Default 28. */
  crf?: number;
  /** x264 speed preset. Default 'veryfast'. */
  preset?: X264Preset;
  /** AAC audio bitrate. Default '128k'. */
  audioBitrate?: string;
  /** Custom ffmpeg binary. Defaults to FFMPEG_PATH or 'ffmpeg' on PATH. */
  ffmpegPath?: string;
}

export interface ImageResult extends Metadata {
  size: number;
}

export interface VideoResult {
  size: number;
}

/** Compress an image in memory. */
export declare function compressImage(
  input: Buffer | Uint8Array | string,
  opts?: ImageOptions,
): Promise<Buffer>;

/** Compress an image file to disk. */
export declare function compressImageFile(
  src: string,
  dst: string,
  opts?: ImageOptions,
): Promise<ImageResult>;

/** Compress a video in memory. Output is always H.264/AAC MP4. */
export declare function compressVideo(
  input: Buffer | Uint8Array | string,
  opts?: VideoOptions,
): Promise<Buffer>;

/** Compress a video file to disk. dst must end with .mp4. */
export declare function compressVideoFile(
  src: string,
  dst: string,
  opts?: VideoOptions,
): Promise<VideoResult>;

/** Compress an image or video by source extension. */
export declare function compressFile(
  src: string,
  dst: string,
  opts?: ImageOptions | VideoOptions,
): Promise<ImageResult | VideoResult>;
