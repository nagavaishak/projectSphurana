import { createToolCallCounter } from '../../tool-factory/tool-call-limit.js';
import type { AssistantToolsContext } from '../../tool-factory/types.js';
import { createSocialPostDraftTool } from './create-social-post-draft.tool.js';
import { deleteSocialPostDraftTool } from './delete-social-post-draft.tool.js';
import { generatePostCaptionTool } from './generate-post-caption.tool.js';
import { socialPostsTools } from './index.js';
import { listRecentPostsTool } from './list-recent-posts.tool.js';
import { publishPostNowTool } from './publish-post-now.tool.js';
import { schedulePostTool } from './schedule-post.tool.js';
import { suggestPostingTimeTool } from './suggest-posting-time.tool.js';
import { updateSocialPostDraftTool } from './update-social-post-draft.tool.js';

jest.mock('@borradh-workspace/observability', () => ({
  logError: jest.fn(),
  isPostHogInitialized: () => false,
  isSentryInitialized: () => false,
  trackEvent: jest.fn(),
  addBreadcrumb: jest.fn(),
}));

// Short-circuit the database barrel — same reason as the ads / appointments /
// leads spec files. The factory's confirmation.ts module is the only thing
// that imports `db`, and `buildCtx` overrides createConfirmation /
// verifyConfirmation so that path is never reached.
jest.mock('@borradh-workspace/database', () => ({ db: {} }));
jest.mock('@borradh-workspace/features/assistant', () => ({
  createConfirmationToken: jest.fn(),
  verifyConfirmationToken: jest.fn(),
}));

interface CtxOverrides {
  apiFetch?: AssistantToolsContext['apiFetch'];
  buildApiFetch?: AssistantToolsContext['buildApiFetch'];
  callCounter?: { count: number; max: number };
  createConfirmation?: AssistantToolsContext['createConfirmation'];
  verifyConfirmation?: AssistantToolsContext['verifyConfirmation'];
  runHardBlocks?: AssistantToolsContext['runHardBlocks'];
}

function buildCtx(overrides: CtxOverrides = {}): AssistantToolsContext {
  const apiFetch = overrides.apiFetch ?? (jest.fn() as never);
  return {
    organizationId: 'org-1',
    userId: 'user-1',
    conversationId: 'conv-1',
    apiFetch,
    buildApiFetch: overrides.buildApiFetch ?? jest.fn(() => apiFetch),
    callCounter: overrides.callCounter ?? createToolCallCounter(50),
    runHardBlocks:
      overrides.runHardBlocks ??
      (jest.fn(async () => ({ pass: true })) as never),
    createConfirmation:
      overrides.createConfirmation ??
      (jest.fn(async () => ({
        id: 'token-abc',
        expiresAt: new Date(Date.now() + 30 * 60_000),
      })) as never),
    verifyConfirmation:
      overrides.verifyConfirmation ??
      (jest.fn(async () => ({ valid: true, payload: null })) as never),
  };
}

describe('social-posts tools', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('registry', () => {
    it('exports 8 tools', () => {
      expect(socialPostsTools).toHaveLength(8);
    });

    it('every tool uses the social_posts_ name prefix and social-posts feature', () => {
      for (const tool of socialPostsTools) {
        expect(tool.name).toMatch(/^social_posts_/);
        expect(tool.feature).toBe('social-posts');
      }
    });

    it('only delete / schedule / publish are destructive (DB writes that go live)', () => {
      const expectedDestructive = new Set([
        'social_posts_deleteSocialPostDraft',
        'social_posts_schedulePost',
        'social_posts_publishPostNow',
      ]);
      for (const tool of socialPostsTools) {
        if (expectedDestructive.has(tool.name)) {
          expect(tool.destructive).toBe(true);
          // destructiveAction must be wired or defineTool throws at construction.
          expect(tool.destructiveAction).toBeDefined();
        } else {
          expect(tool.destructive).toBe(false);
          expect(tool.destructiveAction).toBeUndefined();
        }
      }
    });
  });

  describe('listRecentPostsTool', () => {
    it('GETs social-posts with no query string when no filters given', async () => {
      const apiFetch = jest.fn(async () => ({
        items: [
          {
            id: 'p1',
            title: 'Botox promo',
            caption: 'Smooth skin',
            status: 'draft',
            platforms: ['facebook'],
            mediaType: 'video',
            scheduledAt: null,
            publishedAt: null,
            createdAt: '2026-01-01T00:00:00.000Z',
          },
        ],
        total: 1,
      }));
      const result = await listRecentPostsTool.execute(
        {},
        buildCtx({ apiFetch: apiFetch as never })
      );
      expect(apiFetch).toHaveBeenCalledWith(
        'social-posts',
        expect.objectContaining({ schema: expect.anything() })
      );
      expect(result.ok).toBe(true);
      if (result.ok && result.data) {
        expect(result.data.posts).toHaveLength(1);
        expect(result.data.posts[0].id).toBe('p1');
        expect(result.data.total).toBe(1);
      }
    });

    it('appends limit + status query params when provided', async () => {
      const apiFetch = jest.fn(async () => ({ items: [], total: 0 }));
      await listRecentPostsTool.execute(
        { limit: 5, status: 'scheduled' },
        buildCtx({ apiFetch: apiFetch as never })
      );
      const calledPath = (apiFetch.mock.calls[0] as unknown[])[0] as string;
      expect(calledPath).toMatch(/^social-posts\?/);
      expect(calledPath).toContain('limit=5');
      expect(calledPath).toContain('status=scheduled');
    });

    it('rejects an out-of-range limit before calling the API', async () => {
      const apiFetch = jest.fn();
      const result = await listRecentPostsTool.execute(
        { limit: 999 } as never,
        buildCtx({ apiFetch: apiFetch as never })
      );
      expect(apiFetch).not.toHaveBeenCalled();
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe('VALIDATION_ERROR');
    });

    it('returns a sanitized tool error when apiFetch throws', async () => {
      const apiFetch = jest.fn(async () => {
        throw new Error('posts service down');
      });
      const result = await listRecentPostsTool.execute(
        {},
        buildCtx({ apiFetch: apiFetch as never })
      );
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe('TOOL_EXECUTION_ERROR');
    });
  });

  describe('generatePostCaptionTool', () => {
    it('POSTs to ai-content/generate with the resolved media type and returns caption + hashtags', async () => {
      const apiFetch = jest.fn(async () => ({
        contentType: 'social-post',
        content: {
          caption: 'Glow up with our laser facial ✨',
          hashtags: ['#skincare', '#laser'],
        },
      }));
      const result = await generatePostCaptionTool.execute(
        { videoId: 'vid-1', platform: 'instagram', serviceIds: ['svc-1'] },
        buildCtx({ apiFetch: apiFetch as never })
      );
      const [calledPath, calledOpts] = apiFetch.mock.calls[0] as [
        string,
        { method?: string; body?: Record<string, unknown> },
      ];
      expect(calledPath).toBe('ai-content/generate');
      expect(calledOpts.method).toBe('POST');
      expect(calledOpts.body).toMatchObject({
        mediaType: 'video',
        mediaId: 'vid-1',
        contentType: 'social-post',
        platform: 'instagram',
        serviceIds: ['svc-1'],
      });
      expect(result.ok).toBe(true);
      if (result.ok && result.data) {
        expect(result.data.caption).toContain('Glow up');
        expect(result.data.hashtags).toEqual(['#skincare', '#laser']);
      }
    });

    it('resolves mediaType=image when only graphicId is given', async () => {
      const apiFetch = jest.fn(async () => ({
        contentType: 'social-post',
        content: { caption: 'c', hashtags: [] },
      }));
      await generatePostCaptionTool.execute(
        { graphicId: 'gfx-1' },
        buildCtx({ apiFetch: apiFetch as never })
      );
      const body = (
        apiFetch.mock.calls[0] as [string, { body: Record<string, unknown> }]
      )[1].body;
      expect(body.mediaType).toBe('image');
      expect(body.mediaId).toBe('gfx-1');
    });

    it('soft-errors when neither videoId nor graphicId is supplied', async () => {
      const apiFetch = jest.fn();
      const result = await generatePostCaptionTool.execute(
        {},
        buildCtx({ apiFetch: apiFetch as never })
      );
      expect(apiFetch).not.toHaveBeenCalled();
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe('TOOL_EXECUTION_ERROR');
        expect(result.error).toContain('videoId or graphicId');
      }
    });

    it('soft-errors when the generator returns an unexpected content type', async () => {
      const apiFetch = jest.fn(async () => ({
        contentType: 'ad-copy',
        content: { caption: 'c', hashtags: [] },
      }));
      const result = await generatePostCaptionTool.execute(
        { videoId: 'vid-1' },
        buildCtx({ apiFetch: apiFetch as never })
      );
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toContain('Unexpected content type');
    });
  });

  describe('suggestPostingTimeTool', () => {
    it('GETs suggest-timing and passes the response through', async () => {
      const response = {
        dataSource: 'defaults',
        postsAnalyzed: 0,
        suggestions: [
          {
            timeRange: '18:00–20:00',
            reasoning: 'Industry default evening window',
          },
        ],
      };
      const apiFetch = jest.fn(async () => response);
      const result = await suggestPostingTimeTool.execute(
        {},
        buildCtx({ apiFetch: apiFetch as never })
      );
      expect(apiFetch).toHaveBeenCalledWith(
        'social-posts/suggest-timing',
        expect.objectContaining({ schema: expect.anything() })
      );
      expect(result.ok).toBe(true);
      if (result.ok && result.data) {
        expect(result.data.suggestions).toHaveLength(1);
        expect(result.data.dataSource).toBe('defaults');
      }
    });

    it('appends the platform query param when provided', async () => {
      const apiFetch = jest.fn(async () => ({
        dataSource: 'history',
        postsAnalyzed: 12,
        suggestions: [],
      }));
      await suggestPostingTimeTool.execute(
        { platform: 'facebook' },
        buildCtx({ apiFetch: apiFetch as never })
      );
      const calledPath = (apiFetch.mock.calls[0] as unknown[])[0] as string;
      expect(calledPath).toBe('social-posts/suggest-timing?platform=facebook');
    });

    it('rejects an unknown platform before calling the API', async () => {
      const apiFetch = jest.fn();
      const result = await suggestPostingTimeTool.execute(
        { platform: 'tiktok' } as never,
        buildCtx({ apiFetch: apiFetch as never })
      );
      expect(apiFetch).not.toHaveBeenCalled();
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('createSocialPostDraftTool', () => {
    it('resolves a video media URL then POSTs the draft to social-posts', async () => {
      const apiFetch = jest.fn(async (path: string) => {
        if (path === 'videos/vid-1')
          return {
            blobUrl: 'https://cdn/v.mp4',
            thumbnailUrl: 'https://cdn/v.jpg',
          };
        if (path === 'social-posts')
          return { id: 'post-1', title: 'Botox promo', status: 'draft' };
        throw new Error(`Unexpected path: ${path}`);
      });
      const result = await createSocialPostDraftTool.execute(
        {
          title: 'Botox promo',
          caption: 'Smooth skin',
          mediaType: 'video',
          videoId: 'vid-1',
          platforms: ['facebook', 'instagram'],
        },
        buildCtx({ apiFetch: apiFetch as never })
      );
      const postCall = apiFetch.mock.calls.find((c) => c[0] === 'social-posts');
      expect(postCall).toBeDefined();
      const [, opts] = postCall as [
        string,
        { method?: string; body?: Record<string, unknown> },
      ];
      expect(opts.method).toBe('POST');
      expect(opts.body).toMatchObject({
        title: 'Botox promo',
        caption: 'Smooth skin',
        mediaType: 'video',
        mediaUrl: 'https://cdn/v.mp4',
        thumbnailUrl: 'https://cdn/v.jpg',
        videoId: 'vid-1',
        platforms: ['facebook', 'instagram'],
        status: 'draft',
      });
      expect(result.ok).toBe(true);
      if (result.ok && result.data) {
        expect(result.data.postId).toBe('post-1');
        expect(result.data.status).toBe('draft');
        expect(result.data.platforms).toEqual(['facebook', 'instagram']);
      }
    });

    it('resolves a graphic media URL from the first output', async () => {
      const apiFetch = jest.fn(async (path: string) => {
        if (path === 'graphics/gfx-1')
          return { outputs: [{ url: 'https://cdn/g.png' }] };
        if (path === 'social-posts')
          return { id: 'post-2', title: 'Promo', status: 'draft' };
        throw new Error(`Unexpected path: ${path}`);
      });
      const result = await createSocialPostDraftTool.execute(
        {
          title: 'Promo',
          mediaType: 'image',
          graphicId: 'gfx-1',
          platforms: ['instagram'],
        },
        buildCtx({ apiFetch: apiFetch as never })
      );
      const postBody = (
        apiFetch.mock.calls.find((c) => c[0] === 'social-posts') as [
          string,
          { body: Record<string, unknown> },
        ]
      )[1].body;
      expect(postBody.mediaUrl).toBe('https://cdn/g.png');
      expect(result.ok).toBe(true);
    });

    it('soft-errors when the media URL cannot be resolved', async () => {
      const apiFetch = jest.fn(async (path: string) => {
        if (path === 'videos/vid-1')
          return { blobUrl: null, thumbnailUrl: null };
        throw new Error(`Unexpected path: ${path}`);
      });
      const result = await createSocialPostDraftTool.execute(
        {
          title: 'Promo',
          mediaType: 'video',
          videoId: 'vid-1',
          platforms: ['facebook'],
        },
        buildCtx({ apiFetch: apiFetch as never })
      );
      // social-posts must never be POSTed without a resolved media URL.
      expect(apiFetch.mock.calls.some((c) => c[0] === 'social-posts')).toBe(
        false
      );
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toContain('media URL');
    });

    it('rejects when platforms is empty', async () => {
      const apiFetch = jest.fn();
      const result = await createSocialPostDraftTool.execute(
        {
          title: 'Promo',
          mediaType: 'video',
          videoId: 'vid-1',
          platforms: [],
        } as never,
        buildCtx({ apiFetch: apiFetch as never })
      );
      expect(apiFetch).not.toHaveBeenCalled();
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('updateSocialPostDraftTool', () => {
    it('PUTs only the provided fields to social-posts/:id', async () => {
      const apiFetch = jest.fn(async () => ({
        id: 'post-1',
        title: 'New title',
        caption: 'New caption',
        platforms: ['facebook'],
        status: 'draft',
      }));
      const result = await updateSocialPostDraftTool.execute(
        { postId: 'post-1', caption: 'New caption', title: 'New title' },
        buildCtx({ apiFetch: apiFetch as never })
      );
      const [calledPath, calledOpts] = apiFetch.mock.calls[0] as [
        string,
        { method?: string; body?: Record<string, unknown> },
      ];
      expect(calledPath).toBe('social-posts/post-1');
      expect(calledOpts.method).toBe('PUT');
      // platforms was not supplied → must not appear in the PUT body.
      expect(calledOpts.body).toEqual({
        caption: 'New caption',
        title: 'New title',
      });
      expect(result.ok).toBe(true);
      if (result.ok && result.data) {
        expect(result.data.postId).toBe('post-1');
        expect(result.data.status).toBe('draft');
      }
    });

    it('rejects a missing postId before calling the API', async () => {
      const apiFetch = jest.fn();
      const result = await updateSocialPostDraftTool.execute(
        { caption: 'x' } as never,
        buildCtx({ apiFetch: apiFetch as never })
      );
      expect(apiFetch).not.toHaveBeenCalled();
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('deleteSocialPostDraftTool — destructive flow', () => {
    it('is registered destructive with the delete_social_post_draft action', () => {
      expect(deleteSocialPostDraftTool.destructive).toBe(true);
      expect(deleteSocialPostDraftTool.destructiveAction).toBe(
        'delete_social_post_draft'
      );
    });

    it('first call: looks up the post, builds a summary, and issues a token bound to postId', async () => {
      const apiFetch = jest.fn(async () => ({
        items: [
          {
            id: 'post-1',
            title: 'Botox promo',
            caption: 'Smooth skin',
            status: 'draft',
          },
        ],
      }));
      const createConfirmation = jest.fn(async () => ({
        id: 'tok-del',
        expiresAt: new Date(Date.now() + 30 * 60_000),
      }));
      const ctx = buildCtx({
        apiFetch: apiFetch as never,
        createConfirmation: createConfirmation as never,
      });
      const result = await deleteSocialPostDraftTool.execute(
        { postId: 'post-1' },
        ctx
      );

      // No DELETE on the first call — confirmation must be issued first.
      expect(
        apiFetch.mock.calls.some(
          (c) => (c[1] as { method?: string } | undefined)?.method === 'DELETE'
        )
      ).toBe(false);
      expect(createConfirmation).toHaveBeenCalledWith({
        action: 'delete_social_post_draft',
        resourceId: 'post-1',
        payload: expect.objectContaining({ postId: 'post-1' }),
      });
      expect(result.ok).toBe(true);
      if (result.ok && result.presentation?.type === 'confirmation_required') {
        expect(result.presentation.token).toBe('tok-del');
        expect(result.presentation.resourceId).toBe('post-1');
        const fields = result.presentation.summary?.fields ?? [];
        expect(fields.find((f) => f.label === 'Post')?.value).toBe(
          'Botox promo'
        );
        expect(fields.find((f) => f.label === 'Status')?.value).toBe('draft');
      }
    });

    it('first call: surfaces CONFIRMATION_SUMMARIZE_FAILED when the post is not found', async () => {
      const apiFetch = jest.fn(async () => ({ items: [] }));
      const createConfirmation = jest.fn();
      const result = await deleteSocialPostDraftTool.execute(
        { postId: 'missing' },
        buildCtx({
          apiFetch: apiFetch as never,
          createConfirmation: createConfirmation as never,
        })
      );
      expect(createConfirmation).not.toHaveBeenCalled();
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe('CONFIRMATION_SUMMARIZE_FAILED');
    });

    it('first call: blocks deleting a published post (non-deletable status)', async () => {
      const apiFetch = jest.fn(async () => ({
        items: [
          { id: 'post-9', title: 'Live', caption: null, status: 'published' },
        ],
      }));
      const createConfirmation = jest.fn();
      const result = await deleteSocialPostDraftTool.execute(
        { postId: 'post-9' },
        buildCtx({
          apiFetch: apiFetch as never,
          createConfirmation: createConfirmation as never,
        })
      );
      expect(createConfirmation).not.toHaveBeenCalled();
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe('CONFIRMATION_SUMMARIZE_FAILED');
    });

    it('second call: verifies the token then DELETEs social-posts/:id', async () => {
      const apiFetch = jest.fn(async () => ({}));
      const verifyConfirmation = jest.fn(async () => ({
        valid: true,
        payload: null,
      }));
      const result = await deleteSocialPostDraftTool.execute(
        { postId: 'post-1', confirmationToken: 'tok-del' },
        buildCtx({
          apiFetch: apiFetch as never,
          verifyConfirmation: verifyConfirmation as never,
        })
      );
      expect(verifyConfirmation).toHaveBeenCalled();
      const [calledPath, calledOpts] = apiFetch.mock.calls[0] as [
        string,
        { method?: string },
      ];
      expect(calledPath).toBe('social-posts/post-1');
      expect(calledOpts.method).toBe('DELETE');
      expect(result.ok).toBe(true);
      if (result.ok && result.data) expect(result.data.deleted).toBe(true);
    });

    it('second call: rejects with confirmation_expired when the token is invalid', async () => {
      const apiFetch = jest.fn();
      const verifyConfirmation = jest.fn(async () => ({
        valid: false,
        reason: 'expired' as const,
      }));
      const result = await deleteSocialPostDraftTool.execute(
        { postId: 'post-1', confirmationToken: 'stale' },
        buildCtx({
          apiFetch: apiFetch as never,
          verifyConfirmation: verifyConfirmation as never,
        })
      );
      expect(apiFetch).not.toHaveBeenCalled();
      expect(result.ok).toBe(false);
      if (!result.ok && result.presentation?.type === 'confirmation_expired') {
        expect(result.presentation.reason).toBe('expired');
      }
    });
  });

  describe('schedulePostTool — destructive flow', () => {
    const validInput = {
      postId: 'post-1',
      scheduledAt: '2026-06-01T18:00:00.000Z',
    };

    it('is registered destructive with the schedule_post action', () => {
      expect(schedulePostTool.destructive).toBe(true);
      expect(schedulePostTool.destructiveAction).toBe('schedule_post');
    });

    it('first call: summary surfaces platforms + scheduled time and binds the token to postId + scheduledAt', async () => {
      const apiFetch = jest.fn(async () => ({
        id: 'post-1',
        title: 'Botox promo',
        caption: 'Smooth skin',
        platforms: ['facebook', 'instagram'],
        status: 'draft',
      }));
      const createConfirmation = jest.fn(async () => ({
        id: 'tok-sched',
        expiresAt: new Date(Date.now() + 30 * 60_000),
      }));
      const ctx = buildCtx({
        apiFetch: apiFetch as never,
        createConfirmation: createConfirmation as never,
      });
      const result = await schedulePostTool.execute(validInput, ctx);

      // No PUT/POST on the first call — confirmation only.
      expect(
        apiFetch.mock.calls.some(
          (c) => (c[1] as { method?: string } | undefined)?.method
        )
      ).toBe(false);
      expect(createConfirmation).toHaveBeenCalledWith({
        action: 'schedule_post',
        resourceId: 'post-1',
        payload: expect.objectContaining({
          postId: 'post-1',
          scheduledAt: '2026-06-01T18:00:00.000Z',
        }),
      });
      expect(result.ok).toBe(true);
      if (result.ok && result.presentation?.type === 'confirmation_required') {
        expect(result.presentation.token).toBe('tok-sched');
        const fields = result.presentation.summary?.fields ?? [];
        expect(fields.find((f) => f.label === 'Platforms')?.value).toBe(
          'facebook, instagram'
        );
        expect(
          fields.find((f) => f.label === 'Scheduled for')?.value
        ).toBeTruthy();
      }
    });

    it('second call: PUTs the schedule then POSTs publish, returning the published status', async () => {
      const apiFetch = jest.fn(async (path: string) => {
        if (path.endsWith('/publish'))
          return { status: 'scheduled', publishedAt: null };
        return {};
      });
      const verifyConfirmation = jest.fn(async () => ({
        valid: true,
        payload: null,
      }));
      const result = await schedulePostTool.execute(
        { ...validInput, confirmationToken: 'tok-sched' },
        buildCtx({
          apiFetch: apiFetch as never,
          verifyConfirmation: verifyConfirmation as never,
        })
      );
      expect(verifyConfirmation).toHaveBeenCalled();
      const putCall = apiFetch.mock.calls.find(
        (c) => (c[1] as { method?: string } | undefined)?.method === 'PUT'
      );
      const publishCall = apiFetch.mock.calls.find((c) =>
        String(c[0]).endsWith('/publish')
      );
      expect(putCall?.[0]).toBe('social-posts/post-1');
      expect(
        (putCall?.[1] as { body?: Record<string, unknown> }).body
      ).toMatchObject({ status: 'scheduled' });
      expect(publishCall?.[0]).toBe('social-posts/post-1/publish');
      expect(result.ok).toBe(true);
      if (result.ok && result.data) {
        expect(result.data.postId).toBe('post-1');
        expect(result.data.status).toBe('scheduled');
        expect(result.data.scheduledAt).toBe('2026-06-01T18:00:00.000Z');
      }
    });

    it('rejects a non-ISO scheduledAt before reaching the confirmation flow', async () => {
      const apiFetch = jest.fn();
      const createConfirmation = jest.fn();
      const result = await schedulePostTool.execute(
        { postId: 'post-1', scheduledAt: 'next tuesday' },
        buildCtx({
          apiFetch: apiFetch as never,
          createConfirmation: createConfirmation as never,
        })
      );
      expect(apiFetch).not.toHaveBeenCalled();
      expect(createConfirmation).not.toHaveBeenCalled();
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('publishPostNowTool — destructive flow', () => {
    it('is registered destructive with the publish_post action', () => {
      expect(publishPostNowTool.destructive).toBe(true);
      expect(publishPostNowTool.destructiveAction).toBe('publish_post');
    });

    it('first call: summary shows "Immediately" timing and issues a token bound to postId', async () => {
      const apiFetch = jest.fn(async () => ({
        id: 'post-1',
        title: 'Botox promo',
        caption: 'Smooth skin',
        platforms: ['facebook'],
        status: 'draft',
      }));
      const createConfirmation = jest.fn(async () => ({
        id: 'tok-pub',
        expiresAt: new Date(Date.now() + 30 * 60_000),
      }));
      const ctx = buildCtx({
        apiFetch: apiFetch as never,
        createConfirmation: createConfirmation as never,
      });
      const result = await publishPostNowTool.execute(
        { postId: 'post-1' },
        ctx
      );

      expect(
        apiFetch.mock.calls.some(
          (c) => (c[1] as { method?: string } | undefined)?.method
        )
      ).toBe(false);
      expect(createConfirmation).toHaveBeenCalledWith({
        action: 'publish_post',
        resourceId: 'post-1',
        payload: expect.objectContaining({ postId: 'post-1' }),
      });
      expect(result.ok).toBe(true);
      if (result.ok && result.presentation?.type === 'confirmation_required') {
        expect(result.presentation.token).toBe('tok-pub');
        const fields = result.presentation.summary?.fields ?? [];
        expect(fields.find((f) => f.label === 'Timing')?.value).toBe(
          'Immediately'
        );
      }
    });

    it('second call: verifies the token then POSTs the publish endpoint', async () => {
      const apiFetch = jest.fn(async () => ({
        status: 'published',
        publishedAt: '2026-06-01T18:00:00.000Z',
        platformResults: [{ platform: 'facebook', ok: true }],
      }));
      const verifyConfirmation = jest.fn(async () => ({
        valid: true,
        payload: null,
      }));
      const result = await publishPostNowTool.execute(
        { postId: 'post-1', confirmationToken: 'tok-pub' },
        buildCtx({
          apiFetch: apiFetch as never,
          verifyConfirmation: verifyConfirmation as never,
        })
      );
      expect(verifyConfirmation).toHaveBeenCalled();
      const [calledPath, calledOpts] = apiFetch.mock.calls[0] as [
        string,
        { method?: string },
      ];
      expect(calledPath).toBe('social-posts/post-1/publish');
      expect(calledOpts.method).toBe('POST');
      expect(result.ok).toBe(true);
      if (result.ok && result.data) {
        expect(result.data.status).toBe('published');
        expect(result.data.publishedAt).toBe('2026-06-01T18:00:00.000Z');
      }
    });

    it('rejects a missing postId before reaching the confirmation flow', async () => {
      const apiFetch = jest.fn();
      const result = await publishPostNowTool.execute(
        {} as never,
        buildCtx({ apiFetch: apiFetch as never })
      );
      expect(apiFetch).not.toHaveBeenCalled();
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe('VALIDATION_ERROR');
    });
  });
});
