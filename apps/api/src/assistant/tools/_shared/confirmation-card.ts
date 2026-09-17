import type { ClaireConfirmationAction } from '@borradh-workspace/database';

/**
 * The card that asks an owner to approve something irreversible.
 *
 * ONE SHAPE, for every confirmation. The factory already emits exactly this for
 * tools declared `destructive: true`; the hand-rolled confirm/execute PAIRS —
 * `confirmLaunchAd` → `executeLaunchAd`, and five others — issued their own
 * token and returned it as bare data, so the frontend had to recognise each one
 * by tool name and render a bespoke card.
 *
 * That divergence had a cost, and it had been shipped: those bespoke cards were
 * written for a world where the tool PAUSED at `input-available` and the browser
 * supplied the answer through `addToolOutput({ output: 'approved' })`. Every one
 * of these tools executes on the server and streams an OBJECT, so every card hit
 * its `state === 'output-available'` branch, compared that object to the string
 * `'approved'`, and rendered a red CANCELLED badge over an action nobody had
 * cancelled — with no way left to approve it. Launching an ad, changing a
 * budget, escalating a conversation, rendering a video: all of them.
 *
 * Emitting the same envelope the factory emits means there is ONE card and one
 * path, and the next destructive tool gets it without anyone remembering to.
 *
 * The card ANSWERS BY SENDING A MESSAGE rather than calling the tool back. The
 * second call has to carry the confirmation token and the model is what holds
 * it — the same reason the clip editor stages on the server rather than in
 * React.
 */
export function confirmationCard(input: {
  action: ClaireConfirmationAction;
  resourceId: string;
  token: string;
  expiresAt: Date | string;
  /** The question, in the owner's terms. "Launch this ad?" — not "Confirm?" */
  title: string;
  /** What they are agreeing to. Money and reach belong here. */
  fields: { label: string; value: string }[];
  /** The tool that runs once confirmed, so the model knows what to call. */
  executeToolName: string;
  /** The verb on the button: "Launch", "Pause", "Render". Not "Confirm". */
  confirmLabel?: string;
}) {
  return {
    type: 'confirmation_required' as const,
    action: input.action,
    resourceId: input.resourceId,
    token: input.token,
    expiresAt:
      typeof input.expiresAt === 'string'
        ? input.expiresAt
        : input.expiresAt.toISOString(),
    summary: { title: input.title, fields: input.fields },
    executeToolName: input.executeToolName,
    ...(input.confirmLabel ? { confirmLabel: input.confirmLabel } : {}),
  };
}
