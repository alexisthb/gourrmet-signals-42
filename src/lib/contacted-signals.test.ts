import { describe, expect, it } from 'vitest';
import { contactDateBounds, contactPeriod, feedbackSchema, parisMidnight } from './contacted-signals';

describe('retours entreprise', () => {
  for (const value of ['read', 'deleted_unread', 'not_interested', 'interested', 'sample_requested', 'order_in_progress']) {
    it(`accepte le retour ${value}`, () => expect(feedbackSchema.parse(value)).toBe(value));
  }
  it('refuse un retour hors des six choix', () => expect(feedbackSchema.safeParse('meeting').success).toBe(false));
});
describe('périodes de contact en heure de Paris', () => {
  it('inclut la date de fin, avec une limite exclusive au lendemain', () => {
    expect(contactDateBounds('2026-10-20', '2026-10-20')).toEqual({ from: '2026-10-19T22:00:00.000Z', until: '2026-10-20T22:00:00.000Z' });
  });
  it('respecte le jour de 25 heures au changement d’heure', () => {
    const bounds = contactDateBounds('2026-10-25', '2026-10-25');
    expect(bounds).toEqual({ from: '2026-10-24T22:00:00.000Z', until: '2026-10-25T23:00:00.000Z' });
  });
  it('respecte le jour de 23 heures au printemps', () => {
    expect(contactDateBounds('2026-03-29', '2026-03-29')).toEqual({ from: '2026-03-28T23:00:00.000Z', until: '2026-03-29T22:00:00.000Z' });
  });
  it('refuse une période inversée', () => expect(() => contactDateBounds('2026-10-21', '2026-10-20')).toThrow());
  it('refuse une date inexistante', () => expect(() => parisMidnight('2026-02-30')).toThrow());
  it('refuse une date de fin inexistante', () => expect(() => contactDateBounds('', '2026-02-30')).toThrow());
  it('les sept derniers jours incluent aujourd’hui', () => {
    expect(contactPeriod('7days', new Date('2026-10-20T12:54:00Z'))).toEqual({ from: '2026-10-14', to: '2026-10-20' });
  });
});