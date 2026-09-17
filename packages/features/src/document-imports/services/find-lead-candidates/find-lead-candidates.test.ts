import {
  beforeEach,
  createMockDatabase,
  describe,
  expect,
  it,
  vi,
} from '@borradh-workspace/testing';
import {
  findLeadCandidates,
  foldedParts,
  nameParts,
  nameTokens,
  phoneSuffix,
} from './find-lead-candidates.service.js';

describe('phoneSuffix', () => {
  it('keeps the last 9 digits regardless of formatting', () => {
    expect(phoneSuffix('+44 7700 900123')).toBe('447700900123'.slice(-9));
    expect(phoneSuffix('07700 900123')).toBe('700900123');
    expect(phoneSuffix('(077) 00-900123')).toBe('700900123');
  });

  it('ignores numbers too short to be a phone', () => {
    expect(phoneSuffix('12345')).toBeNull();
    expect(phoneSuffix(null)).toBeNull();
  });
});

describe('nameParts', () => {
  it('splits on punctuation and keeps initials instead of binning them', () => {
    // Initials used to be dropped by a `length >= 2` filter, which threw away
    // the only thing tying "B. O Suilleabhain-Fitzgerald" to Bartholomew.
    // Apostrophes and hyphens are separators on BOTH sides, so "O'Neil"
    // becomes o + neil wherever it is read from and still lines up.
    expect(nameParts("Mary-Jane O'Neil J.")).toEqual({
      words: ['mary', 'jane', 'neil'],
      initials: ['o', 'j'],
    });
    expect(nameParts('B. O Suilleabhain-Fitzgerald')).toEqual({
      words: ['suilleabhain', 'fitzgerald'],
      initials: ['b', 'o'],
    });
  });

  it('folds accents so a fada dropped on a form still matches', () => {
    expect(foldedParts("O'Súilleabháin-Fitzgerald")).toEqual([
      'o',
      'suilleabhain',
      'fitzgerald',
    ]);
    expect(foldedParts('Siobhán Ní Chatháin')).toEqual([
      'siobhan',
      'ni',
      'chathain',
    ]);
  });

  it('still exposes the plain word list for callers that want it', () => {
    expect(nameTokens("Mary-Jane O'Neil J.")).toEqual(['mary', 'jane', 'neil']);
  });
});

describe('findLeadCandidates', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
    mockDb.query.appointment.findMany.mockResolvedValue([]);
  });

  it('returns nothing without an identity signal and never queries', async () => {
    const result = await findLeadCandidates(mockDb as never, {
      organizationId: 'org_1',
      personName: null,
      email: null,
      phone: '123',
    });

    expect(result).toEqual([]);
    expect(mockDb.query.lead.findMany).not.toHaveBeenCalled();
  });

  it('scores email above phone above name and annotates what matched', async () => {
    mockDb.query.lead.findMany.mockResolvedValueOnce([
      {
        id: 'l_name',
        firstName: 'Jane',
        lastName: 'Doe',
        email: 'other@x.com',
        phone: null,
        whatsapp: null,
      },
      {
        id: 'l_phone',
        firstName: 'J',
        lastName: 'D',
        email: null,
        phone: '+44 7700 900123',
        whatsapp: null,
      },
      {
        id: 'l_email',
        firstName: 'Janet',
        lastName: 'Doe',
        email: 'Jane.Doe@Example.com',
        phone: null,
        whatsapp: '07700900123',
      },
    ]);
    mockDb.query.appointment.findMany.mockResolvedValueOnce([
      { leadId: 'l_email', startDate: new Date('2026-08-01T10:00:00Z') },
      { leadId: 'l_email', startDate: new Date('2026-07-01T10:00:00Z') },
    ]);

    const result = await findLeadCandidates(mockDb as never, {
      organizationId: 'org_1',
      personName: 'Jane Doe',
      email: 'jane.doe@example.com',
      phone: '07700 900123',
    });

    expect(result.map((c) => c.leadId)).toEqual([
      'l_email',
      'l_phone',
      'l_name',
    ]);
    // "Janet" contains the token "jane", so the name signal fires too.
    expect(result[0]).toMatchObject({
      matchedOn: ['email', 'phone', 'name'],
      score: 1,
      lastAppointments: ['2026-08-01', '2026-07-01'],
    });
    expect(result[1]).toMatchObject({ matchedOn: ['phone'], score: 0.9 });
    expect(result[2]).toMatchObject({
      name: 'Jane Doe',
      matchedOn: ['name'],
      // A whole-name hit is an identification, not a hint. At the old 0.6 it
      // sat under the auto-match bar, so a correctly matched name still went
      // to a human every time.
      score: 0.85,
    });
  });

  it('matches an initial and a fada-less surname to the full record', async () => {
    mockDb.query.lead.findMany.mockResolvedValueOnce([
      {
        id: 'l_barty',
        firstName: 'Bartholomew',
        lastName: "O'Súilleabháin-Fitzgerald",
        email: null,
        phone: null,
        whatsapp: null,
      },
    ]);

    const [candidate] = await findLeadCandidates(mockDb as never, {
      organizationId: 'org_1',
      personName: 'B. O Suilleabhain-Fitzgerald',
      email: null,
      phone: null,
    });

    expect(candidate).toMatchObject({
      leadId: 'l_barty',
      matchedOn: ['name'],
      score: 0.85,
    });
  });

  it('widens to any word only when every word together finds nobody', async () => {
    mockDb.query.lead.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([
      {
        id: 'l_kate',
        firstName: 'Katherine',
        lastName: 'Byrne',
        email: null,
        phone: null,
        whatsapp: null,
      },
    ]);

    const result = await findLeadCandidates(mockDb as never, {
      organizationId: 'org_1',
      personName: 'Kate Byrne',
      email: null,
      phone: null,
    });

    expect(mockDb.query.lead.findMany).toHaveBeenCalledTimes(2);
    // "kate" is not a substring of "katherine" the other way round, so only
    // the surname lands — a partial hit the adjudicator should settle, NOT a
    // whole-name auto-match.
    expect(result[0]).toMatchObject({ leadId: 'l_kate', matchedOn: [] });
    expect(result[0].score).toBeLessThan(0.7);
  });

  it('caps the candidate list at ten', async () => {
    mockDb.query.lead.findMany.mockResolvedValueOnce(
      Array.from({ length: 25 }, (_, i) => ({
        id: `l_${i}`,
        firstName: 'Sam',
        lastName: null,
        email: null,
        phone: null,
        whatsapp: null,
      }))
    );

    const result = await findLeadCandidates(mockDb as never, {
      organizationId: 'org_1',
      personName: 'Sam',
      email: null,
      phone: null,
    });

    expect(result).toHaveLength(10);
  });
});
