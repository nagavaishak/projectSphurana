import { createFileRoute } from '@tanstack/react-router';

import { HomeNew } from '../../-components/home-new';

export const Route = createFileRoute('/_authed/dashboard/l/$locationId/home')({
  component: HomeNew,
});

/**
 * The Claire home, one component at both viewports.
 *
 * There used to be a `MobileAiHome` wrapper here whose entire job was to hang a
 * "Chat history" button in the floating header's top-right corner; the body was
 * `HomeNew` either way. With that control gone the wrapper was a pass-through,
 * so the viewport branch went with it. The history sheet itself is unchanged and
 * still reachable from the assistant surface (`MobileAskAiSheet`).
 */
