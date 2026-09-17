import { type Database, asset, sql } from '@borradh-workspace/database';
import type {
  Slot,
  SlotQuery,
  TemplateDoc,
  TemplateOverlayBlock,
  TemplateRegion,
  TemplateSpineBlock,
  Theme,
} from '@borradh-workspace/video-templates';
import { SHARED_MUSIC_TRACKS } from '@borradh-workspace/video-templates/music-registry';
import {
  type SeededRng,
  deriveRng,
  pickIntInclusive,
  pickN,
  pickOne,
} from './seeded-rng.js';

interface PickedClipsForSlot {
  slotId: string;
  query: Extract<SlotQuery, { kind: 'asset-clips' }>;
  count: number;
  assetIds: string[];
}

interface PickedMediaForSlot {
  slotId: string;
  query: Extract<SlotQuery, { kind: 'asset-media' }>;
  assetId: string;
}

interface PickedMusicForSlot {
  slotId: string;
  query: Extract<SlotQuery, { kind: 'music' }>;
  trackId: string | null;
}

interface PickedBrandForSlot {
  slotId: string;
  query: Extract<SlotQuery, { kind: 'brand' }>;
  /**
   * Resolved value from the active Theme. May be null when the field exists
   * but has no concrete value (e.g. no logo URL on the brand_kit). The
   * required-pass enforces presence on slots that can't tolerate null.
   */
  value: string | null;
}

export interface GateResult {
  passed: boolean;
  missing: SlotQuery[];
  /**
   * Slot-level resolved picks. Today the downstream compiler still reads
   * pre-resolved `bRollClips`/`musicTrackId` from `draftConfig`, so these are
   * informational. Once the compiler is rewired to consume gate output
   * directly (wave-5 work), the seeded picks here become load-bearing.
   */
  picks: {
    clips: PickedClipsForSlot[];
    media: PickedMediaForSlot[];
    music: PickedMusicForSlot[];
    brand: PickedBrandForSlot[];
  };
}

interface CollectedSlot {
  slotId: string;
  query: SlotQuery;
  required: boolean;
}

function collectSlotQueries(doc: TemplateDoc): CollectedSlot[] {
  const slots: CollectedSlot[] = [];

  const collectSlot = <T>(
    parentId: string,
    role: string,
    slot: Slot<T> | undefined
  ) => {
    if (slot?.source === 'query') {
      slots.push({
        slotId: `${parentId}.${role}`,
        query: slot.query,
        required: slot.required,
      });
    }
  };

  const visitSpine = (block: TemplateSpineBlock) => {
    if (block.kind === 'media-track') {
      collectSlot(block.id, 'clips', block.clips);
    } else if (block.kind === 'solid') {
      collectSlot(block.id, 'color', block.color);
    }
  };

  const visitOverlay = (block: TemplateOverlayBlock) => {
    if (block.kind === 'staggered-list') {
      collectSlot(block.id, 'lead.text', block.lead?.text);
      collectSlot(block.id, 'items.texts', block.items.texts);
      collectSlot(block.id, 'trail.text', block.trail?.text);
    } else if (block.kind === 'media-overlay') {
      collectSlot(block.id, 'clip', block.clip);
      collectSlot(block.id, 'label.text', block.label?.text);
    } else if (block.kind === 'info-card') {
      collectSlot(block.id, 'headline.text', block.headline?.text);
      collectSlot(block.id, 'items.texts', block.items?.texts);
      collectSlot(block.id, 'price.value', block.price?.value);
      collectSlot(block.id, 'price.currency', block.price?.currency);
      collectSlot(block.id, 'cta.text', block.cta?.text);
      collectSlot(block.id, 'cta.url', block.cta?.url);
      collectSlot(block.id, 'logo.url', block.logo?.url);
    } else if (block.kind === 'text') {
      collectSlot(block.id, 'text', block.text);
    }
  };

  const visitRegion = (region: TemplateRegion) => {
    if (region.kind === 'leaf') {
      for (const block of region.spine) visitSpine(block);
      for (const block of region.overlays) visitOverlay(block);
      return;
    }
    for (const child of region.children) visitRegion(child.region);
  };

  visitRegion(doc.root);
  collectSlot('globals.audio', 'music', doc.globals.audio.music);

  return slots;
}

async function fetchMatchingAssetIdsForClips(
  db: Database,
  query: Extract<SlotQuery, { kind: 'asset-clips' }>,
  organizationId: string
): Promise<string[]> {
  const rows = await db
    .select({ id: asset.id })
    .from(asset)
    .where(
      sql`${asset.organizationId} = ${organizationId} AND ${asset.deletedAt} IS NULL AND ${asset.tags} @> ARRAY[${query.tag}]::text[]`
    )
    .orderBy(asset.id);
  return rows.map((r) => r.id);
}

async function fetchMatchingAssetIdsForMedia(
  db: Database,
  query: Extract<SlotQuery, { kind: 'asset-media' }>,
  organizationId: string
): Promise<string[]> {
  const rows = await db
    .select({ id: asset.id })
    .from(asset)
    .where(
      sql`${asset.organizationId} = ${organizationId} AND ${asset.deletedAt} IS NULL AND ${asset.type} = ${query.mediaType} AND ${asset.tags} @> ARRAY[${query.tag}]::text[]`
    )
    .orderBy(asset.id);
  return rows.map((r) => r.id);
}

function rankMusicCandidates(
  query: Extract<SlotQuery, { kind: 'music' }>
): typeof SHARED_MUSIC_TRACKS {
  return SHARED_MUSIC_TRACKS.filter((track) => {
    if (query.mood && track.mood !== query.mood) return false;
    if (query.bpm) {
      const [lo, hi] = query.bpm;
      if (track.bpm < lo || track.bpm > hi) return false;
    }
    return true;
  });
}

async function pickClipsForSlot(
  db: Database,
  slot: CollectedSlot,
  query: Extract<SlotQuery, { kind: 'asset-clips' }>,
  organizationId: string,
  rng: SeededRng
): Promise<PickedClipsForSlot | null> {
  const matching = await fetchMatchingAssetIdsForClips(
    db,
    query,
    organizationId
  );
  const [min, max] = query.count;
  if (slot.required && matching.length < min) return null;

  const count = pickIntInclusive(rng, min, Math.min(max, matching.length));
  const picked = pickN(rng, matching, count);
  return {
    slotId: slot.slotId,
    query,
    count,
    assetIds: picked,
  };
}

async function pickMediaForSlot(
  db: Database,
  slot: CollectedSlot,
  query: Extract<SlotQuery, { kind: 'asset-media' }>,
  organizationId: string,
  rng: SeededRng
): Promise<PickedMediaForSlot | null> {
  const matching = await fetchMatchingAssetIdsForMedia(
    db,
    query,
    organizationId
  );
  if (slot.required && matching.length === 0) return null;
  if (matching.length === 0) {
    return { slotId: slot.slotId, query, assetId: '' };
  }
  return {
    slotId: slot.slotId,
    query,
    assetId: pickOne(rng, matching),
  };
}

function pickMusicForSlot(
  slot: CollectedSlot,
  query: Extract<SlotQuery, { kind: 'music' }>,
  rng: SeededRng
): PickedMusicForSlot | null {
  const candidates = rankMusicCandidates(query);
  if (slot.required && candidates.length === 0) return null;
  if (candidates.length === 0) {
    return { slotId: slot.slotId, query, trackId: null };
  }
  // All candidates are equally ranked (mood/bpm are pass/fail filters). Use
  // the rng for a deterministic tie-break.
  return {
    slotId: slot.slotId,
    query,
    trackId: pickOne(rng, candidates).id,
  };
}

// Resolves a brand-slot field against the active Theme. Returns null when the
// field exists on the theme but has no concrete value (e.g. logo URL absent).
function resolveBrandField(
  theme: Theme,
  field: Extract<SlotQuery, { kind: 'brand' }>['field']
): string | null {
  switch (field) {
    case 'primaryColor':
      return theme.colors.primary;
    case 'logoUrl':
      // Prefer the light variant; the dark variant is used by the renderer
      // when context demands it (e.g. dark background overlays).
      return theme.logo.light ?? theme.logo.dark ?? null;
    case 'businessName':
      return theme.identity.businessName;
    case 'tagline':
      return theme.identity.tagline;
  }
}

async function canSatisfyRequiredQuery(
  db: Database,
  query: SlotQuery,
  organizationId: string,
  theme: Theme
): Promise<boolean> {
  if (query.kind === 'script-text') return true;

  if (query.kind === 'music') {
    return rankMusicCandidates(query).length > 0;
  }

  if (query.kind === 'brand') {
    const value = resolveBrandField(theme, query.field);
    return value !== null && value !== '';
  }

  if (query.kind === 'asset-clips') {
    const matching = await fetchMatchingAssetIdsForClips(
      db,
      query,
      organizationId
    );
    return matching.length >= query.count[0];
  }

  if (query.kind === 'asset-media') {
    const matching = await fetchMatchingAssetIdsForMedia(
      db,
      query,
      organizationId
    );
    return matching.length > 0;
  }

  return false;
}

export async function gateSlots(
  db: Database,
  templateDoc: TemplateDoc,
  organizationId: string,
  seed: number,
  theme: Theme
): Promise<GateResult> {
  const collected = collectSlotQueries(templateDoc);
  const missing: SlotQuery[] = [];
  const clipPicks: PickedClipsForSlot[] = [];
  const mediaPicks: PickedMediaForSlot[] = [];
  const musicPicks: PickedMusicForSlot[] = [];
  const brandPicks: PickedBrandForSlot[] = [];

  // First pass: pass/fail for every required slot.
  for (const slot of collected) {
    if (!slot.required) continue;
    const okSlot = await canSatisfyRequiredQuery(
      db,
      slot.query,
      organizationId,
      theme
    );
    if (!okSlot) missing.push(slot.query);
  }

  // Second pass: deterministic selection for every slot that resolves to a
  // pickable list. Each slot gets its own derived sub-RNG so adding /
  // reordering slots in the template doesn't perturb other slots' picks.
  for (const slot of collected) {
    const rng = deriveRng(seed, slot.slotId);
    if (slot.query.kind === 'asset-clips') {
      const picked = await pickClipsForSlot(
        db,
        slot,
        slot.query,
        organizationId,
        rng
      );
      if (picked) clipPicks.push(picked);
    } else if (slot.query.kind === 'asset-media') {
      const picked = await pickMediaForSlot(
        db,
        slot,
        slot.query,
        organizationId,
        rng
      );
      if (picked) mediaPicks.push(picked);
    } else if (slot.query.kind === 'music') {
      const picked = pickMusicForSlot(slot, slot.query, rng);
      if (picked) musicPicks.push(picked);
    } else if (slot.query.kind === 'brand') {
      // Brand slots are resolved deterministically from the Theme — no rng
      // tie-break needed. We still emit a pick so the compiler can read
      // resolved values from gate output.
      brandPicks.push({
        slotId: slot.slotId,
        query: slot.query,
        value: resolveBrandField(theme, slot.query.field),
      });
    }
  }

  return {
    passed: missing.length === 0,
    missing,
    picks: {
      clips: clipPicks,
      media: mediaPicks,
      music: musicPicks,
      brand: brandPicks,
    },
  };
}
