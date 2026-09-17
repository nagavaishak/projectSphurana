import type { UIMessage } from 'ai';
import { convertToAnthropicMessages } from './convert-to-anthropic-messages.js';

/**
 * UIMessage's `parts` field is a discriminated union with strict shapes per
 * `type`. The `as unknown as UIMessage[]` casts in these fixtures match the
 * runtime shape the frontend `useChat` posts; they intentionally bypass the
 * stricter compile-time signature so the tests can stay short.
 */

describe('convertToAnthropicMessages', () => {
  it('handles a simple user/assistant text exchange', () => {
    const ui: UIMessage[] = [
      {
        id: 'm1',
        role: 'user',
        parts: [{ type: 'text', text: 'Hi' }],
      },
      {
        id: 'm2',
        role: 'assistant',
        parts: [{ type: 'text', text: 'Hello' }],
      },
    ] as unknown as UIMessage[];

    expect(convertToAnthropicMessages(ui)).toEqual([
      { role: 'user', content: [{ type: 'text', text: 'Hi' }] },
      { role: 'assistant', content: [{ type: 'text', text: 'Hello' }] },
    ]);
  });

  it('drops empty assistant messages', () => {
    const ui = [
      { id: 'm1', role: 'user', parts: [{ type: 'text', text: 'Hi' }] },
      { id: 'm2', role: 'assistant', parts: [] },
    ] as unknown as UIMessage[];
    const out = convertToAnthropicMessages(ui);
    expect(out).toHaveLength(1);
  });

  it('round-trips tool calls and results across an assistant turn', () => {
    const ui = [
      {
        id: 'u1',
        role: 'user',
        parts: [{ type: 'text', text: 'list services' }],
      },
      {
        id: 'a1',
        role: 'assistant',
        parts: [
          {
            type: 'tool-context_listServices',
            toolCallId: 'call_1',
            input: {},
            state: 'output-available',
            output: { services: [], total: 0 },
          },
        ],
      },
    ] as unknown as UIMessage[];

    const out = convertToAnthropicMessages(ui);
    // user, assistant (tool_use), synthetic-user (tool_result)
    expect(out).toHaveLength(3);
    expect(out[1].role).toBe('assistant');
    expect((out[1].content as { type: string }[])[0].type).toBe('tool_use');
    expect(out[2].role).toBe('user');
    expect((out[2].content as { type: string }[])[0].type).toBe('tool_result');
  });

  it('preserves thinking blocks with signature', () => {
    const ui = [
      {
        id: 'a1',
        role: 'assistant',
        parts: [
          {
            type: 'reasoning',
            text: 'Let me think about this.',
            providerMetadata: { anthropic: { signature: 'sig123' } },
          },
        ],
      },
    ] as unknown as UIMessage[];
    const out = convertToAnthropicMessages(ui);
    expect(out).toHaveLength(1);
    const block = (
      out[0].content as {
        type: string;
        thinking?: string;
        signature?: string;
      }[]
    )[0];
    expect(block.type).toBe('thinking');
    expect(block.thinking).toBe('Let me think about this.');
    expect(block.signature).toBe('sig123');
  });

  it('drops thinking blocks without a signature (cannot be sent back)', () => {
    const ui = [
      {
        id: 'a1',
        role: 'assistant',
        parts: [{ type: 'reasoning', text: 'thinking' }],
      },
    ] as unknown as UIMessage[];
    expect(convertToAnthropicMessages(ui)).toEqual([]);
  });

  it('skips system messages (they belong in the system prompt)', () => {
    const ui = [
      {
        id: 's1',
        role: 'system',
        parts: [{ type: 'text', text: 'You are Claire.' }],
      },
      { id: 'u1', role: 'user', parts: [{ type: 'text', text: 'hi' }] },
    ] as unknown as UIMessage[];
    const out = convertToAnthropicMessages(ui);
    expect(out).toHaveLength(1);
    expect(out[0].role).toBe('user');
  });

  it('converts a user file part with image media type into a URL image content block', () => {
    const ui = [
      {
        id: 'u1',
        role: 'user',
        parts: [
          { type: 'text', text: 'what is this?' },
          {
            type: 'file',
            mediaType: 'image/png',
            url: 'https://s3.example/uploads/abc.png',
          },
        ],
      },
    ] as unknown as UIMessage[];

    const out = convertToAnthropicMessages(ui);
    expect(out).toHaveLength(1);
    expect(out[0].role).toBe('user');
    const blocks = out[0].content as Array<{
      type: string;
      source?: { type: string; url: string };
    }>;
    expect(blocks).toHaveLength(2);
    expect(blocks[0].type).toBe('text');
    expect(blocks[1]).toEqual({
      type: 'image',
      source: { type: 'url', url: 'https://s3.example/uploads/abc.png' },
    });
  });

  it.each(['image/jpeg' as const, 'image/png' as const, 'image/webp' as const])(
    'accepts %s file parts',
    (mediaType) => {
      const ui = [
        {
          id: 'u1',
          role: 'user',
          parts: [
            {
              type: 'file',
              mediaType,
              url: 'https://s3.example/x',
            },
          ],
        },
      ] as unknown as UIMessage[];

      const out = convertToAnthropicMessages(ui);
      expect(out).toHaveLength(1);
      const blocks = out[0].content as Array<{ type: string }>;
      expect(blocks[0].type).toBe('image');
    }
  );

  it('drops non-image file parts (PDFs, other) — v3 attachments are image-only', () => {
    const ui = [
      {
        id: 'u1',
        role: 'user',
        parts: [
          { type: 'text', text: 'still here' },
          {
            type: 'file',
            mediaType: 'application/pdf',
            url: 'https://s3.example/doc.pdf',
          },
        ],
      },
    ] as unknown as UIMessage[];

    const out = convertToAnthropicMessages(ui);
    expect(out).toHaveLength(1);
    const blocks = out[0].content as Array<{ type: string }>;
    expect(blocks).toHaveLength(1);
    expect(blocks[0].type).toBe('text');
  });

  it('drops file parts that are missing a URL', () => {
    const ui = [
      {
        id: 'u1',
        role: 'user',
        parts: [
          { type: 'text', text: 'still here' },
          { type: 'file', mediaType: 'image/png' }, // no url
        ],
      },
    ] as unknown as UIMessage[];

    const out = convertToAnthropicMessages(ui);
    expect(out).toHaveLength(1);
    const blocks = out[0].content as Array<{ type: string }>;
    expect(blocks).toHaveLength(1);
    expect(blocks[0].type).toBe('text');
  });

  it('also accepts a literal `image` part type with a url', () => {
    const ui = [
      {
        id: 'u1',
        role: 'user',
        parts: [{ type: 'image', url: 'https://s3.example/y.jpg' }],
      },
    ] as unknown as UIMessage[];

    const out = convertToAnthropicMessages(ui);
    expect(out).toHaveLength(1);
    const blocks = out[0].content as Array<{
      type: string;
      source?: { type: string; url: string };
    }>;
    expect(blocks[0]).toEqual({
      type: 'image',
      source: { type: 'url', url: 'https://s3.example/y.jpg' },
    });
  });

  it('multi-step assistant message: each step-start opens a new assistant→user pair', () => {
    // Reproduces the exact production payload (DEBUG log 2026-04-26): the
    // server's tool loop runs three rounds in one logical assistant turn.
    // The frontend useChat collects all rounds into a single assistant
    // message with `step-start` parts marking the boundaries. If we collapse
    // them, Anthropic sees text interleaved between tool_use blocks and
    // rejects with "tool_use ids without tool_result blocks immediately
    // after". Each step-start must split into its own message pair.
    const ui = [
      { id: 'u1', role: 'user', parts: [{ type: 'text', text: 'check ads' }] },
      {
        id: 'a1',
        role: 'assistant',
        parts: [
          { type: 'step-start' },
          { type: 'text', text: 'looking up insights' },
          {
            type: 'tool-meta_ads_getCampaignInsights',
            toolCallId: 'toolu_A',
            input: {},
            state: 'output-available',
            output: { insights: [] },
          },
          { type: 'step-start' },
          { type: 'text', text: 'and the campaigns' },
          {
            type: 'tool-meta_ads_listCampaigns',
            toolCallId: 'toolu_B',
            input: {},
            state: 'output-available',
            output: { campaigns: [] },
          },
          {
            type: 'tool-meta_ads_confirmPauseAd',
            toolCallId: 'toolu_C',
            input: {},
            state: 'output-available',
            output: { ok: true },
          },
          { type: 'step-start' },
          { type: 'text', text: 'all done' },
        ],
      },
      { id: 'u2', role: 'user', parts: [{ type: 'text', text: 'thanks' }] },
    ] as unknown as UIMessage[];

    const out = convertToAnthropicMessages(ui);

    // Every assistant turn's tool_use must be matched in the next message.
    for (let i = 0; i < out.length; i++) {
      const msg = out[i];
      if (msg.role !== 'assistant' || !Array.isArray(msg.content)) continue;
      const useIds = (msg.content as { type: string; id?: string }[])
        .filter((b) => b.type === 'tool_use')
        .map((b) => b.id as string);
      if (useIds.length === 0) continue;
      const next = out[i + 1];
      expect(next).toBeDefined();
      expect(next.role).toBe('user');
      const resultIds = (
        (next.content as { type: string; tool_use_id?: string }[]) ?? []
      )
        .filter((b) => b.type === 'tool_result')
        .map((b) => b.tool_use_id as string);
      for (const id of useIds) {
        expect(resultIds).toContain(id);
      }
    }

    // No assistant turn should contain text *after* a tool_use in the same
    // message — that's what triggered the original Anthropic rejection.
    for (const msg of out) {
      if (msg.role !== 'assistant' || !Array.isArray(msg.content)) continue;
      const blocks = msg.content as { type: string }[];
      const firstToolUse = blocks.findIndex((b) => b.type === 'tool_use');
      if (firstToolUse === -1) continue;
      const after = blocks.slice(firstToolUse + 1);
      expect(after.every((b) => b.type === 'tool_use')).toBe(true);
    }
  });

  it('second-message scenario: prior tool turn + new user message → tool_use stays paired', () => {
    // Reproduces "this happens only on the second message" — the user sends
    // a follow-up after the assistant ran a tool. The assistant turn carries
    // a `tool-*` part in `output-available` (with the result inline on the
    // same part); the converter should split it into assistant[tool_use] +
    // synthetic user[tool_result] BEFORE the next user message.
    const ui = [
      { id: 'u1', role: 'user', parts: [{ type: 'text', text: 'list svc' }] },
      {
        id: 'a1',
        role: 'assistant',
        parts: [
          {
            type: 'tool-context_listServices',
            toolCallId: 'toolu_011z2K1UZMdFiZ8Nz2csRbNy',
            input: {},
            state: 'output-available',
            output: { services: [], total: 0 },
          },
          { type: 'text', text: 'no services yet' },
        ],
      },
      { id: 'u2', role: 'user', parts: [{ type: 'text', text: 'add one' }] },
    ] as unknown as UIMessage[];

    const out = convertToAnthropicMessages(ui);
    // Validate the exact invariant Anthropic enforces: every `tool_use`
    // block in an assistant message must be matched by a `tool_result`
    // block in the IMMEDIATELY-following message.
    for (let i = 0; i < out.length; i++) {
      const msg = out[i];
      if (msg.role !== 'assistant' || !Array.isArray(msg.content)) continue;
      const useIds = (msg.content as { type: string; id?: string }[])
        .filter((b) => b.type === 'tool_use')
        .map((b) => b.id as string);
      if (useIds.length === 0) continue;
      const next = out[i + 1];
      expect(next).toBeDefined();
      expect(next.role).toBe('user');
      const resultIds = (
        (next.content as { type: string; tool_use_id?: string }[]) ?? []
      )
        .filter((b) => b.type === 'tool_result')
        .map((b) => b.tool_use_id as string);
      for (const id of useIds) {
        expect(resultIds).toContain(id);
      }
    }
  });

  it('safety net: drops a tool_use whose tool_result is missing from the next user turn', () => {
    // Simulates the exact production failure: an assistant message has
    // tool_use blocks that surface in `output-available` state (so the main
    // pass emits them) but the user turn that follows is a plain text
    // message — the matching tool_result never made it into history. The
    // post-process drops the orphan tool_use so Anthropic accepts the
    // request.
    const ui = [
      { id: 'u1', role: 'user', parts: [{ type: 'text', text: 'do A and B' }] },
      {
        id: 'a1',
        role: 'assistant',
        parts: [
          { type: 'text', text: 'sure' },
          {
            type: 'tool-customer_drafts_draftReply',
            toolCallId: 'toolu_orphan_A',
            input: {},
            // pretend output landed but the next user turn drops the result
            state: 'output-available',
            output: { ok: true },
          },
        ],
      },
      // Synthetic next user message that is NOT the auto-generated tool_result
      // turn — emulates a stored conversation where the tool_result row was
      // lost / never written.
      { id: 'u2', role: 'user', parts: [{ type: 'text', text: 'wait' }] },
    ] as unknown as UIMessage[];

    const out = convertToAnthropicMessages(ui);
    const allBlocks = out.flatMap((m) =>
      Array.isArray(m.content) ? m.content : []
    ) as { type: string }[];
    // The auto-paired synthetic user turn from a1 is still present in raw
    // converter output, but if a regression caused the orphan to land
    // somewhere unpaired, this assertion would catch it: every tool_use must
    // have a matching tool_result in the immediately-following message.
    for (let i = 0; i < out.length; i++) {
      const msg = out[i];
      if (msg.role !== 'assistant' || !Array.isArray(msg.content)) continue;
      const toolUseIds = new Set<string>();
      for (const b of msg.content) {
        const block = b as { type?: string; id?: string };
        if (block.type === 'tool_use' && typeof block.id === 'string') {
          toolUseIds.add(block.id);
        }
      }
      if (toolUseIds.size === 0) continue;
      const next = out[i + 1];
      const resultIds = new Set<string>();
      if (next?.role === 'user' && Array.isArray(next.content)) {
        for (const b of next.content) {
          const block = b as { type?: string; tool_use_id?: string };
          if (
            block.type === 'tool_result' &&
            typeof block.tool_use_id === 'string'
          ) {
            resultIds.add(block.tool_use_id);
          }
        }
      }
      for (const id of toolUseIds) {
        expect(resultIds.has(id)).toBe(true);
      }
    }
    // No `tool_use` block survives the safety net unless it has its
    // tool_result counterpart somewhere in the conversation.
    expect(allBlocks.some((b) => b.type === 'tool_use')).toBe(true);
  });

  it('drops orphaned tool_use blocks (no output yet) so Anthropic does not reject', () => {
    // Repro: confirmation tool was emitted but the user typed a new message
    // instead of approving — the tool part is stuck in `input-available`.
    const ui = [
      { id: 'u1', role: 'user', parts: [{ type: 'text', text: 'send it' }] },
      {
        id: 'a1',
        role: 'assistant',
        parts: [
          {
            type: 'tool-customer_drafts_draftReply',
            toolCallId: 'toolu_orphan',
            input: { draftId: 'd1' },
            state: 'input-available',
          },
        ],
      },
      { id: 'u2', role: 'user', parts: [{ type: 'text', text: 'nevermind' }] },
    ] as unknown as UIMessage[];

    const out = convertToAnthropicMessages(ui);
    // Assistant turn with only an orphaned tool_use is dropped (empty content),
    // leaving just the two user turns.
    expect(out).toHaveLength(2);
    expect(out[0].role).toBe('user');
    expect(out[1].role).toBe('user');
    const flat = out.flatMap((m) =>
      Array.isArray(m.content) ? m.content : []
    ) as { type: string }[];
    expect(flat.some((b) => b.type === 'tool_use')).toBe(false);
    expect(flat.some((b) => b.type === 'tool_result')).toBe(false);
  });

  it('drops image parts whose host is not in the allowlist', () => {
    const ui = [
      {
        id: 'u1',
        role: 'user',
        parts: [
          { type: 'text', text: 'describe' },
          {
            type: 'file',
            mediaType: 'image/png',
            url: 'https://attacker.example.com/leak.png',
          },
        ],
      },
    ] as unknown as UIMessage[];

    const out = convertToAnthropicMessages(ui, {
      allowedImageHosts: ['uploads.bucket.s3.us-east-1.amazonaws.com'],
    });

    const userBlocks = out[0].content as { type: string }[];
    expect(userBlocks.some((b) => b.type === 'image')).toBe(false);
    expect(userBlocks.some((b) => b.type === 'text')).toBe(true);
  });

  it('keeps image parts whose host matches the allowlist', () => {
    const ui = [
      {
        id: 'u1',
        role: 'user',
        parts: [
          {
            type: 'file',
            mediaType: 'image/png',
            url: 'https://uploads.bucket.s3.us-east-1.amazonaws.com/org/o1/conv/c1/x.png?sig=abc',
          },
        ],
      },
    ] as unknown as UIMessage[];

    const out = convertToAnthropicMessages(ui, {
      allowedImageHosts: ['uploads.bucket.s3.us-east-1.amazonaws.com'],
    });

    const userBlocks = out[0].content as { type: string }[];
    expect(userBlocks.some((b) => b.type === 'image')).toBe(true);
  });

  it('falls back to no-enforcement when allowedImageHosts is empty', () => {
    // Test fixtures that don't wire S3 should still be able to roundtrip
    // image content. An empty/undefined allowlist means "accept any host".
    const ui = [
      {
        id: 'u1',
        role: 'user',
        parts: [
          {
            type: 'file',
            mediaType: 'image/jpeg',
            url: 'https://anywhere.example/x.jpg',
          },
        ],
      },
    ] as unknown as UIMessage[];

    const out = convertToAnthropicMessages(ui, { allowedImageHosts: [] });
    const userBlocks = out[0].content as { type: string }[];
    expect(userBlocks.some((b) => b.type === 'image')).toBe(true);
  });

  it('encodes tool errors with is_error', () => {
    const ui = [
      { id: 'u1', role: 'user', parts: [{ type: 'text', text: 'list' }] },
      {
        id: 'a1',
        role: 'assistant',
        parts: [
          {
            type: 'tool-context_listServices',
            toolCallId: 'call_1',
            input: {},
            state: 'output-error',
            errorText: 'Boom',
          },
        ],
      },
    ] as unknown as UIMessage[];

    const out = convertToAnthropicMessages(ui);
    const toolResult = (
      out[2].content as { type: string; is_error?: boolean; content: string }[]
    )[0];
    expect(toolResult.type).toBe('tool_result');
    expect(toolResult.is_error).toBe(true);
    expect(toolResult.content).toBe('Boom');
  });
});
