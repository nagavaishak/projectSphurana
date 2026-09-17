/**
 * Recording read/write for the eval harness.
 *
 * Recordings live as `eval/recordings/<fixture-id>.json`. Each is the on-
 * disk transcript of one fixture's run — the model's text, tool_use
 * sequences, and the simulated tool_result blocks the harness fed back.
 *
 * Format is intentionally human-readable JSON (pretty-printed) so authors
 * can inspect what the model actually said and edit synthetic recordings
 * by hand when bootstrapping a fixture before live recording is feasible.
 *
 * @see ./README.md for the full record/replay protocol.
 */

import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { HarnessRecording } from './types.js';

/**
 * Resolve the recordings directory. Inside the source tree we use
 * `<eval>/recordings/`; consumers can override via `EVAL_RECORDINGS_DIR`
 * (handy for parallel CI runs writing to a tmp dir).
 */
export function recordingsDir(): string {
  if (process.env.EVAL_RECORDINGS_DIR) {
    return resolve(process.env.EVAL_RECORDINGS_DIR);
  }
  // In source: <repo>/packages/features/src/assistant/eval/recordings/
  // After compile we'd be in dist/, but the harness only runs via tsx so
  // import.meta.url points at the source file.
  const here = dirname(fileURLToPath(import.meta.url));
  return join(here, 'recordings');
}

export function recordingPath(fixtureId: string): string {
  return join(recordingsDir(), `${fixtureId}.json`);
}

/**
 * Read a fixture's recording. Returns `null` when the file doesn't exist
 * (the runner reports it as a failure with a clear message rather than
 * crashing).
 */
export async function readRecording(
  fixtureId: string
): Promise<HarnessRecording | null> {
  const path = recordingPath(fixtureId);
  let raw: string;
  try {
    raw = await readFile(path, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(
      `Failed to parse recording at ${path}: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }
  return validateRecording(parsed, path);
}

/**
 * Write a recording. Creates the directory if missing. Pretty-prints with
 * 2-space indent so diffs in PRs are reviewable.
 */
export async function writeRecording(
  recording: HarnessRecording
): Promise<void> {
  const path = recordingPath(recording.fixtureId);
  await ensureRecordingsDir();
  const json = `${JSON.stringify(recording, null, 2)}\n`;
  await writeFile(path, json, 'utf8');
}

async function ensureRecordingsDir(): Promise<void> {
  const dir = recordingsDir();
  const { mkdir } = await import('node:fs/promises');
  await mkdir(dir, { recursive: true });
}

/**
 * Light structural validation. We don't fully type-validate every nested
 * field because TypeScript's structural assignment plus the `validate*`
 * helpers in `runner.ts` catch any nominal mismatches downstream — but
 * the version + top-level shape check fails fast on a corrupted file.
 */
function validateRecording(value: unknown, path: string): HarnessRecording {
  if (!value || typeof value !== 'object') {
    throw new Error(`Recording at ${path} must be a JSON object`);
  }
  const obj = value as Record<string, unknown>;
  if (obj.version !== 1) {
    throw new Error(
      `Recording at ${path} has unsupported version ${String(obj.version)}; expected 1`
    );
  }
  if (typeof obj.fixtureId !== 'string') {
    throw new Error(`Recording at ${path} is missing fixtureId`);
  }
  if (!Array.isArray(obj.turns)) {
    throw new Error(`Recording at ${path} is missing turns array`);
  }
  return value as HarnessRecording;
}
