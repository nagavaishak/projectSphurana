import { describe, expect, it } from '@borradh-workspace/testing';
import { expectTypeOf } from 'vitest';
import {
  type AppointmentId,
  type Cents,
  type Id,
  type OrganizationId,
  type PractitionerId,
  type UserId,
  addCents,
  cents,
  multiplyCents,
  subCents,
  zCents,
  zId,
} from './branded.js';

/**
 * Ratchet test for the branded-type primitives.
 *
 * This documents the intent of `branded.ts` and is meant to GROW as branding
 * rolls out. FOLLOW-UP: as `Cents` reaches every money column (totals, tips,
 * deposits, gift-card balances) and `Id<Brand>` reaches every FK field, add
 * behavioural/type assertions here (or per-feature) so a regression that widens
 * a branded field back to a raw `number`/`string` fails loudly.
 */
describe('branded primitives', () => {
  describe('cents()', () => {
    it('brands a valid non-negative integer', () => {
      expect(cents(5000)).toBe(5000);
      expect(cents(0)).toBe(0);
    });

    it('rejects negative amounts', () => {
      expect(() => cents(-1)).toThrow(TypeError);
    });

    it('rejects floats (no fractional cents)', () => {
      expect(() => cents(10.5)).toThrow(TypeError);
      expect(() => cents(Number.NaN)).toThrow(TypeError);
    });
  });

  describe('arithmetic helpers', () => {
    it('addCents is associative', () => {
      const a = cents(100);
      const b = cents(250);
      const c = cents(375);
      expect(addCents(addCents(a, b), c)).toBe(addCents(a, addCents(b, c)));
      expect(addCents(addCents(a, b), c)).toBe(725);
    });

    it('addCents is commutative', () => {
      expect(addCents(cents(100), cents(250))).toBe(
        addCents(cents(250), cents(100))
      );
    });

    it('subCents subtracts and stays non-negative', () => {
      expect(subCents(cents(5000), cents(2000))).toBe(3000);
      expect(subCents(cents(5000), cents(5000))).toBe(0);
    });

    it('subCents throws when the result would be negative', () => {
      expect(() => subCents(cents(2000), cents(5000))).toThrow(TypeError);
    });

    it('multiplyCents multiplies by a whole quantity', () => {
      expect(multiplyCents(cents(1500), 3)).toBe(4500);
      expect(() => multiplyCents(cents(1500), 2.5)).toThrow(TypeError);
    });
  });

  describe('zCents()', () => {
    it('parses to a branded Cents value', () => {
      const parsed = zCents().parse(5000);
      expect(parsed).toBe(5000);
      expectTypeOf(parsed).toEqualTypeOf<Cents>();
    });

    it('rejects floats and (with positive) zero/negatives', () => {
      expect(zCents().safeParse(10.5).success).toBe(false);
      expect(zCents().safeParse(0).success).toBe(true);
      expect(zCents({ positive: true }).safeParse(0).success).toBe(false);
      expect(zCents({ positive: true }).safeParse(-1).success).toBe(false);
    });

    it('keeps a plain number as its INPUT type (no caller churn)', () => {
      expectTypeOf<Parameters<typeof zCents>[0]>().toEqualTypeOf<
        { positive?: boolean } | undefined
      >();
      // Input accepts a raw number; output is branded.
      const schema = zCents();
      expectTypeOf(schema._input).toEqualTypeOf<number>();
      expectTypeOf(schema._output).toEqualTypeOf<Cents>();
    });
  });

  describe('zId()', () => {
    it('parses a string and brands it', () => {
      const parsed = zId<'User'>().parse('user_123');
      expect(parsed).toBe('user_123');
      expectTypeOf(parsed).toEqualTypeOf<UserId>();
    });

    it('rejects empty strings', () => {
      expect(zId<'User'>().safeParse('').success).toBe(false);
    });

    it('keeps a plain string as its INPUT type', () => {
      const schema = zId<'User'>();
      expectTypeOf(schema._input).toEqualTypeOf<string>();
      expectTypeOf(schema._output).toEqualTypeOf<UserId>();
    });
  });

  describe('id brands are distinct at the type level', () => {
    it('a PractitionerId is NOT assignable to a UserId (and vice-versa)', () => {
      const userId = 'u1' as UserId;
      const practitionerId = 'p1' as PractitionerId;

      // The whole point: these must NOT be interchangeable.
      // @ts-expect-error PractitionerId is not a UserId
      const bad1: UserId = practitionerId;
      // @ts-expect-error UserId is not a PractitionerId
      const bad2: PractitionerId = userId;
      void bad1;
      void bad2;

      // Both are still plain strings at runtime.
      expect(typeof userId).toBe('string');
      expect(typeof practitionerId).toBe('string');
    });

    it('distinct named aliases resolve to distinct Id brands', () => {
      expectTypeOf<UserId>().toEqualTypeOf<Id<'User'>>();
      expectTypeOf<PractitionerId>().toEqualTypeOf<Id<'Practitioner'>>();
      expectTypeOf<OrganizationId>().not.toEqualTypeOf<UserId>();
      expectTypeOf<AppointmentId>().not.toEqualTypeOf<PractitionerId>();
    });

    it('a branded Id is still assignable to a plain string (no cascade)', () => {
      const userId = 'u1' as UserId;
      const asString: string = userId; // widening is allowed
      expect(asString).toBe('u1');
    });
  });

  describe('Cents is assignable to number (serializes as a number)', () => {
    it('a Cents widens to number', () => {
      const c = cents(5000);
      const asNumber: number = c;
      expect(asNumber).toBe(5000);
      expectTypeOf(c).toMatchTypeOf<number>();
    });
  });
});
