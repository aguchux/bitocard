import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * BitoCard Shop's listing videos, re-encoded on the API's own server with ffmpeg (installed in the API image): at most
 * 60 seconds, 720p H.264 and AAC in MP4, every metadata track and chapter dropped (a phone's video can carry where it
 * was filmed), with a poster frame. The original is only ever in a temporary folder, removed when done.
 */

export const maxVideoBytes = 50 * 1024 * 1024;
export const maxVideoSeconds = 60;

export type TranscodedVideo = { video: Buffer; poster: Buffer; durationMs: number; width: number; height: number };

/** Why a video was refused, shown to the seller. */
export class VideoRefused extends Error {}

export interface VideoTranscoder {
  transcode(input: Buffer): Promise<TranscodedVideo>;
}

/** What a container's first bytes say it is: MP4 and MOV (`ftyp`) or WebM (EBML). */
export function videoKind(bytes: Buffer, declared: string): 'mp4' | 'mov' | 'webm' | null {
  const type = declared.toLowerCase();
  if (bytes.length >= 12 && bytes.toString('latin1', 4, 8) === 'ftyp') {
    if (type === 'video/mp4') return 'mp4';
    if (type === 'video/quicktime') return 'mov';
  }
  if (bytes.length >= 4 && bytes.readUInt32BE(0) === 0x1a45dfa3 && type === 'video/webm') return 'webm';
  return null;
}

function run(command: string, args: string[], timeoutMs: number) {
  return new Promise<string>((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
    child.stdout.on('data', chunk => (out += chunk));
    child.stderr.on('data', chunk => (err = (err + chunk).slice(-2000)));
    child.on('error', error => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', code => {
      clearTimeout(timer);
      if (code === 0) resolve(out);
      else reject(new Error(`${command} exited with ${code}: ${err.trim().split('\n').pop() ?? ''}`));
    });
  });
}

export class FfmpegTranscoder implements VideoTranscoder {
  constructor(
    private readonly ffmpeg = process.env.FFMPEG_PATH || 'ffmpeg',
    private readonly ffprobe = process.env.FFPROBE_PATH || 'ffprobe',
  ) {}

  async transcode(input: Buffer): Promise<TranscodedVideo> {
    const dir = await mkdtemp(join(tmpdir(), 'bitocard-video-'));
    try {
      const source = join(dir, 'in');
      const output = join(dir, 'out.mp4');
      const poster = join(dir, 'poster.jpg');
      await writeFile(source, input);
      const probe = JSON.parse(await run(this.ffprobe, ['-v', 'error', '-show_entries', 'format=duration:stream=codec_type', '-of', 'json', source], 30_000)) as {
        format?: { duration?: string };
        streams?: { codec_type?: string }[];
      };
      const seconds = Number(probe.format?.duration);
      if (!probe.streams?.some(stream => stream.codec_type === 'video')) throw new VideoRefused('This file has no video in it.');
      if (!Number.isFinite(seconds) || seconds <= 0) throw new VideoRefused('This video could not be read.');
      if (seconds > maxVideoSeconds + 0.5) throw new VideoRefused(`Videos can be at most ${maxVideoSeconds} seconds long.`);
      await run(
        this.ffmpeg,
        [
          '-y', '-v', 'error', '-i', source,
          '-map', '0:v:0', '-map', '0:a:0?', '-map_metadata', '-1', '-map_chapters', '-1', '-sn', '-dn',
          '-t', String(maxVideoSeconds),
          '-vf', "scale='min(1280,iw)':'min(720,ih)':force_original_aspect_ratio=decrease,scale=trunc(iw/2)*2:trunc(ih/2)*2",
          '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '26', '-pix_fmt', 'yuv420p',
          '-c:a', 'aac', '-b:a', '96k', '-movflags', '+faststart',
          output,
        ],
        300_000,
      );
      await run(this.ffmpeg, ['-y', '-v', 'error', '-ss', String(Math.min(1, seconds / 2)), '-i', output, '-frames:v', '1', '-map_metadata', '-1', '-q:v', '4', poster], 60_000);
      const size = JSON.parse(await run(this.ffprobe, ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'json', output], 30_000)) as { streams?: { width?: number; height?: number }[] };
      return {
        video: await readFile(output),
        poster: await readFile(poster),
        durationMs: Math.round(Math.min(seconds, maxVideoSeconds) * 1000),
        width: size.streams?.[0]?.width ?? 0,
        height: size.streams?.[0]?.height ?? 0,
      };
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }
}
