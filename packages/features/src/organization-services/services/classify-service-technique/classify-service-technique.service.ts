import { chatCompletion, generateEmbeddings } from '@borradh-workspace/ai';
import {
  organizationService,
  technique,
  treatmentAgent,
} from '@borradh-workspace/database';
import { logError, trackedResult } from '@borradh-workspace/observability';
import { and, eq, ne } from 'drizzle-orm';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  ok,
} from '../../../shared/index.js';
import {
  type ClassifiableService,
  type ClassifiedSpec,
  REGIONS,
  SYSTEM,
  parseJson,
  promptFor,
} from './classify-service-technique.prompt.js';
import {
  type ClassifyServiceTechniqueInput,
  classifyServiceTechniqueSchema,
} from './classify-service-technique.schema.js';

/**
 * The closed vocabulary the classifier chooses from, plus the parent/child
 * structure the two-pass guard needs.
 *
 * Loaded separately from classification so a batch caller pays for the two seed
 * queries ONCE rather than per service. `technique` and `treatment_agent` are
 * seed tables — they change on migration, not at runtime.
 */
export interface TechniqueVocabulary {
  /** Rendered prompt block: one line per technique, with its visual signature. */
  vocab: string;
  /** Every offerable slug. Anything outside this set is dropped to null. */
  validSlugs: Set<string>;
  /** Slugs that are a parent of something — i.e. "category, machine unknown". */
  parentSlugs: Set<string>;
  /** Slugs that ARE a machine — a child of some parent. */
  machineSlugs: Set<string>;
}

export const loadTechniqueVocabulary = async (
  db: DbConnection
): Promise<TechniqueVocabulary> => {
  // The vocabulary, with each technique's visual signature AND the market
  // vocabulary that falls under it. The aliases are shown as examples of what
  // the technique covers — they are not the matcher.
  const techniques = await db
    .select({
      slug: technique.slug,
      displayName: technique.displayName,
      visualSignature: technique.visualSignature,
      isProcedural: technique.isProcedural,
      parentSlug: technique.parentSlug,
    })
    .from(technique);

  const agents = await db
    .select({
      techniqueSlug: treatmentAgent.techniqueSlug,
      aliases: treatmentAgent.aliases,
    })
    .from(treatmentAgent);

  const aliasesByTechnique = new Map<string, string[]>();
  for (const a of agents) {
    const cur = aliasesByTechnique.get(a.techniqueSlug) ?? [];
    aliasesByTechnique.set(a.techniqueSlug, cur.concat(a.aliases ?? []));
  }

  // Parents ARE offered, alongside leaves.
  //
  // They were briefly withheld, because a service declaring a parent used to
  // reach every CHILD of that parent — so "Body Contouring" -> `energy_contact`
  // made an EMS clinic eligible for endospheres footage. That reach was the
  // defect and it now lives fixed in the resolver, which matches a declared
  // technique exactly and nothing else.
  //
  // With the reach gone, a parent is a genuinely good answer. Clips are tagged
  // to a parent precisely when the machine ISN'T identifiable ("handheld
  // applicator with gel moved over abdomen") — which is exactly the footage a
  // service that named only a category should receive.
  const usable = techniques.filter((t) => t.isProcedural);

  return {
    vocab: usable
      .map((t) => {
        const ex = (aliasesByTechnique.get(t.slug) ?? []).slice(0, 12);
        return `  - "${t.slug}" (${t.displayName}): ${t.visualSignature ?? ''}${
          ex.length ? `\n      commonly sold as: ${ex.join(', ')}` : ''
        }`;
      })
      .join('\n'),
    validSlugs: new Set(usable.map((t) => t.slug)),
    parentSlugs: new Set(
      techniques.map((t) => t.parentSlug).filter((s): s is string => Boolean(s))
    ),
    machineSlugs: new Set(
      techniques.filter((t) => t.parentSlug).map((t) => t.slug)
    ),
  };
};

export interface ClassifiedServiceTechnique {
  techniqueSlug: string | null;
  regions: string[];
  expectedShot: string | null;
  confidence: string;
  reasoning: string;
  /** How many LLM classification calls were made (0, 1 or 2). */
  passes: number;
  /** Set when the row was left alone; no model call was made. */
  skipped?: 'already_classified';
}

interface PassResult {
  slug: string | null;
  /** The model named a slug that is not in the closed vocabulary. */
  offList: boolean;
  regions: string[];
  expectedShot: string;
  confidence: string;
  reasoning: string;
}

const classifyOnce = async (
  vocabulary: TechniqueVocabulary,
  svc: ClassifiableService,
  withCatalogue: boolean
): Promise<PassResult> => {
  const res = await chatCompletion(
    promptFor(vocabulary.vocab, svc, withCatalogue),
    {
      systemMessage: SYSTEM,
      jsonResponse: true,
      temperature: 0,
      observability: { spanName: 'organizationServices.classifyService' },
    }
  );
  const p = parseJson(res.content) as unknown as ClassifiedSpec;

  // Closed vocabulary: anything off-list becomes null rather than an FK error.
  const slug =
    p.techniqueSlug && vocabulary.validSlugs.has(p.techniqueSlug)
      ? p.techniqueSlug
      : null;

  return {
    slug,
    offList: Boolean(p.techniqueSlug) && !slug,
    regions: (p.regions ?? []).filter((r) =>
      (REGIONS as readonly string[]).includes(r)
    ),
    expectedShot: (p.expectedShot ?? '').trim(),
    confidence: p.confidence ?? 'low',
    reasoning: p.reasoning ?? '',
  };
};

/**
 * Classify ONE service into a footage spec: technique, regions, and an
 * `expected_shot` sentence which is then embedded for ranking.
 *
 * This used to exist only as `scripts/classify-services.ts`, run by hand. That
 * meant `technique_slug` was never written by application code at all — so every
 * service created after the last manual run, including every service in a newly
 * onboarded organisation, stayed unclassified and fell through to generic
 * ambient footage permanently. The failure was silent because null IS a
 * legitimate classification, so an unclassified row is indistinguishable from a
 * correctly-vague one. Nothing errored; the videos were just generic.
 *
 * TWO PASSES, because the catalogue must not be in the room when there is no tie:
 *
 *   PASS 1  the service ALONE. Cannot be contaminated; there is no list.
 *           Supplying the clinic's other service names up front biased every
 *           judgement toward the price list's dominant modality — a prod dry run
 *           turned "Wart and Tag Removal" (cryotherapy) into `injection` at an
 *           injectables clinic, and cut Electrolysis from 11 regions to 4.
 *           Instructing the model to ignore the list fixed the technique but NOT
 *           the regions; the only reliable fence is absence.
 *
 *   PASS 2  only what pass 1 left undecided — null, or a PARENT — sees the
 *           catalogue. What it may then supply depends on WHY pass 1 stalled;
 *           that rule is enforced in code below rather than asked for in the
 *           prompt, because asking did not work.
 *
 * Measured on the 21-org dev bank: 10 of 10 organisations owning a vague
 * contouring service revealed a machine elsewhere in their own catalogue.
 */
const classifyServiceTechniqueImpl = async (
  db: DbConnection,
  input: ClassifyServiceTechniqueInput,
  vocabularyOverride?: TechniqueVocabulary
): Promise<Result<ClassifiedServiceTechnique>> => {
  const parsed = classifyServiceTechniqueSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }
  const { organizationServiceId, force } = parsed.data;

  const svc = await db.query.organizationService.findFirst({
    where: eq(organizationService.id, organizationServiceId),
    columns: {
      id: true,
      name: true,
      description: true,
      category: true,
      targetArea: true,
      organizationId: true,
      techniqueSlug: true,
      regions: true,
      expectedShot: true,
      techniqueClassifiedAt: true,
    },
  });
  if (!svc) {
    return err(new FeatureError(ErrorCodes.NOT_FOUND, 'Service not found'));
  }

  // Already answered. Note this gates on the TIMESTAMP, not on techniqueSlug:
  // a vague service correctly classified to null must not be re-asked on every
  // subsequent match job forever.
  if (svc.techniqueClassifiedAt && !force) {
    return ok({
      techniqueSlug: svc.techniqueSlug,
      regions: svc.regions ?? [],
      expectedShot: svc.expectedShot,
      confidence: 'unknown',
      reasoning: 'already classified',
      passes: 0,
      skipped: 'already_classified',
    });
  }

  const vocabulary = vocabularyOverride ?? (await loadTechniqueVocabulary(db));

  // Every OTHER active service name in the org, so a vague name can be read
  // against the catalogue it sits in. Not filtered to already-classified rows:
  // the evidence lives in the NAME ("Endymed contouring"), not in the slug.
  const siblings = await db
    .select({ name: organizationService.name })
    .from(organizationService)
    .where(
      and(
        eq(organizationService.organizationId, svc.organizationId),
        eq(organizationService.isActive, true),
        ne(organizationService.id, svc.id)
      )
    );

  const classifiable: ClassifiableService = {
    name: svc.name,
    description: svc.description,
    category: svc.category,
    targetArea: svc.targetArea,
    siblingNames: siblings.map((s) => s.name),
  };

  let outcome: PassResult;
  let passes = 1;
  try {
    outcome = await classifyOnce(vocabulary, classifiable, false);

    const undecided =
      outcome.slug === null || vocabulary.parentSlugs.has(outcome.slug);

    if (undecided && classifiable.siblingNames.length > 0) {
      passes = 2;
      const second = await classifyOnce(vocabulary, classifiable, true);

      // What pass 2 may supply depends on WHY pass 1 was undecided.
      //
      //   pass 1 = null    the name carries no treatment information at all.
      //                    Only hard MACHINE evidence is strong enough to
      //                    overturn "I don't know". A price list full of facials
      //                    does not make an unnamed service a facial, and one
      //                    full of injectables does not make "Wart and Tag
      //                    Removal" an injection — both shipped in a prod dry run
      //                    when any answer was accepted here.
      //
      //   pass 1 = parent  the name gave a CATEGORY but not the specifics, and
      //                    pass 2 is refining an answer that already admitted
      //                    uncertainty. Anything is allowed, including another
      //                    top-level technique.
      //
      // That second case is not hypothetical. The only children in the whole
      // taxonomy are the six modalities under `energy_contact`; everything else,
      // `laser_hair_removal` included, is top-level. So a machine-only rule made
      // pass 2 inert outside body contouring: a prod run classified "Full Butt"
      // and "Full Stomach" as `energy_contact` at a clinic whose every
      // neighbouring line reads "Laser Hair Removal" — pass 2 proposed the right
      // answer and the guard threw it away.
      const refiningAParent =
        outcome.slug !== null && vocabulary.parentSlugs.has(outcome.slug);
      const acceptable =
        second.slug !== null &&
        second.slug !== outcome.slug &&
        (refiningAParent || vocabulary.machineSlugs.has(second.slug));

      if (acceptable) outcome = second;
    }
  } catch (error) {
    logError('organizationServices.classifyServiceTechnique', error, {
      feature: 'organization-services',
      extra: { organizationServiceId, name: svc.name },
    });
    return err(
      new FeatureError(ErrorCodes.INTERNAL_ERROR, 'Failed to classify service')
    );
  }

  // Embed the expected_shot sentence. Both sides of the cosine comparison are
  // written in the same register, which is the point — comparing a service NAME
  // to a clip description compares two different kinds of text.
  let embedding: number[] | null = null;
  if (outcome.expectedShot) {
    try {
      const [vector] = await generateEmbeddings([outcome.expectedShot]);
      embedding = vector ?? null;
    } catch (error) {
      // Non-fatal: the gate still applies without an embedding, ordering just
      // falls back to least-recently-created. A legal unranked clip beats no
      // classification at all, so the technique is still worth writing.
      logError('organizationServices.classifyServiceTechnique.embed', error, {
        feature: 'organization-services',
        extra: { organizationServiceId },
      });
    }
  }

  // `technique_classified_at` is stamped even when the technique is NULL —
  // null is a legitimate result, so without the stamp every vague service is
  // re-classified on every match job forever.
  //
  // This service lives in organization-services rather than stock-footage
  // precisely so this write sits inside the table's owning domain. See
  // architecture/single-writer.test.ts.
  try {
    await db
      .update(organizationService)
      .set({
        techniqueSlug: outcome.slug,
        regions: outcome.regions,
        expectedShot: outcome.expectedShot || null,
        expectedShotEmbedding: embedding,
        // Inferred from the name — never 'declared'. Only a human saying so
        // earns that, and no human has been asked yet.
        specSource: outcome.slug ? 'inferred_from_name' : 'unknown',
        techniqueClassifiedAt: new Date(),
      })
      .where(eq(organizationService.id, svc.id));
  } catch (error) {
    logError('organizationServices.classifyServiceTechnique.persist', error, {
      feature: 'organization-services',
      extra: { organizationServiceId, techniqueSlug: outcome.slug },
    });
    return err(
      new FeatureError(
        ErrorCodes.INTERNAL_ERROR,
        'Failed to persist service classification'
      )
    );
  }

  return ok({
    techniqueSlug: outcome.slug,
    regions: outcome.regions,
    expectedShot: outcome.expectedShot || null,
    confidence: outcome.confidence,
    reasoning: outcome.reasoning,
    passes,
  });
};

export const classifyServiceTechnique = (
  db: DbConnection,
  input: ClassifyServiceTechniqueInput,
  vocabulary?: TechniqueVocabulary
) =>
  trackedResult(
    'organizationServices.classifyServiceTechnique',
    () => classifyServiceTechniqueImpl(db, input, vocabulary),
    {
      properties: { organizationServiceId: input.organizationServiceId },
      // NOT_FOUND on a deleted service is an expected race, not an incident.
      internalErrorsOnly: true,
    }
  );

export type ClassifyServiceTechniqueResult = Awaited<
  ReturnType<typeof classifyServiceTechnique>
>;
