import { useListOffers } from '@/features/offers/api';
import { useOfferEditor } from '@/features/offers/offer-form';
import { BRANCH_PATHS } from '@/lib/route-paths';

import { registerEntityEditor } from '../registry';

/**
 * The feature directory and the route slug are `offers`; the UI has said
 * "Promotions" everywhere for a long time. The editor takes the name the
 * operator reads — `/create/promotion` — while the list path stays
 * `BRANCH_PATHS.offers`.
 */
registerEntityEditor({
  slug: 'promotion',
  listPath: BRANCH_PATHS.offers,
  use: ({ id }) => {
    // Edit mode resolves the record from the list the catalog already caches,
    // so opening the editor from the list is instant and does not refetch. The
    // list items carry `serviceIds` / `locationIds`, which the form needs.
    const { offers, isLoading } = useListOffers({ limit: 100 });
    const offer = id ? (offers.find((o) => o.id === id) ?? null) : null;

    const editor = useOfferEditor({ offer });

    return {
      ...editor,
      isLoading: Boolean(id) && isLoading,
      notFound: Boolean(id) && !isLoading && !offer,
    };
  },
});
