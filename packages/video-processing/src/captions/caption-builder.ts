/**
 * Caption Builder
 *
 * Converts Whisper transcription output to TikTok-style caption pages
 * for use in Remotion video compositions.
 */

import type { Caption as WhisperCaption } from '../whisper/types.js';

/**
 * Word with timing information
 */
export interface CaptionWord {
  text: string;
  startMs: number;
  endMs: number;
}

/**
 * Caption page - a group of words displayed together
 */
export interface CaptionPage {
  id: string;
  words: CaptionWord[];
  startFrame: number;
  endFrame: number;
}

export interface CaptionBuilderConfig {
  /** Frames per second */
  fps: number;
  /** Maximum words per page (default: 5) */
  maxWordsPerPage?: number;
  /** Maximum time per page in milliseconds (default: 1500) */
  maxPageDurationMs?: number;
  /** Minimum gap between pages in frames (default: 2) */
  minGapFrames?: number;
}

const DEFAULT_CONFIG = {
  maxWordsPerPage: 5,
  maxPageDurationMs: 1500,
  minGapFrames: 2,
};

/**
 * Convert milliseconds to frames
 */
function msToFrames(ms: number, fps: number): number {
  return Math.round((ms / 1000) * fps);
}

/**
 * Build TikTok-style caption pages from Whisper transcription
 *
 * Groups words into pages based on:
 * - Maximum words per page (for readability)
 * - Maximum time duration (to keep captions fresh)
 * - Natural sentence breaks (periods, commas)
 */
export function buildCaptionPages(
  whisperCaptions: WhisperCaption[],
  config: CaptionBuilderConfig
): CaptionPage[] {
  const {
    fps,
    maxWordsPerPage = DEFAULT_CONFIG.maxWordsPerPage,
    maxPageDurationMs = DEFAULT_CONFIG.maxPageDurationMs,
    minGapFrames = DEFAULT_CONFIG.minGapFrames,
  } = config;

  if (whisperCaptions.length === 0) {
    return [];
  }

  // Convert Whisper captions to words
  const words: CaptionWord[] = whisperCaptions.map((cap) => ({
    text: cap.text.trim(),
    startMs: cap.startMs,
    endMs: cap.endMs,
  }));

  const pages: CaptionPage[] = [];
  let currentPageWords: CaptionWord[] = [];
  let pageStartMs = 0;
  let pageId = 0;

  for (let i = 0; i < words.length; i++) {
    const word = words[i];
    const isFirstWord = currentPageWords.length === 0;

    if (isFirstWord) {
      pageStartMs = word.startMs;
    }

    // Check if we should start a new page
    const pageDuration = word.endMs - pageStartMs;
    const wordCount = currentPageWords.length + 1;
    const endsWithPunctuation = /[.!?]$/.test(word.text);

    const shouldBreak =
      wordCount > maxWordsPerPage ||
      pageDuration > maxPageDurationMs ||
      (endsWithPunctuation && wordCount >= 2);

    if (shouldBreak && !isFirstWord) {
      // Finalize current page
      pages.push(createPage(currentPageWords, pageId, fps, minGapFrames));
      pageId++;

      // Start new page with current word
      currentPageWords = [word];
      pageStartMs = word.startMs;
    } else {
      currentPageWords.push(word);
    }
  }

  // Add final page if there are remaining words
  if (currentPageWords.length > 0) {
    pages.push(createPage(currentPageWords, pageId, fps, minGapFrames));
  }

  return pages;
}

/**
 * Create a caption page from words
 */
function createPage(
  words: CaptionWord[],
  pageId: number,
  fps: number,
  minGapFrames: number
): CaptionPage {
  const firstWord = words[0];
  const lastWord = words[words.length - 1];

  return {
    id: `page-${pageId}`,
    words,
    // Start exactly when the first word begins (no early appearance)
    startFrame: msToFrames(firstWord.startMs, fps),
    // End with a small buffer after the last word
    endFrame: msToFrames(lastWord.endMs, fps) + minGapFrames,
  };
}

/**
 * Build simple (non-TikTok) captions from Whisper transcription
 * For backwards compatibility with the legacy caption system
 */
export function buildSimpleCaptions(
  whisperCaptions: WhisperCaption[],
  fps: number
): Array<{
  id: string;
  text: string;
  startFrame: number;
  endFrame: number;
}> {
  return whisperCaptions.map((cap, index) => ({
    id: `caption-${index}`,
    text: cap.text.trim(),
    startFrame: msToFrames(cap.startMs, fps),
    endFrame: msToFrames(cap.endMs, fps),
  }));
}

/**
 * Combine caption pages that are very close together
 * to reduce visual jumpiness
 */
export function consolidateCaptionPages(
  pages: CaptionPage[],
  maxGapMs: number,
  fps: number
): CaptionPage[] {
  if (pages.length <= 1) return pages;

  const maxGapFrames = msToFrames(maxGapMs, fps);
  const consolidated: CaptionPage[] = [];
  let current = { ...pages[0], words: [...pages[0].words] };

  for (let i = 1; i < pages.length; i++) {
    const next = pages[i];
    const gap = next.startFrame - current.endFrame;

    if (gap <= maxGapFrames && current.words.length + next.words.length <= 8) {
      // Merge pages
      current.words = [...current.words, ...next.words];
      current.endFrame = next.endFrame;
    } else {
      consolidated.push(current);
      current = { ...next, words: [...next.words] };
    }
  }

  consolidated.push(current);
  return consolidated;
}

/**
 * Align user-edited caption text to Whisper timing.
 *
 * Replaces Whisper word text with user-edited words while preserving
 * the original timing from Whisper. Handles cases where the user
 * added or removed words.
 *
 * @param whisperCaptions - Original Whisper word-level captions
 * @param editedText - User-edited full transcript text
 * @returns New caption array with edited text and aligned timing
 */
export function alignEditedCaptions(
  whisperCaptions: WhisperCaption[],
  editedText: string
): WhisperCaption[] {
  const editedWords = editedText.trim().split(/\s+/).filter(Boolean);

  if (editedWords.length === 0) return whisperCaptions;
  if (whisperCaptions.length === 0) return [];

  const totalDurationMs =
    whisperCaptions[whisperCaptions.length - 1].endMs -
    whisperCaptions[0].startMs;
  const avgWordDurationMs = totalDurationMs / whisperCaptions.length;

  return editedWords.map((word, i) => {
    if (i < whisperCaptions.length) {
      // Replace text but keep original timing
      return { ...whisperCaptions[i], text: word };
    }

    // Extra words beyond Whisper count: estimate timing from the end
    const lastCaption = whisperCaptions[whisperCaptions.length - 1];
    const extraIndex = i - whisperCaptions.length;
    const startMs = lastCaption.endMs + extraIndex * avgWordDurationMs;
    return {
      text: word,
      startMs,
      endMs: startMs + avgWordDurationMs,
    };
  });
}
