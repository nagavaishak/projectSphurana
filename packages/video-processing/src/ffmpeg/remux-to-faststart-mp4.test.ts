import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  classifyRemuxError,
  initFFmpeg,
  remuxToFaststartMp4,
} from './ffmpeg.service.js';

const ffmpegBin = process.env.FFMPEG_BIN || 'ffmpeg';
const hasFfmpeg = canRunFfmpeg();
const testDir = mkdtempSync(path.join(os.tmpdir(), 'remux-test-'));

describe.runIf(hasFfmpeg)('remuxToFaststartMp4', () => {
  beforeAll(async () => {
    await initFFmpeg();
  });

  afterAll(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it('remuxes a normal .mov file', async () => {
    const input = path.join(testDir, 'input.mov');
    const output = path.join(testDir, 'output.mp4');

    generateTestVideo(input, 'aac', 'mov');
    await expect(remuxToFaststartMp4(input, output)).resolves.toBe(output);
  });

  it('remuxes a normal .mts file', async () => {
    const input = path.join(testDir, 'input.mts');
    const output = path.join(testDir, 'output-from-mts.mp4');

    generateTestVideo(input, 'aac', 'mts');
    await expect(remuxToFaststartMp4(input, output)).resolves.toBe(output);
  });

  it('rejects unsupported audio codec with structured error', async () => {
    const input = path.join(testDir, 'pcm24.mov');
    const output = path.join(testDir, 'pcm24.mp4');

    generateTestVideo(input, 'pcm_s24le', 'mov');

    await expect(remuxToFaststartMp4(input, output)).rejects.toMatchObject({
      name: 'RemuxError',
      code: 'UNSUPPORTED_CODEC',
    });
  });

  it('remuxes a video with no audio stream', async () => {
    const input = path.join(testDir, 'silent.mov');
    const output = path.join(testDir, 'silent.mp4');

    generateSilentTestVideo(input);
    await expect(remuxToFaststartMp4(input, output)).resolves.toBe(output);
  });

  it('remuxes a multi-audio-track file by mapping only the first track', async () => {
    const input = path.join(testDir, 'multi-audio.mov');
    const output = path.join(testDir, 'multi-audio.mp4');

    // First audio track is copyable AAC; second is PCM (uncopyable to MP4).
    // Selective mapping (-map 0:a:0?) must succeed by dropping track two —
    // previously the whole-file codec check rejected this input.
    generateMultiAudioTestVideo(input);
    await expect(remuxToFaststartMp4(input, output)).resolves.toBe(output);
  });
});

describe('classifyRemuxError', () => {
  it('classifies disk-full stderr as DISK_SPACE', () => {
    expect(
      classifyRemuxError(
        'FFmpeg failed',
        'av_interleaved_write_frame: No space left on device'
      )
    ).toBe('DISK_SPACE');
  });

  it('classifies missing moov atom as CORRUPTED_INPUT', () => {
    expect(classifyRemuxError('FFmpeg failed', 'moov atom not found')).toBe(
      'CORRUPTED_INPUT'
    );
  });

  it('classifies "could not find tag for codec" as UNSUPPORTED_CODEC', () => {
    expect(
      classifyRemuxError(
        'FFmpeg failed',
        'Could not find tag for codec pcm_s24le in stream #1'
      )
    ).toBe('UNSUPPORTED_CODEC');
  });

  it('classifies "Decoder (codec none) not found" as UNSUPPORTED_CODEC', () => {
    expect(
      classifyRemuxError(
        'FFmpeg exited with code 1',
        'Decoder (codec none) not found for input stream #0:1'
      )
    ).toBe('UNSUPPORTED_CODEC');
  });

  it('returns UNKNOWN for unrecognized stderr (so caller falls back, not retries)', () => {
    expect(
      classifyRemuxError(
        'FFmpeg exited with code 1',
        'some new failure mode we have not seen'
      )
    ).toBe('UNKNOWN');
  });
});

describe.skipIf(hasFfmpeg)('remuxToFaststartMp4', () => {
  it('skips because ffmpeg binary is unavailable', () => {
    expect(true).toBe(true);
  });
});

function generateTestVideo(
  outputPath: string,
  audioCodec: 'aac' | 'pcm_s24le',
  container: 'mov' | 'mts'
): void {
  const args = [
    '-hide_banner',
    '-loglevel',
    'error',
    '-y',
    '-f',
    'lavfi',
    '-i',
    'testsrc=size=320x240:rate=25',
    '-f',
    'lavfi',
    '-i',
    'sine=frequency=1000:sample_rate=48000',
    '-t',
    '1',
    '-c:v',
    'libx264',
    '-pix_fmt',
    'yuv420p',
    '-c:a',
    audioCodec,
  ];

  if (container === 'mts') {
    args.push('-f', 'mpegts');
  }

  args.push(outputPath);
  execFileSync(ffmpegBin, args, { stdio: 'pipe' });
}

function generateMultiAudioTestVideo(outputPath: string): void {
  execFileSync(
    ffmpegBin,
    [
      '-hide_banner',
      '-loglevel',
      'error',
      '-y',
      '-f',
      'lavfi',
      '-i',
      'testsrc=size=320x240:rate=25',
      '-f',
      'lavfi',
      '-i',
      'sine=frequency=1000:sample_rate=48000',
      '-f',
      'lavfi',
      '-i',
      'sine=frequency=500:sample_rate=48000',
      '-t',
      '1',
      '-map',
      '0:v',
      '-map',
      '1:a',
      '-map',
      '2:a',
      '-c:v',
      'libx264',
      '-pix_fmt',
      'yuv420p',
      '-c:a:0',
      'aac',
      '-c:a:1',
      'pcm_s24le',
      outputPath,
    ],
    { stdio: 'pipe' }
  );
}

function generateSilentTestVideo(outputPath: string): void {
  execFileSync(
    ffmpegBin,
    [
      '-hide_banner',
      '-loglevel',
      'error',
      '-y',
      '-f',
      'lavfi',
      '-i',
      'testsrc=size=320x240:rate=25',
      '-t',
      '1',
      '-c:v',
      'libx264',
      '-pix_fmt',
      'yuv420p',
      '-an',
      outputPath,
    ],
    { stdio: 'pipe' }
  );
}

function canRunFfmpeg(): boolean {
  try {
    execFileSync(ffmpegBin, ['-version'], { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}
