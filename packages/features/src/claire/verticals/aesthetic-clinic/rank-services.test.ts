import { describe, expect, it } from 'vitest';
import {
  beautyTherapistServices,
  bodyContouringServices,
  makeService,
  nurseLedClinicServices,
  surgicalClinicServices,
} from './__fixtures__/index.js';
import { rankServices } from './rank-services.js';

const topName = (
  services: ReturnType<typeof nurseLedClinicServices>,
  ranked: ReturnType<typeof rankServices>
): string | undefined =>
  services.find((s) => s.id === ranked[0]?.serviceId)?.name;

describe('rankServices — per-type selection (Agent A DoD)', () => {
  // ── A1: Surgical = flagship, not cheapest ─────────────────────────────
  describe('doctor_surgical → flagship (most expensive signature procedure)', () => {
    it('recommends the €4000 rhinoplasty over the €3000 lipo and €200 mole removal', () => {
      const services = [
        makeService({ name: 'Rhinoplasty', priceText: '€4000' }),
        makeService({ name: 'Liposuction', priceText: '€3000' }),
        makeService({ name: 'Mole Removal', priceText: '€200' }),
      ];
      const ranked = rankServices({
        axes: {
          retentionModel: 'consideration_sale',
          commitmentLevel: 'major',
          marketPosition: 'unknown',
        },
        services,
        verticalMetadata: {},
      });
      expect(topName(services, ranked)).toBe('Rhinoplasty');
    });

    it('keeps surgical procedures at rank 1 (existing fixture, now flagship-first)', () => {
      const services = surgicalClinicServices();
      const ranked = rankServices({
        axes: {
          retentionModel: 'consideration_sale',
          commitmentLevel: 'major',
          marketPosition: 'unknown',
        },
        services,
        verticalMetadata: {},
      });
      // Rhinoplasty €6000 is the flagship over Liposuction €4500.
      expect(topName(services, ranked)).toBe('Rhinoplasty');
    });
  });

  // ── A2: Beauty = head spa preferred ───────────────────────────────────
  describe('beauty_therapist → head spa preferred', () => {
    it('recommends head spa €65 over microneedling €90 and nails €25', () => {
      const services = [
        makeService({ name: 'Head Spa', priceText: '€65' }),
        makeService({ name: 'Microneedling', priceText: '€90' }),
        makeService({ name: 'Gel Nails', priceText: '€25' }),
      ];
      const ranked = rankServices({
        axes: {
          retentionModel: 'course_based',
          commitmentLevel: 'impulse',
          marketPosition: 'at',
        },
        services,
        verticalMetadata: {},
      });
      expect(topName(services, ranked)).toBe('Head Spa');
    });

    it('pins head spa in the existing beauty fixture too', () => {
      const services = beautyTherapistServices();
      const ranked = rankServices({
        axes: {
          retentionModel: 'course_based',
          commitmentLevel: 'impulse',
          marketPosition: 'at',
        },
        services,
        verticalMetadata: {},
      });
      expect(topName(services, ranked)).toBe('Head Spa');
    });

    it('does NOT pin head spa when the clinic is above-market', () => {
      const services = [
        makeService({ name: 'Head Spa', priceText: '€65' }),
        makeService({ name: 'Microneedling', priceText: '€90' }),
        makeService({ name: 'Gel Nails', priceText: '€25' }),
      ];
      const ranked = rankServices({
        axes: {
          retentionModel: 'course_based',
          commitmentLevel: 'impulse',
          marketPosition: 'above',
        },
        services,
        verticalMetadata: {},
      });
      // Falls through to normal trust-builder ranking (microneedling /
      // cheapest impulse) — explicitly not the pinned head spa behaviour.
      expect(topName(services, ranked)).not.toBe('Head Spa');
    });
  });

  // ── Types that must stay UNCHANGED ────────────────────────────────────
  describe('nurse_injectable → unchanged (cheapest course-based trust-builder)', () => {
    it('puts a course-based trust-builder at rank 1', () => {
      const services = nurseLedClinicServices();
      const ranked = rankServices({
        axes: {
          retentionModel: 'course_based',
          commitmentLevel: 'planned',
          marketPosition: 'at',
        },
        services,
        verticalMetadata: {},
      });
      expect(['Microneedling', 'Chemical Peel']).toContain(
        topName(services, ranked)
      );
    });
  });

  describe('body_contouring → unchanged (cheapest entry contouring)', () => {
    it('picks the cheapest course-based contouring treatment', () => {
      const services = bodyContouringServices();
      const ranked = rankServices({
        axes: {
          retentionModel: 'course_based',
          commitmentLevel: 'planned',
          marketPosition: 'at',
        },
        services,
        verticalMetadata: {},
      });
      // Ultrasonic Cavitation €60 is the cheapest contouring entry.
      expect(topName(services, ranked)).toBe('Ultrasonic Cavitation');
    });
  });

  describe('mixed → unchanged (course-based trust-builder)', () => {
    it('lands on a course-based trust-builder', () => {
      const services = [
        makeService({ name: 'Microneedling', priceText: '€150' }),
        makeService({ name: 'Chemical Peel', priceText: '€120' }),
        makeService({ name: 'Skin Boosters', priceText: '€250' }),
      ];
      const ranked = rankServices({
        axes: {
          retentionModel: 'course_based',
          commitmentLevel: 'planned',
          marketPosition: 'at',
        },
        services,
        verticalMetadata: {},
      });
      expect(['Microneedling', 'Chemical Peel']).toContain(
        topName(services, ranked)
      );
    });
  });
});
