import { sendEmail } from '@borradh-workspace/email';
import {
  beforeEach,
  createMockDatabase,
  describe,
  expect,
  expectResult,
  it,
} from '@borradh-workspace/testing';
import { type MockInstance, vi } from 'vitest';
import { ErrorCodes, ok } from '../../../shared/index.js';
import * as inviteMemberModule from '../invite-member/invite-member.service.js';
import { invitePractitioner } from './invite-practitioner.service.js';

// `inviteMember` is stubbed with a restored `vi.spyOn`, NOT `vi.mock`: under
// `isolate: false` every file in a worker shares one module graph, so a hoisted
// bare-factory mock leaks outward. Same reasoning as create-team-member.test.ts.
let inviteMemberSpy: MockInstance;

const ORG_ID = 'org-1';
const INVITER_ID = 'user-1';

const invitedPractitioner = {
  id: 'prac-1',
  organizationId: ORG_ID,
  userId: null,
  name: 'Emma Uipi',
  firstName: 'Emma',
  lastName: 'Uipi',
  email: 'emma@example.com',
  phone: null,
  phoneCountry: null,
  country: null,
};

const pendingInvitation = {
  id: 'inv-existing',
  organizationId: ORG_ID,
  email: 'emma@example.com',
  role: 'admin',
  status: 'pending',
  firstName: 'Emma',
  expiresAt: new Date('2026-01-01T00:00:00.000Z'),
  inviterId: INVITER_ID,
};

const validInput = {
  practitionerId: 'prac-1',
  organizationId: ORG_ID,
  inviterId: INVITER_ID,
};

describe('invitePractitioner', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
    vi.mocked(sendEmail).mockResolvedValue(undefined as never);

    inviteMemberSpy = vi
      .spyOn(inviteMemberModule, 'inviteMember')
      .mockResolvedValue(
        ok({
          emailSent: true,
          id: 'inv-new',
          organizationId: ORG_ID,
          email: invitedPractitioner.email,
          role: 'member',
          status: 'pending',
          expiresAt: new Date(),
          inviterId: INVITER_ID,
          firstName: 'Emma',
          lastName: 'Uipi',
          phone: null,
          phoneCountry: null,
          country: null,
        }) as never
      );
  });

  // The onboarding-wizard case: the practitioner exists and reads "Invited" in
  // the members table, but no invitation was ever created, so this person has
  // never been emailed at all.
  it('creates and sends a first invitation when none is pending', async () => {
    mockDb.query.practitioner.findFirst.mockResolvedValueOnce(
      invitedPractitioner
    );
    mockDb.query.invitation.findFirst.mockResolvedValueOnce(null);

    const result = await invitePractitioner(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.resent).toBe(false);
      expect(result.data.email).toBe('emma@example.com');
    }
    // Addressed off the practitioner row — never off the request body.
    expect(inviteMemberSpy).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ email: 'emma@example.com', role: 'member' })
    );
  });

  it('re-sends the EXISTING invitation rather than replacing it', async () => {
    mockDb.query.practitioner.findFirst.mockResolvedValueOnce(
      invitedPractitioner
    );
    mockDb.query.invitation.findFirst.mockResolvedValueOnce(pendingInvitation);
    mockDb.returning.mockResolvedValueOnce([
      { ...pendingInvitation, expiresAt: new Date('2026-02-01T00:00:00.000Z') },
    ]);

    const result = await invitePractitioner(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.resent).toBe(true);
      // Same id: a link already sitting in the invitee's inbox keeps working.
      expect(result.data.invitationId).toBe('inv-existing');
    }
    expect(inviteMemberSpy).not.toHaveBeenCalled();
    expect(sendEmail).toHaveBeenCalledTimes(1);
  });

  it('leaves an existing invitation’s role alone when no level is given', async () => {
    mockDb.query.practitioner.findFirst.mockResolvedValueOnce(
      invitedPractitioner
    );
    mockDb.query.invitation.findFirst.mockResolvedValueOnce(pendingInvitation);
    mockDb.returning.mockResolvedValueOnce([pendingInvitation]);

    await invitePractitioner(mockDb as never, validInput);

    // 'admin' preserved — a materialised default would silently demote them.
    expect(mockDb.set).toHaveBeenCalledWith(
      expect.objectContaining({ role: 'admin' })
    );
  });

  it('applies an explicitly requested permission level on re-send', async () => {
    mockDb.query.practitioner.findFirst.mockResolvedValueOnce(
      invitedPractitioner
    );
    mockDb.query.invitation.findFirst.mockResolvedValueOnce(pendingInvitation);
    mockDb.returning.mockResolvedValueOnce([pendingInvitation]);

    await invitePractitioner(mockDb as never, {
      ...validInput,
      permissionLevel: 'low',
    });

    expect(mockDb.set).toHaveBeenCalledWith(
      expect.objectContaining({ role: 'member' })
    );
  });

  it('returns CONFLICT when the member already has an account', async () => {
    mockDb.query.practitioner.findFirst.mockResolvedValueOnce({
      ...invitedPractitioner,
      userId: 'user-99',
    });

    await expectResult(
      invitePractitioner(mockDb as never, validInput)
    ).toFailWithCode(ErrorCodes.CONFLICT);

    expect(sendEmail).not.toHaveBeenCalled();
  });

  it('returns NOT_FOUND for a practitioner outside the org', async () => {
    mockDb.query.practitioner.findFirst.mockResolvedValueOnce(null);

    await expectResult(
      invitePractitioner(mockDb as never, validInput)
    ).toFailWithCode(ErrorCodes.NOT_FOUND);
  });

  // The whole point of the feature is that the owner learns the truth. A send
  // the mail provider rejected must NOT come back as a success toast.
  it('fails when the re-sent email is rejected', async () => {
    mockDb.query.practitioner.findFirst.mockResolvedValueOnce(
      invitedPractitioner
    );
    mockDb.query.invitation.findFirst.mockResolvedValueOnce(pendingInvitation);
    mockDb.returning.mockResolvedValueOnce([pendingInvitation]);
    vi.mocked(sendEmail).mockRejectedValueOnce(new Error('Resend is down'));

    await expectResult(
      invitePractitioner(mockDb as never, validInput)
    ).toFailWithCode(ErrorCodes.INTERNAL_ERROR);
  });

  it('fails when a first send is created but the email never leaves', async () => {
    mockDb.query.practitioner.findFirst.mockResolvedValueOnce(
      invitedPractitioner
    );
    mockDb.query.invitation.findFirst.mockResolvedValueOnce(null);
    inviteMemberSpy.mockResolvedValueOnce(
      ok({
        emailSent: false,
        id: 'inv-new',
        organizationId: ORG_ID,
        email: invitedPractitioner.email,
        role: 'member',
        status: 'pending',
        expiresAt: new Date(),
        inviterId: INVITER_ID,
        firstName: null,
        lastName: null,
        phone: null,
        phoneCountry: null,
        country: null,
      }) as never
    );

    await expectResult(
      invitePractitioner(mockDb as never, validInput)
    ).toFailWithCode(ErrorCodes.INTERNAL_ERROR);
  });

  it('returns VALIDATION_ERROR for a missing practitioner id', async () => {
    await expectResult(
      invitePractitioner(mockDb as never, { ...validInput, practitionerId: '' })
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);

    expect(mockDb.query.practitioner.findFirst).not.toHaveBeenCalled();
  });
});
