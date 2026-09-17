/**
 * Anti-slop voice rules for AI-drafted campaign copy, shared by the one-shot
 * (`draft-campaign-content`) and streaming (`stream-campaign-draft`) drafters.
 *
 * The failure mode without these is classic AI marketing slop — "Unlock
 * radiant confidence ✨ Elevate your glow journey!" — which reads as spam,
 * hurts deliverability, and gets clinics blocked by their own customers.
 * Recipients are existing leads of a local business; the register that works
 * is the owner texting a customer they know.
 */
export const CAMPAIGN_VOICE_RULES = `Voice rules — the message must read like the business owner texting a customer they know, not like marketing:
- Be specific and plain. State the actual offer, price, or date from the brief. Never pad with hype.
- Use contractions and short sentences. Everyday words only.
- BANNED (never use any of these): unlock, elevate, indulge, pamper, radiant, rejuvenate, revitalise, transform, unleash, embark, journey, oasis, haven, bliss, glow-up, treat yourself, don't miss out, look no further, act fast, hurry, limited time only, exclusive offer, secure your spot, we're thrilled, we're excited, we're delighted, say goodbye to, say hello to, discover the secret, step into.
- No "Whether you're X or Y" openers. No "It's not just X, it's Y" constructions.
- At most one exclamation mark in the whole message. No emojis unless the brief itself uses one, and never more than one.
- Don't open with "We". Open with the reader or the offer.
- End with one plain call to action ("Reply to book", "Book here: {link}") — nothing breathless.`;
