import { beforeEach, describe, expect, it } from '@borradh-workspace/testing';
import { vi } from 'vitest';
import * as createAssetModule from '../../assets/services/create-asset/create-asset.service.js';
import * as listAssetsModule from '../../assets/services/list-assets/list-assets.service.js';
import * as generateAiImageModule from '../../image-generation/services/generate-ai-image/generate-ai-image.service.js';
import { ErrorCodes } from '../../shared/index.js';
import {
  CTA,
  HERO,
  RICH_TEXT,
  aboutPageRow,
  givenDraft,
  homePageRow,
  toolContext,
} from './agent-fixtures.test-utils.js';
import {
  type AgentMockDb,
  createAgentMockDb,
} from './agent-mock-db.test-utils.js';
import { confirmationKey } from './guardrails.js';
import {
  addBlockTool,
  createPageTool,
  deleteBlockTool,
  deletePageTool,
  generateImageTool,
  listPagesTool,
  moveBlockTool,
  previewTool,
  readPageTool,
  searchOrgAssetsTool,
  updateBlockTool,
  updateSeoTool,
  updateThemeTool,
} from './tools/index.js';

let db: AgentMockDb;
const spies: { mockRestore: () => void }[] = [];

beforeEach(() => {
  vi.clearAllMocks();
  for (const spy of spies.splice(0)) spy.mockRestore();
  db = createAgentMockDb();
  givenDraft(db, [homePageRow(), aboutPageRow()]);
});

/** The blocks written by the last `update … set({ blocks })` call. */
const writtenBlocks = () =>
  (db.updateSet.mock.calls.at(-1)?.[0] as { blocks?: unknown[] })?.blocks ?? [];

describe('read tools', () => {
  it('list_pages returns an outline of every page', async () => {
    const result = await listPagesTool.execute(toolContext(db), {});

    expect(result.success).toBe(true);
    if (!result.success) return;
    const { pages } = result.data.data as { pages: { path: string }[] };
    expect(pages.map((page) => page.path)).toEqual(['/', '/about']);
    expect(result.data.mutated).toBe(false);
  });

  it('list_pages never leaks full props into the outline', async () => {
    const result = await listPagesTool.execute(toolContext(db), {});
    expect(JSON.stringify(result)).not.toContain('subheadline');
  });

  it('read_page returns the full blocks of one page', async () => {
    const result = await readPageTool.execute(toolContext(db), { path: '/' });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect((result.data.data as { blocks: unknown[] }).blocks).toHaveLength(2);
  });

  it('read_page rejects a path that is not url-safe', async () => {
    const result = await readPageTool.execute(toolContext(db), {
      path: 'Our Team',
    });

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
  });

  it('read_page returns NOT_FOUND for a page that does not exist', async () => {
    const result = await readPageTool.execute(toolContext(db), {
      path: '/pricing',
    });

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.code).toBe(ErrorCodes.NOT_FOUND);
  });

  it('preview returns the theme and the outline', async () => {
    const result = await previewTool.execute(toolContext(db), {});

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect((result.data.data as { theme: unknown }).theme).toBeDefined();
  });
});

describe('add_block', () => {
  it('appends a valid block and mints the id server-side', async () => {
    const result = await addBlockTool.execute(toolContext(db), {
      path: '/',
      type: 'rich_text',
      variant: 'prose',
      props: { markdown: 'About us' },
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.mutated).toBe(true);
    const blocks = writtenBlocks() as { id: string; type: string }[];
    expect(blocks).toHaveLength(3);
    expect(blocks[2].type).toBe('rich_text');
    // The model does not choose ids.
    expect(blocks[2].id).toMatch(/^blk_/);
  });

  it('inserts after the named block', async () => {
    const result = await addBlockTool.execute(toolContext(db), {
      path: '/',
      type: 'rich_text',
      props: { markdown: 'Between' },
      afterBlockId: HERO.id,
    });

    expect(result.success).toBe(true);
    expect((writtenBlocks() as { type: string }[])[1].type).toBe('rich_text');
  });

  it('refuses props that do not match the block schema', async () => {
    const result = await addBlockTool.execute(toolContext(db), {
      path: '/',
      type: 'hero',
      props: { title: 'wrong field name' },
    });

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    expect(db.update).not.toHaveBeenCalled();
  });

  it('corrects an unknown variant to the block fallback', async () => {
    await addBlockTool.execute(toolContext(db), {
      path: '/',
      type: 'hero',
      variant: 'diagonal-swoosh',
      props: { headline: 'Hello' },
    });

    const blocks = writtenBlocks() as { variant: string }[];
    expect(blocks.at(-1)?.variant).toBe('image-right');
  });
});

describe('update_block', () => {
  it('patches one field and leaves the rest intact', async () => {
    const result = await updateBlockTool.execute(toolContext(db), {
      path: '/',
      blockId: HERO.id,
      propsPatch: { headline: 'New headline' },
    });

    expect(result.success).toBe(true);
    const blocks = writtenBlocks() as {
      id: string;
      props: Record<string, unknown>;
    }[];
    const hero = blocks.find((block) => block.id === HERO.id);
    expect(hero?.props.headline).toBe('New headline');
    // The field the patch never mentioned survives — the whole point of a PATCH.
    expect(hero?.props.subheadline).toBe('We are open');
  });

  it('clears an optional field with null', async () => {
    await updateBlockTool.execute(toolContext(db), {
      path: '/',
      blockId: HERO.id,
      propsPatch: { subheadline: null },
    });

    const blocks = writtenBlocks() as {
      id: string;
      props: Record<string, unknown>;
    }[];
    expect(
      blocks.find((b) => b.id === HERO.id)?.props.subheadline
    ).toBeUndefined();
  });

  it('refuses a patch that would make the block invalid', async () => {
    const result = await updateBlockTool.execute(toolContext(db), {
      path: '/',
      blockId: HERO.id,
      propsPatch: { headline: '' },
    });

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    expect(db.update).not.toHaveBeenCalled();
  });

  it('returns NOT_FOUND for an unknown block id', async () => {
    const result = await updateBlockTool.execute(toolContext(db), {
      path: '/',
      blockId: 'blk-nope',
      propsPatch: { headline: 'x' },
    });

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.code).toBe(ErrorCodes.NOT_FOUND);
  });
});

describe('move_block', () => {
  it('moves a block to the requested index', async () => {
    const result = await moveBlockTool.execute(toolContext(db), {
      path: '/',
      blockId: CTA.id,
      toIndex: 0,
    });

    expect(result.success).toBe(true);
    expect((writtenBlocks() as { id: string }[])[0].id).toBe(CTA.id);
  });

  it('rejects a negative index', async () => {
    const result = await moveBlockTool.execute(toolContext(db), {
      path: '/',
      blockId: CTA.id,
      toIndex: -1,
    });

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
  });
});

describe('delete_block', () => {
  it('removes a block', async () => {
    const result = await deleteBlockTool.execute(toolContext(db), {
      path: '/about',
      blockId: RICH_TEXT.id,
    });

    expect(result.success).toBe(true);
    expect(writtenBlocks()).toHaveLength(0);
  });

  it('rejects a missing blockId', async () => {
    const result = await deleteBlockTool.execute(toolContext(db), {
      path: '/about',
    });

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
  });
});

describe('create_page / delete_page', () => {
  it('creates a page with its blocks', async () => {
    db.insertReturning.mockResolvedValue([{ id: 'page-new' }]);

    const result = await createPageTool.execute(toolContext(db), {
      path: '/pricing',
      title: 'Pricing',
      blocks: [{ type: 'rich_text', props: { markdown: 'From €40' } }],
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.mutated).toBe(true);
    expect(db.insert).toHaveBeenCalled();
  });

  it('refuses a path that already exists', async () => {
    const result = await createPageTool.execute(toolContext(db), {
      path: '/about',
      title: 'About again',
      blocks: [],
    });

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.code).toBe(ErrorCodes.ALREADY_EXISTS);
  });

  it('asks for confirmation before deleting a page', async () => {
    const result = await deletePageTool.execute(toolContext(db), {
      path: '/about',
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.confirmationRequired?.action).toBe(
      confirmationKey('delete_page', '/about')
    );
    expect(result.data.mutated).toBe(false);
    expect(db.delete).not.toHaveBeenCalled();
  });

  it('deletes the page once the UI has confirmed it', async () => {
    const result = await deletePageTool.execute(
      toolContext(db, {
        confirmedActions: new Set([confirmationKey('delete_page', '/about')]),
      }),
      { path: '/about' }
    );

    expect(result.success).toBe(true);
    expect(db.delete).toHaveBeenCalled();
  });

  it('refuses to delete a system page even when confirmed', async () => {
    const result = await deletePageTool.execute(
      toolContext(db, {
        confirmedActions: new Set([confirmationKey('delete_page', '/')]),
      }),
      { path: '/' }
    );

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.code).toBe(ErrorCodes.FORBIDDEN);
    expect(db.delete).not.toHaveBeenCalled();
  });
});

describe('update_seo', () => {
  it('sets the title and description', async () => {
    const result = await updateSeoTool.execute(toolContext(db), {
      path: '/about',
      title: 'About Acme Salon',
      description: 'Who we are',
    });

    expect(result.success).toBe(true);
    expect(db.updateSet.mock.calls.at(-1)?.[0]).toEqual({
      seo: { title: 'About Acme Salon', description: 'Who we are' },
    });
  });

  it('rejects an over-long title', async () => {
    const result = await updateSeoTool.execute(toolContext(db), {
      path: '/about',
      title: 'x'.repeat(200),
    });

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
  });
});

describe('update_theme', () => {
  it('patches a non-brand field without confirmation', async () => {
    const result = await updateThemeTool.execute(toolContext(db), {
      patch: { radius: 'full' },
    });

    expect(result.success).toBe(true);
    const written = db.updateSet.mock.calls.at(-1)?.[0] as {
      theme: { radius: string; brand: { primary: string } };
    };
    expect(written.theme.radius).toBe('full');
    // The rest of the theme survives the patch.
    expect(written.theme.brand.primary).toBe('#2B8553');
  });

  it('asks for confirmation before changing brand colours', async () => {
    const result = await updateThemeTool.execute(toolContext(db), {
      patch: { brand: { primary: '#FF0000' } },
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.confirmationRequired?.action).toBe(
      confirmationKey('update_theme', 'brand')
    );
    expect(db.update).not.toHaveBeenCalled();
  });

  it('rejects an unknown theme field', async () => {
    const result = await updateThemeTool.execute(toolContext(db), {
      patch: { shadow: 'heavy' },
    });

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
  });
});

describe('asset tools', () => {
  it('search_org_assets returns asset ids from the org library', async () => {
    const spy = vi.spyOn(listAssetsModule, 'listAssets').mockResolvedValue({
      success: true,
      data: {
        items: [{ id: 'asset-1', name: 'Front door', width: 10, height: 10 }],
        total: 1,
        limit: 8,
        offset: 0,
      },
    } as never);
    spies.push(spy);

    const result = await searchOrgAssetsTool.execute(toolContext(db), {
      query: 'door',
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(
      (result.data.data as { assets: { assetId: string }[] }).assets
    ).toEqual([
      { assetId: 'asset-1', name: 'Front door', width: 10, height: 10 },
    ]);
    // The org comes from the session, not from the model.
    expect(spy.mock.calls[0][1]).toMatchObject({ organizationId: 'org-1' });
  });

  it('search_org_assets rejects an empty query', async () => {
    const result = await searchOrgAssetsTool.execute(toolContext(db), {
      query: '   ',
    });

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
  });

  it('generate_image stores the image and returns an asset id', async () => {
    spies.push(
      vi.spyOn(generateAiImageModule, 'generateAiImage').mockResolvedValue({
        success: true,
        data: { png: Buffer.from('png'), orientation: 'landscape' },
      } as never)
    );
    spies.push(
      vi.spyOn(createAssetModule, 'createAsset').mockResolvedValue({
        success: true,
        data: { id: 'asset-new' },
      } as never)
    );

    const result = await generateImageTool.execute(toolContext(db), {
      prompt: 'A calm treatment room in soft daylight',
      aspect: 'landscape',
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect((result.data.data as { assetId: string }).assetId).toBe('asset-new');
  });

  it('generate_image rejects a prompt that is too short', async () => {
    const result = await generateImageTool.execute(toolContext(db), {
      prompt: 'room',
    });

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
  });
});
