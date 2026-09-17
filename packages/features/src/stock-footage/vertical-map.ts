import type { BusinessType } from '@borradh-workspace/database';

/**
 * Maps an organization's business type to the coarse stock-footage `vertical`
 * its clips are curated under. Every medical-aesthetic clinic business type
 * shares the single 'aesthetics' bank — they offer overlapping treatments the
 * bank's families already cover (injectables, laser/IPL, body contouring / fat
 * freezing, IV drips, teeth whitening, skin) plus a generic ambient clinic
 * pool that fits any of them. A business type absent from this map has no stock
 * vertical seeded yet, so the matcher no-ops gracefully (no stock auto-fill
 * until that vertical is curated).
 *
 * v1 = aesthetics only. Add entries here as new verticals are seeded.
 *
 * NOTE: keep this in sync with the "Clinics & Medical Aesthetics" group in
 * `businessTypeLabels` (packages/labels/src/organization.ts). Pure beauty/hair
 * businesses (salon, barber, nail_salon, tattoo_studio, spa) and non-aesthetic
 * medical types (physiotherapy, chiropractic) are intentionally left out — the
 * aesthetics procedure clips would be off-subject for them.
 */
export const STOCK_VERTICAL_BY_BUSINESS_TYPE: Partial<
  Record<BusinessType, string>
> = {
  aesthetic_clinic: 'aesthetics',
  cosmetic_clinic: 'aesthetics',
  skin_clinic: 'aesthetics',
  dermatology_clinic: 'aesthetics',
  laser_clinic: 'aesthetics',
  fat_freezing_clinic: 'aesthetics',
  dental_practice: 'aesthetics',
  medical_spa: 'aesthetics',
  wellness_clinic: 'aesthetics',
  beauty_clinic: 'aesthetics',
  iv_therapy_clinic: 'aesthetics',
  weight_loss_clinic: 'aesthetics',
  anti_aging_clinic: 'aesthetics',
  hair_restoration: 'aesthetics',
};

export function stockVerticalForBusinessType(
  businessType: BusinessType | null | undefined
): string | null {
  if (!businessType) return null;
  return STOCK_VERTICAL_BY_BUSINESS_TYPE[businessType] ?? null;
}
