import {
  beforeEach,
  createMockDatabase,
  describe,
  expect,
  expectResult,
  it,
} from '@borradh-workspace/testing';
import { vi } from 'vitest';
import { ErrorCodes } from '../../../shared/index.js';
import { createSaleFromAppointment } from './create-sale-from-appointment.service.js';

describe('createSaleFromAppointment', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
  });

  const validInput = {
    organizationId: 'org_123',
    createdById: 'user_1',
    appointmentId: 'appt_1',
  };

  const seedSale = (currency = 'eur') => {
    // 1. insert(sale).returning() → the created sale
    mockDb.returning.mockResolvedValueOnce([
      {
        id: 'sale_1',
        organizationId: 'org_123',
        status: 'open',
        currency,
        tipType: 'none',
        tipCents: 0,
      },
    ]);
    // loadSaleWithRelations → the freshly created sale + relations
    mockDb.query.sale.findFirst.mockResolvedValueOnce({
      id: 'sale_1',
      organizationId: 'org_123',
      status: 'open',
      currency,
      tipType: 'none',
      tipCents: 0,
      items: [],
      payments: [],
    });
    // recompute reads items, persists totals, reads payments
    mockDb.query.saleItem.findMany.mockResolvedValueOnce([
      { totalCents: 5000 },
    ]);
    mockDb.returning.mockResolvedValueOnce([
      { id: 'sale_1', subtotalCents: 5000, totalCents: 5000, currency },
    ]);
    mockDb.query.salePayment.findMany.mockResolvedValueOnce([]);
  };

  it('binds the sale to the client and prices the line from the booked services', async () => {
    mockDb.query.appointment.findFirst.mockResolvedValueOnce({
      id: 'appt_1',
      leadId: 'lead_9',
      title: 'Haircut',
    });
    mockDb.query.appointmentService.findMany.mockResolvedValueOnce([
      { name: 'Haircut', priceCents: 3000, serviceId: 'svc_1' },
      { name: 'Blow dry', priceCents: 2000, serviceId: 'svc_2' },
    ]);
    mockDb.query.organizationLocation.findFirst.mockResolvedValueOnce({
      id: 'loc_1',
      country: 'ie',
      isPrimary: true,
    });
    seedSale();

    await expectResult(
      createSaleFromAppointment(mockDb as never, validInput)
    ).toSucceedWith((data) => {
      expect(data.totalCents).toBe(5000);
    });

    const insertedSale = mockDb.values.mock.calls[0][0];
    expect(insertedSale.leadId).toBe('lead_9');

    const insertedLine = mockDb.values.mock.calls[1][0];
    expect(insertedLine.itemType).toBe('appointment');
    expect(insertedLine.appointmentId).toBe('appt_1');
    // Sum of the two snapshot prices.
    expect(insertedLine.unitPriceCents).toBe(5000);
    expect(insertedLine.name).toBe('Haircut, Blow dry');
  });

  it('prices services without a snapshot (from/poa/free) at 0', async () => {
    mockDb.query.appointment.findFirst.mockResolvedValueOnce({
      id: 'appt_1',
      leadId: 'lead_9',
      title: 'Consultation',
    });
    mockDb.query.appointmentService.findMany.mockResolvedValueOnce([
      { name: 'Consultation', priceCents: null, serviceId: 'svc_3' },
    ]);
    mockDb.query.organizationLocation.findFirst.mockResolvedValueOnce(
      undefined
    );
    seedSale();

    const result = await createSaleFromAppointment(mockDb as never, validInput);
    expect(result.success).toBe(true);
    const insertedLine = mockDb.values.mock.calls[1][0];
    expect(insertedLine.unitPriceCents).toBe(0);
  });

  /** Appointment + services + primary location, the common preamble. */
  const seedAppointment = (country = 'ie') => {
    mockDb.query.appointment.findFirst.mockResolvedValueOnce({
      id: 'appt_1',
      leadId: 'lead_9',
      title: 'Botox',
    });
    mockDb.query.appointmentService.findMany.mockResolvedValueOnce([
      { name: 'Botox', priceCents: 5000, serviceId: 'svc_1' },
    ]);
    mockDb.query.organizationLocation.findFirst.mockResolvedValueOnce({
      id: 'loc_1',
      country,
      isPrimary: true,
    });
  };

  /** The `values()` call for the deposit tender, if one was written. */
  const depositTender = () =>
    mockDb.values.mock.calls
      .map((c) => c[0])
      .find((v) => v?.method === 'deposit');

  it('credits an already-paid deposit as a tender, so the customer is not charged twice', async () => {
    seedAppointment();
    mockDb.query.appointmentDeposit.findMany.mockResolvedValueOnce([
      { id: 'dep_1', amountCents: 2000, currency: 'eur' },
    ]);
    seedSale();

    const result = await createSaleFromAppointment(mockDb as never, validInput);
    expect(result.success).toBe(true);

    const tender = depositTender();
    expect(tender).toBeDefined();
    expect(tender.saleId).toBe('sale_1');
    expect(tender.amountCents).toBe(2000);
    // Settled with Stripe at booking — nothing left to capture.
    expect(tender.status).toBe('succeeded');
    // Carries the deposit id, which the unique index uses to stop a second
    // sale spending the same money.
    expect(tender.appointmentDepositId).toBe('dep_1');
  });

  it('does not credit a deposit an earlier sale already spent', async () => {
    seedAppointment();
    mockDb.query.appointmentDeposit.findMany.mockResolvedValueOnce([
      { id: 'dep_1', amountCents: 2000, currency: 'eur' },
    ]);
    // A prior sale for this appointment already redeemed it.
    mockDb.query.salePayment.findMany.mockResolvedValueOnce([
      { appointmentDepositId: 'dep_1' },
    ]);
    seedSale();

    const result = await createSaleFromAppointment(mockDb as never, validInput);
    expect(result.success).toBe(true);
    expect(depositTender()).toBeUndefined();
  });

  it('refuses to credit a deposit taken in a different currency', async () => {
    // Primary location is IE → the sale is in EUR; the deposit is in GBP.
    seedAppointment('ie');
    mockDb.query.appointmentDeposit.findMany.mockResolvedValueOnce([
      { id: 'dep_1', amountCents: 2000, currency: 'gbp' },
    ]);
    seedSale();

    const result = await createSaleFromAppointment(mockDb as never, validInput);
    expect(result.success).toBe(true);
    // Crediting it would invent an exchange rate; the sale stands at full price.
    expect(depositTender()).toBeUndefined();
  });

  it('writes no tender when there is no paid deposit', async () => {
    seedAppointment();
    mockDb.query.appointmentDeposit.findMany.mockResolvedValueOnce([]);
    seedSale();

    const result = await createSaleFromAppointment(mockDb as never, validInput);
    expect(result.success).toBe(true);
    expect(depositTender()).toBeUndefined();
  });

  it('returns NOT_FOUND when the appointment is missing', async () => {
    mockDb.query.appointment.findFirst.mockResolvedValueOnce(undefined);
    const result = await createSaleFromAppointment(mockDb as never, validInput);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe(ErrorCodes.NOT_FOUND);
    expect(mockDb.insert).not.toHaveBeenCalled();
  });

  it('returns VALIDATION_ERROR for a missing appointmentId', async () => {
    const result = await createSaleFromAppointment(mockDb as never, {
      ...validInput,
      appointmentId: '',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    }
  });
});
