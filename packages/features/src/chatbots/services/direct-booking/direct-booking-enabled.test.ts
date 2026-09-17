import { describe, expect, it } from '@borradh-workspace/testing';
import { directBookingBlockedReason } from './direct-booking-enabled.js';

describe('directBookingBlockedReason (hard eligibility gate)', () => {
  const eligible = {
    bookingDestination: 'borradh',
    primaryCalendarType: 'borradh',
    defaultBookingLink: null,
    chatbotSystemPrompt: null,
  };

  it('allows a native org with no external booking system', () => {
    expect(directBookingBlockedReason(eligible)).toBeNull();
  });

  it('blocks an org that does not book in the Borradh system', () => {
    expect(
      directBookingBlockedReason({
        ...eligible,
        bookingDestination: 'external_link',
        primaryCalendarType: null,
      })
    ).toMatch(/Borradh booking system/);
  });

  // During the ENG-500 expand/contract window a caller may not have selected
  // the new column yet; the legacy field must still decide rather than the
  // org silently reading as "not native".
  it('falls back to the legacy field when bookingDestination is absent', () => {
    expect(
      directBookingBlockedReason({
        defaultBookingLink: null,
        chatbotSystemPrompt: null,
        primaryCalendarType: 'borradh',
      })
    ).toBeNull();
    expect(
      directBookingBlockedReason({
        defaultBookingLink: null,
        chatbotSystemPrompt: null,
        primaryCalendarType: null,
      })
    ).toMatch(/Borradh booking system/);
  });

  // Real production cases. Enabling these means two booking systems that
  // cannot see each other, both accepting appointments for the same chair.
  it.each([
    ['Camden Beauty Spa', 'https://www.fresha.com/a/camden-beauty-spa-london'],
    ['CResultsBeauty', 'https://www.vagaro.com/cresultsbeauty'],
    ['K.O. Blade & Beauty', 'https://booking.podium.com/medspa/8b127ccc'],
    ['Aphros', 'https://aphros.eu1.cliniko.com/bookings'],
    ['TIANA', 'https://tianatherapy.glossgenius.com/booking-flow'],
    ['Embody Wellness', 'https://book.squareup.com/appointments/rt7pbdfu'],
  ])('blocks %s — books in an external system', (_name, link) => {
    expect(
      directBookingBlockedReason({ ...eligible, defaultBookingLink: link })
    ).toMatch(/external booking link/);
  });

  // Flawless Faces By Pamela: no default_booking_link, slug set, but a Fresha
  // URL in its custom prompt — which is injected as "HIGHEST PRIORITY —
  // OVERRIDES ALL OTHER RULES" and had been sent to customers 8+ times. No
  // code change can suppress it, so the only safe response is not to offer.
  it('blocks an org whose CUSTOM PROMPT carries an external booking link', () => {
    expect(
      directBookingBlockedReason({
        ...eligible,
        chatbotSystemPrompt:
          'Always send clients here to book: https://www.fresha.com/a/flawless-faces-by-pamela-county-meath',
      })
    ).toMatch(/custom prompt/);
  });

  it('does not block on an unrelated link in the custom prompt', () => {
    expect(
      directBookingBlockedReason({
        ...eligible,
        chatbotSystemPrompt:
          'Our gallery is at https://instagram.com/theclinic and parking is out back.',
      })
    ).toBeNull();
  });

  it('does not block on the org own borradh booking page', () => {
    expect(
      directBookingBlockedReason({
        ...eligible,
        defaultBookingLink: 'https://www.borradh.io/book/miso-life',
      })
    ).toBeNull();
  });

  // The prod dry run found four orgs slipping through a known-vendor
  // allowlist because they book through their OWN domain. A hostname
  // allowlist fails open, and failing open means two systems booking the
  // same chair, so anything that is not our booking page disqualifies.
  it.each([
    ['Senan Ryan', 'https://americanaestheticmc.com'],
    ['PRIMAL', 'https://primaldallas.com/visit-frisco-clinic/'],
    ['The Residence', 'Https://go.souldelana.com/book'],
    [
      'nafi aesthetics',
      'https://www.nafiaesthetics.com/booking-calendar/pdo-threads',
    ],
  ])('blocks %s — books on its own domain, not a known vendor', (_n, link) => {
    expect(
      directBookingBlockedReason({ ...eligible, defaultBookingLink: link })
    ).toMatch(/external booking link/);
  });

  it('blocks an unparseable booking link rather than failing open', () => {
    expect(
      directBookingBlockedReason({
        ...eligible,
        defaultBookingLink: 'not a url',
      })
    ).toMatch(/external booking link/);
  });

  it('does not treat a lookalike host as ours', () => {
    expect(
      directBookingBlockedReason({
        ...eligible,
        defaultBookingLink: 'https://borradh.io.evil.com/book/x',
      })
    ).toMatch(/external booking link/);
    expect(
      directBookingBlockedReason({
        ...eligible,
        defaultBookingLink: 'https://notborradh.io/book/x',
      })
    ).toMatch(/external booking link/);
  });
});
