/**
 * REGRESSION — an archived service must be visibly archived on mobile.
 *
 * The mobile list gained archived rows so that a catalogue imported "as
 * archived" can be reviewed on a phone, which is where a lot of this product
 * is actually used. That is only safe if an archived row can never be mistaken
 * for a bookable one: mobile has no Status column to lean on, so the row
 * carries its own badge and a Restore action.
 *
 * Companion to `../services-page.test.tsx`, which pins the desktop half and
 * the query that made both surfaces hide these rows in the first place.
 */
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ServicesMobileList } from './services-mobile-list';
import type { ServiceCategoryGroup } from './services-mobile-utils';

const service = (id: string, name: string, isActive: boolean) =>
  ({
    id,
    name,
    isActive,
    priceType: 'fixed',
    priceCents: 8500,
    appointmentDuration: 60,
  }) as never;

const groups: ServiceCategoryGroup[] = [
  {
    key: 'facials',
    label: 'Facials',
    rows: [
      {
        id: 'svc_active',
        service: service('svc_active', 'Signature Glow Facial', true),
        offers: [],
        title: 'Signature Glow Facial',
        accentColor: '#abcdef',
        detailLines: ['60 min'],
      },
      {
        id: 'svc_archived',
        service: service('svc_archived', 'Imported Hydrafacial', false),
        offers: [],
        title: 'Imported Hydrafacial',
        accentColor: '#abcdef',
        detailLines: ['75 min'],
      },
    ],
  },
];

const renderList = (overrides: Record<string, unknown> = {}) =>
  render(
    <ServicesMobileList
      groups={groups}
      isError={false}
      isLoading={false}
      onAddService={vi.fn()}
      onDeleteService={vi.fn()}
      onEditService={vi.fn()}
      onToggleArchive={vi.fn()}
      {...overrides}
    />
  );

describe('ServicesMobileList — archived rows', () => {
  it('shows archived services alongside active ones', () => {
    renderList();

    expect(screen.getByText('Imported Hydrafacial')).toBeInTheDocument();
    expect(screen.getByText('Signature Glow Facial')).toBeInTheDocument();
  });

  it('badges the archived row, and only the archived row', () => {
    // The load-bearing assertion. Mobile has no Status column, so without this
    // badge an imported-as-archived service reads exactly like a bookable one.
    renderList();

    const badges = screen.getAllByText('Archived');
    expect(badges).toHaveLength(1);

    // The badge belongs to the archived row, not merely to the page.
    const archivedRow = screen.getByText('Imported Hydrafacial').closest('li');
    expect(archivedRow).toContainElement(badges[0] as HTMLElement);
  });
});
