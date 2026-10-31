// BitoCard Shop's listing videos through real ffmpeg: re-encoded to H.264 MP4 at most 720p, metadata (a phone's filming
// position) dropped, a poster frame taken, and videos over 60 seconds refused. Skipped where ffmpeg is not installed.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, test } from 'node:test';

const ffmpeg = process.env.FFMPEG_PATH || 'ffmpeg';
const ffprobe = process.env.FFPROBE_PATH || 'ffprobe';
const available = spawnSync(ffmpeg, ['-version']).status === 0 && spawnSync(ffprobe, ['-version']).status === 0;

/** A test pattern video with sound and a location tag, as a phone would write it. */
function sample(seconds, size = '1920x1080') {
  const dir = mkdtempSync(join(tmpdir(), 'bitocard-sample-'));
  const file = join(dir, 'sample.mp4');
  const made = spawnSync(ffmpeg, [
    '-v', 'error', '-f', 'lavfi', '-i', `testsrc=duration=${seconds}:size=${size}:rate=25`, '-f', 'lavfi', '-i', `sine=duration=${seconds}`,
    '-c:v', 'libx264', '-preset', 'ultrafast', '-c:a', 'aac', '-shortest',
    '-metadata', 'location=+06.6018+003.3515/', '-metadata', 'com.apple.quicktime.location.ISO6709=+06.6018+003.3515/', '-metadata', 'title=GPSDATA-IKEJA',
    file,
  ]);
  assert.equal(made.status, 0, made.stderr?.toString());
  const bytes = readFileSync(file);
  rmSync(dir, { recursive: true, force: true });
  return bytes;
}

function probe(bytes) {
  const dir = mkdtempSync(join(tmpdir(), 'bitocard-probe-'));
  const file = join(dir, 'out.mp4');
  writeFileSync(file, bytes);
  const out = spawnSync(ffprobe, ['-v', 'error', '-show_entries', 'format=duration:format_tags:stream=codec_name,codec_type,width,height', '-of', 'json', file]);
  rmSync(dir, { recursive: true, force: true });
  return JSON.parse(out.stdout.toString());
}

describe('listing videos through ffmpeg', { skip: available ? false : 'ffmpeg is not installed here' }, () => {
  test('re-encoded to 720p H.264 and AAC, metadata dropped, with a poster', async () => {
    const { FfmpegTranscoder, videoKind } = await import('../dist/classifieds/video.js');
    const input = sample(3);
    assert.equal(videoKind(input, 'video/mp4'), 'mp4');
    const done = await new FfmpegTranscoder(ffmpeg, ffprobe).transcode(input);
    const info = probe(done.video);
    const video = info.streams.find(stream => stream.codec_type === 'video');
    assert.deepEqual([video.codec_name, video.width, video.height], ['h264', 1280, 720]);
    assert.equal(info.streams.find(stream => stream.codec_type === 'audio').codec_name, 'aac');
    const tags = JSON.stringify(info.format.tags ?? {});
    assert.ok(!/location|GPSDATA|6\.6018/i.test(tags), `no metadata left: ${tags}`);
    assert.ok(!done.video.includes(Buffer.from('GPSDATA')) && !done.video.includes(Buffer.from('+06.6018')), 'nowhere in the file');
    assert.ok(Math.abs(done.durationMs - 3000) < 200);
    assert.deepEqual([done.width, done.height], [1280, 720]);
    assert.deepEqual([...done.poster.subarray(0, 2)], [0xff, 0xd8], 'the poster is a JPEG');
  });

  test('a video over 60 seconds is refused, saying why', async () => {
    const { FfmpegTranscoder, VideoRefused } = await import('../dist/classifieds/video.js');
    await assert.rejects(new FfmpegTranscoder(ffmpeg, ffprobe).transcode(sample(62, '320x240')), error => error instanceof VideoRefused && /at most 60 seconds/.test(error.message));
  });
});
