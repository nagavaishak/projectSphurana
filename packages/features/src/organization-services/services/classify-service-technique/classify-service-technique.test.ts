import { chatCompletion, generateEmbeddings } from '@borradh-workspace/ai';
import {
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from '@borradh-workspace/testing';
import { classifyServiceTechnique } from './classify-service-technique.service.js';

/**
 * Result sets handed to successive `db.select()` chains, in call order:
 *   [0] techniques   [1] treatment agents   [2] sibling service names
 * A `vocabulary` override skips the first two.
 */
let selectResults: unknown[][] = [];

/**
 * `.from()` returns a real Promise carrying a `.where()`, so both shapes the
 * service uses resolve from the SAME queue entry:
 *   `await db.select().from(t)`            — the two seed-table reads
 *   `await db.select().from(t).where(...)` — the sibling-name read
 */
const makeSelectChain = () => ({
  from: vi.fn(() => {
    const rows = selectResults.shift() ?? [];
    return Object.assign(Promise.resolve(rows), {
      where: vi.fn(() => Promise.resolve(rows)),
    });
  }),
});

const updateWhere = vi.fn().mockResolvedValue(undefined);
const updateSet = vi.fn(() => ({ where: updateWhere }));

const mockDb = {
  query: { organizationService: { findFirst: vi.fn() } },
  select: vi.fn(() => makeSelectChain()),
  update: vi.fn(() => ({ set: updateSet })),
};

const TECHNIQUES = [
  {
    slug: 'microneedling',
    displayName: 'Microneedling',
    visualSignature: 'pen tracked across skin',
    isProcedural: true,
    parentSlug: null,
  },
  {
    slug: 'energy_contact',
    displayName: 'Contact energy device',
    visualSignature: 'applicator moved over skin',
    isProcedural: true,
    parentSlug: null,
  },
  {
    slug: 'radiofrequency',
    displayName: 'Radiofrequency',
    visualSignature: 'RF handpiece with gel',
    isProcedural: true,
    parentSlug: 'energy_contact',
  },
  {
    slug: 'consultation',
    displayName: 'Consultation',
    visualSignature: 'two people talking',
    isProcedural: false,
    parentSlug: null,
  },
];

const AGENTS = [{ techniqueSlug: 'microneedling', aliases: ['dermapen'] }];

const service = {
  id: 's1',
  name: 'Microneedling',
  description: null,
  category: 'skin',
  targetArea: null,
  organizationId: 'org1',
  techniqueSlug: null,
  regions: [],
  expectedShot: null,
  techniqueClassifiedAt: null,
};

/** Queue one model answer per expected pass. */
const answer = (body: Record<string, unknown>) =>
  vi.mocked(chatCompletion).mockResolvedValueOnce({
    content: JSON.stringify(body),
  } as never);

beforeEach(() => {
  vi.clearAllMocks();
  selectResults = [TECHNIQUES, AGENTS, []];
  mockDb.query.organizationService.findFirst.mockResolvedValue(service);
  vi.mocked(generateEmbeddings).mockResolvedValue([[0.1, 0.2, 0.3]]);
});

describe('classifyServiceTechnique', () => {
  it('returns NOT_FOUND when the service does not exist', async () => {
    mockDb.query.organizationService.findFirst.mockResolvedValue(undefined);

    const result = await classifyServiceTechnique(mockDb as never, {
      organizationServiceId: 'missing',
    });

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe('NOT_FOUND');
    expect(chatCompletion).not.toHaveBeenCalled();
  });

  it('writes the technique, regions, shot and embedding on a decided pass 1', async () => {
    answer({
      techniqueSlug: 'microneedling',
      regions: ['full face'],
      expectedShot: 'microneedling pen tracked across the cheek, close-up',
      confidence: 'high',
      reasoning: 'names the treatment outright',
    });

    const result = await classifyServiceTechnique(mockDb as never, {
      organizationServiceId: 's1',
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.techniqueSlug).toBe('microneedling');
    expect(result.data.passes).toBe(1);
    expect(chatCompletion).toHaveBeenCalledTimes(1);

    const written = updateSet.mock.calls[0][0] as Record<string, unknown>;
    expect(written.techniqueSlug).toBe('microneedling');
    expect(written.regions).toEqual(['full face']);
    expect(written.specSource).toBe('inferred_from_name');
    expect(written.expectedShotEmbedding).toEqual([0.1, 0.2, 0.3]);
    expect(written.techniqueClassifiedAt).toBeInstanceOf(Date);
  });

  // The whole point of the marker column. Null is a CORRECT answer for a name
  // that carries no treatment information, so if a null classification did not
  // stamp the row, every vague service would be re-asked — two LLM calls — on
  // every match job, forever.
  it('stamps technique_classified_at even when the honest answer is null', async () => {
    mockDb.query.organizationService.findFirst.mockResolvedValue({
      ...service,
      name: 'Anti-Ageing',
    });
    answer({
      techniqueSlug: null,
      regions: [],
      expectedShot: 'clinician and client in a consultation room, mid shot',
      confidence: 'high',
      reasoning: 'names a concern, not a treatment',
    });

    const result = await classifyServiceTechnique(mockDb as never, {
      organizationServiceId: 's1',
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.techniqueSlug).toBeNull();

    const written = updateSet.mock.calls[0][0] as Record<string, unknown>;
    expect(written.techniqueSlug).toBeNull();
    expect(written.specSource).toBe('unknown');
    expect(written.techniqueClassifiedAt).toBeInstanceOf(Date);
  });

  it('skips an already-classified row without calling the model', async () => {
    mockDb.query.organizationService.findFirst.mockResolvedValue({
      ...service,
      techniqueSlug: null,
      techniqueClassifiedAt: new Date('2026-01-01'),
    });

    const result = await classifyServiceTechnique(mockDb as never, {
      organizationServiceId: 's1',
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.skipped).toBe('already_classified');
    expect(result.data.passes).toBe(0);
    expect(chatCompletion).not.toHaveBeenCalled();
    expect(mockDb.update).not.toHaveBeenCalled();
  });

  it('re-asks an already-classified row when forced', async () => {
    mockDb.query.organizationService.findFirst.mockResolvedValue({
      ...service,
      techniqueSlug: 'microneedling',
      techniqueClassifiedAt: new Date('2026-01-01'),
    });
    answer({
      techniqueSlug: 'radiofrequency',
      regions: ['abdomen'],
      expectedShot: 'RF handpiece with gel over the abdomen, mid shot',
      confidence: 'high',
      reasoning: 'renamed to name the machine',
    });

    const result = await classifyServiceTechnique(mockDb as never, {
      organizationServiceId: 's1',
      force: true,
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.techniqueSlug).toBe('radiofrequency');
    expect(chatCompletion).toHaveBeenCalledTimes(1);
  });

  // Closed vocabulary: `technique_slug` is an FK, and free text drifts.
  it('drops an off-list slug to null rather than writing it', async () => {
    answer({
      techniqueSlug: 'hair_washing',
      regions: [],
      expectedShot: 'a neutral clinic shot',
      confidence: 'low',
      reasoning: 'invented',
    });

    const result = await classifyServiceTechnique(mockDb as never, {
      organizationServiceId: 's1',
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.techniqueSlug).toBeNull();
  });

  it('drops a region outside the controlled vocabulary', async () => {
    answer({
      techniqueSlug: 'microneedling',
      regions: ['full face', 'elbow'],
      expectedShot: 'pen across the cheek, close-up',
      confidence: 'high',
      reasoning: 'ok',
    });

    const result = await classifyServiceTechnique(mockDb as never, {
      organizationServiceId: 's1',
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.regions).toEqual(['full face']);
  });

  describe('pass 2 — the catalogue, for the undecided only', () => {
    beforeEach(() => {
      selectResults = [
        TECHNIQUES,
        AGENTS,
        [{ name: 'Endymed contouring' }, { name: 'Laser Hair Removal' }],
      ];
    });

    it('does not run when pass 1 already named a leaf technique', async () => {
      answer({
        techniqueSlug: 'microneedling',
        regions: ['full face'],
        expectedShot: 'pen across the cheek, close-up',
        confidence: 'high',
        reasoning: 'decided',
      });

      const result = await classifyServiceTechnique(mockDb as never, {
        organizationServiceId: 's1',
      });

      expect(result.success).toBe(true);
      if (!result.success) return;
      expect(result.data.passes).toBe(1);
      expect(chatCompletion).toHaveBeenCalledTimes(1);
    });

    // After a null, only hard MACHINE evidence is strong enough to overturn
    // "I don't know". A price list full of facials does not make an unnamed
    // service a facial.
    it('accepts a MACHINE from the catalogue after a null pass 1', async () => {
      answer({
        techniqueSlug: null,
        regions: [],
        expectedShot: 'neutral clinic shot',
        confidence: 'low',
        reasoning: 'vague',
      });
      answer({
        techniqueSlug: 'radiofrequency',
        regions: ['abdomen'],
        expectedShot: 'RF handpiece with gel over the abdomen, mid shot',
        confidence: 'medium',
        reasoning: 'the clinic sells Endymed contouring',
      });

      const result = await classifyServiceTechnique(mockDb as never, {
        organizationServiceId: 's1',
      });

      expect(result.success).toBe(true);
      if (!result.success) return;
      expect(result.data.techniqueSlug).toBe('radiofrequency');
      expect(result.data.passes).toBe(2);
    });

    it('refuses a non-machine from the catalogue after a null pass 1', async () => {
      answer({
        techniqueSlug: null,
        regions: [],
        expectedShot: 'neutral clinic shot',
        confidence: 'low',
        reasoning: 'vague',
      });
      answer({
        techniqueSlug: 'microneedling',
        regions: ['full face'],
        expectedShot: 'pen across the cheek, close-up',
        confidence: 'low',
        reasoning: 'the list is mostly skin work',
      });

      const result = await classifyServiceTechnique(mockDb as never, {
        organizationServiceId: 's1',
      });

      expect(result.success).toBe(true);
      if (!result.success) return;
      expect(result.data.techniqueSlug).toBeNull();
      expect(result.data.passes).toBe(2);
    });

    // Refining a PARENT is different: the name already gave a category and
    // pass 2 only sharpens it, so any technique is allowed — including a
    // top-level one, which is most of the taxonomy.
    it('accepts any technique from the catalogue when refining a parent', async () => {
      answer({
        techniqueSlug: 'energy_contact',
        regions: ['abdomen'],
        expectedShot: 'applicator over the abdomen, mid shot',
        confidence: 'medium',
        reasoning: 'a body energy device, machine unknown',
      });
      answer({
        techniqueSlug: 'microneedling',
        regions: ['full face'],
        expectedShot: 'pen across the cheek, close-up',
        confidence: 'medium',
        reasoning: 'the catalogue names it',
      });

      const result = await classifyServiceTechnique(mockDb as never, {
        organizationServiceId: 's1',
      });

      expect(result.success).toBe(true);
      if (!result.success) return;
      expect(result.data.techniqueSlug).toBe('microneedling');
      expect(result.data.passes).toBe(2);
    });

    it('keeps the parent when the catalogue reveals nothing usable', async () => {
      answer({
        techniqueSlug: 'energy_contact',
        regions: ['abdomen'],
        expectedShot: 'applicator over the abdomen, mid shot',
        confidence: 'medium',
        reasoning: 'category only',
      });
      answer({
        techniqueSlug: null,
        regions: [],
        expectedShot: 'neutral clinic shot',
        confidence: 'low',
        reasoning: 'the list says nothing',
      });

      const result = await classifyServiceTechnique(mockDb as never, {
        organizationServiceId: 's1',
      });

      expect(result.success).toBe(true);
      if (!result.success) return;
      expect(result.data.techniqueSlug).toBe('energy_contact');
    });

    it('does not run when the org has no other services to read', async () => {
      selectResults = [TECHNIQUES, AGENTS, []];
      answer({
        techniqueSlug: null,
        regions: [],
        expectedShot: 'neutral clinic shot',
        confidence: 'low',
        reasoning: 'vague',
      });

      const result = await classifyServiceTechnique(mockDb as never, {
        organizationServiceId: 's1',
      });

      expect(result.success).toBe(true);
      if (!result.success) return;
      expect(result.data.passes).toBe(1);
      expect(chatCompletion).toHaveBeenCalledTimes(1);
    });
  });

  it('returns INTERNAL_ERROR and writes nothing when the model call fails', async () => {
    vi.mocked(chatCompletion).mockRejectedValueOnce(new Error('429'));

    const result = await classifyServiceTechnique(mockDb as never, {
      organizationServiceId: 's1',
    });

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe('INTERNAL_ERROR');
    // No stamp, so the next job retries rather than treating it as settled.
    expect(mockDb.update).not.toHaveBeenCalled();
  });

  // The gate still applies without an embedding; ordering just falls back to
  // least-recently-created. A legal unranked clip beats no classification.
  it('still writes the technique when embedding fails', async () => {
    answer({
      techniqueSlug: 'microneedling',
      regions: ['full face'],
      expectedShot: 'pen across the cheek, close-up',
      confidence: 'high',
      reasoning: 'ok',
    });
    vi.mocked(generateEmbeddings).mockRejectedValueOnce(new Error('down'));

    const result = await classifyServiceTechnique(mockDb as never, {
      organizationServiceId: 's1',
    });

    expect(result.success).toBe(true);
    const written = updateSet.mock.calls[0][0] as Record<string, unknown>;
    expect(written.techniqueSlug).toBe('microneedling');
    expect(written.expectedShotEmbedding).toBeNull();
    expect(written.techniqueClassifiedAt).toBeInstanceOf(Date);
  });
});
