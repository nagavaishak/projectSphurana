import { orgDefaultsResponseSchema } from '@borradh-workspace/contracts';
import { clinicAreaTypeValues } from '@borradh-workspace/labels';
import { z } from 'zod';
import { defineTool } from '../../tool-factory/index.js';
import { resolveAdAccountCurrency } from '../_shared/ad-currency.js';

/**
 * Flat input schema for `org_defaults_setOrgDefault`.
 *
 * Note: this was previously a `z.discriminatedUnion('key', [...])` so each
 * branch could bind the LLM to the right value shape per key. Anthropic
 * rejects tool input schemas with top-level `oneOf`/`anyOf`/`allOf`
 * ("input_schema does not support oneOf, allOf, or anyOf at the top level"),
 * which a discriminated union compiles to. We flattened to a plain object
 * and moved the per-key value type binding into a `superRefine` so Zod
 * still rejects invalid combinations at parse time inside the factory.
 *
 * The bare action name is `setOrgDefault`; the controller's alias map
 * resolves the unprefixed name from skill `toolNames`.
 */
const SET_ORG_DEFAULT_KEYS = [
  'adDailyBudgetCents',
  'adObjective',
  'videoOrientation',
  'videoLengthSecs',
  'brandVoice',
  'defaultServiceIdForAds',
  'adAreaType',
] as const;

const AD_OBJECTIVE_VALUES = [
  'OUTCOME_LEADS',
  'OUTCOME_TRAFFIC',
  'OUTCOME_AWARENESS',
] as const;
const VIDEO_ORIENTATION_VALUES = ['landscape', 'portrait', 'square'] as const;

const setOrgDefaultInputSchema = z
  .object({
    key: z
      .enum(SET_ORG_DEFAULT_KEYS)
      .describe(
        'Which default to set. Each key expects a specific `value` shape:\n' +
          '- adDailyBudgetCents: positive integer minor units in the ad-account currency (e.g. 2000 = 20.00/day) or null to clear\n' +
          '- adObjective: one of "OUTCOME_LEADS" | "OUTCOME_TRAFFIC" | "OUTCOME_AWARENESS" or null\n' +
          '- videoOrientation: one of "landscape" | "portrait" | "square" or null\n' +
          '- videoLengthSecs: positive integer seconds (e.g. 30, 60, 90) or null\n' +
          '- brandVoice: non-empty string or null\n' +
          '- defaultServiceIdForAds: non-empty service id string or null\n' +
          '- adAreaType: one of "city" | "countryside" or null (sets the ' +
          'default ad-targeting radius: city→20km, countryside→40km)'
      ),
    value: z
      .union([z.string(), z.number(), z.null()])
      .describe(
        'New value for `key`, or `null` to clear the override and fall back to the system default. Must match the shape required by `key`.'
      ),
  })
  .superRefine((data, ctx) => {
    if (data.value === null) return;
    const key = data.key;
    const v = data.value;
    const bad = (msg: string) =>
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['value'],
        message: msg,
      });
    switch (key) {
      case 'adDailyBudgetCents':
      case 'videoLengthSecs':
        if (typeof v !== 'number' || !Number.isInteger(v) || v <= 0)
          bad(`${key} requires a positive integer`);
        return;
      case 'adObjective':
        if (
          typeof v !== 'string' ||
          !(AD_OBJECTIVE_VALUES as readonly string[]).includes(v)
        )
          bad(
            `adObjective must be one of ${AD_OBJECTIVE_VALUES.join(', ')} or null`
          );
        return;
      case 'videoOrientation':
        if (
          typeof v !== 'string' ||
          !(VIDEO_ORIENTATION_VALUES as readonly string[]).includes(v)
        )
          bad(
            `videoOrientation must be one of ${VIDEO_ORIENTATION_VALUES.join(', ')} or null`
          );
        return;
      case 'brandVoice':
      case 'defaultServiceIdForAds':
        if (typeof v !== 'string' || v.length === 0)
          bad(`${key} requires a non-empty string`);
        return;
      case 'adAreaType':
        if (
          typeof v !== 'string' ||
          !(clinicAreaTypeValues as readonly string[]).includes(v)
        )
          bad(
            `adAreaType must be one of ${clinicAreaTypeValues.join(', ')} or null`
          );
        return;
    }
  });

interface SetOrgDefaultOutput {
  key: string;
  value: number | string | null;
  /**
   * Short human-friendly confirmation message Claire can paraphrase back to
   * the operator (e.g. "Default ad budget is now €20/day").
   */
  summary: string;
}

function summariseChange(
  key: string,
  value: number | string | null,
  currencySymbol: string
): string {
  if (value === null) {
    return `Cleared ${key} override; Claire will use the system default from now on.`;
  }
  switch (key) {
    case 'adDailyBudgetCents': {
      const amount = (value as number) / 100;
      return `Default ad daily budget is now ${currencySymbol}${amount.toFixed(
        2
      )}/day.`;
    }
    case 'adObjective':
      return `Default ad objective is now ${value}.`;
    case 'videoOrientation':
      return `Default video orientation is now ${value}.`;
    case 'videoLengthSecs':
      return `Default video length is now ${value}s.`;
    case 'brandVoice':
      return 'Brand voice updated.';
    case 'defaultServiceIdForAds':
      return `Default service for ads set to ${value}.`;
    case 'adAreaType':
      return value === 'city'
        ? "Got it — you're in a town or city, so I'll keep the ads focused nearby."
        : "Got it — more rural, so I'll widen the reach so people can travel in.";
    default:
      return `Updated ${key}.`;
  }
}

/**
 * `org_defaults_setOrgDefault` — promote a single value to the org-level
 * default for Claire's creation flows.
 *
 * Non-destructive: this only writes to the `org_defaults` settings row, not
 * to anything that spends money or publishes. Used by the "make this my
 * default" affordance on Created cards (e.g. after Claire changes a
 * campaign's daily budget to €20, the card offers a button that prompts
 * Claire with "make €20/day my default ad budget").
 */
export const setOrgDefaultTool = defineTool<
  z.infer<typeof setOrgDefaultInputSchema>,
  SetOrgDefaultOutput
>({
  feature: 'org-defaults',
  action: 'setOrgDefault',
  description:
    'Set or clear a single per-org default Claire uses during creation. ' +
    'Non-destructive (writes to org settings only, no spend or publishing). ' +
    'Pass null as `value` to clear an override and fall back to the system ' +
    'default. Keys: adDailyBudgetCents, adObjective, videoOrientation, ' +
    'videoLengthSecs, brandVoice, defaultServiceIdForAds, adAreaType ' +
    '(city|countryside — sets the default ad-targeting radius).',
  inputSchema: setOrgDefaultInputSchema,
  destructive: false,
  preferredModel: 'sonnet',
  presentation: { statusLabel: 'Updating defaults' },
  additionalAllowedPaths: [/^org-defaults$/],
  execute: async (input, ctx) => {
    const body: Record<string, unknown> = { [input.key]: input.value };
    // PATCH returns the same resolved-defaults payload as GET (the controller
    // delegates to `findOne` after the write).
    const next = await ctx.apiFetch('org-defaults', {
      method: 'PATCH',
      body,
      schema: orgDefaultsResponseSchema,
    });

    // Echo back the value we actually persisted (the API returns the
    // resolved row, so we re-read the key off the response). Every
    // `SET_ORG_DEFAULT_KEYS` member is a field on the parsed payload, so this
    // index is checked rather than cast.
    const persistedValue = next[input.key];

    // The ad daily-budget summary is money, so format it in the connected ad
    // account's currency (EUR fallback); other keys ignore the symbol.
    const currencySymbol =
      input.key === 'adDailyBudgetCents'
        ? (await resolveAdAccountCurrency(ctx)).currency.symbol
        : '';

    return {
      data: {
        key: input.key,
        value: persistedValue ?? null,
        summary: summariseChange(
          input.key,
          persistedValue ?? null,
          currencySymbol
        ),
      },
    };
  },
});
