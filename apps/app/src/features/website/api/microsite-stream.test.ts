import { describe, expect, it } from 'vitest';

import {
  consumeMicrositeStream,
  isDestructiveTool,
  parseSseFrame,
  toolSummary,
} from './microsite-stream';
import type { MicrositeStreamEvent } from './types';

function streamOf(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
}

describe('parseSseFrame', () => {
  it('decodes a data frame', () => {
    expect(parseSseFrame('data: {"type":"text","delta":"hi"}')).toEqual({
      type: 'text',
      delta: 'hi',
    });
  });

  it('joins a multi-line data frame', () => {
    expect(
      parseSseFrame('event: message\ndata: {"type":"text",\ndata: "delta":"a"}')
    ).toEqual({ type: 'text', delta: 'a' });
  });

  it('ignores the done sentinel, keep-alives and malformed JSON', () => {
    expect(parseSseFrame('data: [DONE]')).toBeNull();
    expect(parseSseFrame(': keep-alive')).toBeNull();
    expect(parseSseFrame('data: {not json')).toBeNull();
  });

  it('drops a frame with no recognised type rather than rendering it', () => {
    expect(parseSseFrame('data: {"delta":"orphan"}')).toBeNull();
  });
});

describe('consumeMicrositeStream', () => {
  it('reassembles events split across chunk boundaries', async () => {
    const events: MicrositeStreamEvent[] = [];
    await consumeMicrositeStream(
      streamOf([
        'data: {"type":"text","del',
        'ta":"Adding "}\n\ndata: {"type":"tool","name":"add_block","summary":"Added a testimonials section"}\n\n',
        'data: {"type":"done","revisionId":"rev_2","diff":{"added":1,"edited":0,"removed":0,"themeChanged":false}}\n\n',
      ]),
      (event) => events.push(event)
    );

    expect(events).toEqual([
      { type: 'text', delta: 'Adding ' },
      {
        type: 'tool',
        name: 'add_block',
        summary: 'Added a testimonials section',
      },
      {
        type: 'done',
        revisionId: 'rev_2',
        diff: { added: 1, edited: 0, removed: 0, themeChanged: false },
      },
    ]);
  });

  it('emits a trailing frame that arrives without a blank line', async () => {
    const events: MicrositeStreamEvent[] = [];
    await consumeMicrositeStream(
      streamOf(['data: {"type":"error","message":"cap","code":"tool_limit"}']),
      (event) => events.push(event)
    );
    expect(events).toEqual([
      { type: 'error', message: 'cap', code: 'tool_limit' },
    ]);
  });
});

describe('destructive tools', () => {
  it('flags the tools §3 requires confirmation for', () => {
    expect(isDestructiveTool('delete_page')).toBe(true);
    expect(isDestructiveTool('update_theme')).toBe(true);
    expect(isDestructiveTool('add_block')).toBe(false);
  });
});

describe('toolSummary', () => {
  it('prefers the server summary', () => {
    expect(toolSummary('add_block', 'Added a testimonials section')).toBe(
      'Added a testimonials section'
    );
  });

  it('falls back to a human line, never raw args', () => {
    expect(toolSummary('delete_page')).toBe('Deleted a page');
    expect(toolSummary('some_new_tool', '   ')).toBe('Worked on your website');
  });
});
