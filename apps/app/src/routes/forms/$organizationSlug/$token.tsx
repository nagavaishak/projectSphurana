import { createFileRoute } from '@tanstack/react-router';

import { IntakeFillContent } from '../-components/intake-fill-content';

export const Route = createFileRoute('/forms/$organizationSlug/$token')({
  component: IntakeFillPage,
});

function IntakeFillPage() {
  const { organizationSlug, token } = Route.useParams();

  return (
    <>
      <title>Complete your form | Borradh</title>
      {/* Keep this page out of search indexes: the URL IS the credential. */}
      <meta name="robots" content="noindex, nofollow" />
      <IntakeFillContent organizationSlug={organizationSlug} token={token} />
    </>
  );
}
