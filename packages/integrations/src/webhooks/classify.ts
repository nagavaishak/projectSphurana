import type { MetaMessagingEvent } from './payloads.js';

/**
 * Which subscription field produced this `entry[].messaging[]` element.
 *
 * Meta does not label messaging events — the subscription field is inferred
 * from which key the object carries. This is the ONLY place that inference
 * lives, so the router's dispatch and the registry's subscription list are
 * talking about the same vocabulary.
 *
 * Returns `undefined` for a shape we cannot attribute to any known field; the
 * router treats that as `undeclared` and logs it loudly rather than dropping it.
 */
export const classifyMetaMessagingEvent = (
  event: MetaMessagingEvent,
  platform: 'facebook_messenger' | 'instagram_dm'
): string | undefined => {
  const isInstagram = platform === 'instagram_dm';

  // A message that CARRIES a referral (new thread from a click-to-message ad)
  // is still a `messages` event — the referral rides inside `message.referral`.
  if (event.message) return 'messages';

  // A referral with no message is the standalone referral field. Instagram
  // spells it singular; the Page API spells it plural.
  if (event.referral)
    return isInstagram ? 'messaging_referral' : 'messaging_referrals';

  if (event.postback) return 'messaging_postbacks';
  if (event.optin) return 'messaging_optins';
  if (event.reaction) return 'message_reactions';
  if (event.delivery) return 'message_deliveries';
  if (event.read) return isInstagram ? 'messaging_seen' : 'message_reads';

  // Handover Protocol: thread-control events carry one of these keys.
  const e = event as Record<string, unknown>;
  if (
    e.pass_thread_control ||
    e.take_thread_control ||
    e.request_thread_control
  )
    return 'messaging_handover';

  if (e.standby) return 'standby';

  // A user edited a DM they had already sent. Instagram delivers this as a
  // sibling key of `message` (never alongside it), so it must be classified
  // explicitly or the whole event is unattributable.
  if (e.message_edit) return 'message_edit';

  return undefined;
};
