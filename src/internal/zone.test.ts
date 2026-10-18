import { describe, expect, it } from 'vitest';
import { at, iso } from '../testUtils';
import { checkTimeZone, dayOf, instantOf, wallOf } from './zone';

const zone = (timeZone: string) => ({ timeZone, utc: checkTimeZone(timeZone) });
const wall = (text: string) => at(`${text}Z`);

describe('wall clock', () => {
    it('reads local fields, including sub-second precision and negative epochs', () => {
        expect(iso(wallOf(zone('America/New_York'), at('2026-01-15T12:00:00.250Z')))).toBe(
            '2026-01-15T07:00:00.250Z'
        );
        expect(iso(wallOf(zone('Asia/Kathmandu'), at('2026-06-15T12:00:00Z')))).toBe(
            '2026-06-15T17:45:00.000Z'
        );
        expect(iso(wallOf(zone('Europe/Berlin'), at('1960-07-01T00:00:00.500Z')))).toBe(
            '1960-07-01T01:00:00.500Z'
        );
    });

    it('reads years before 1 AD, which Intl counts by era', () => {
        const berlin = zone('Europe/Berlin');
        const instant = Date.UTC(-50, 5, 10, 12);
        expect(wallOf(berlin, instant) - instant).toBe((53 * 60 + 28) * 1000);
        const yearZero = new Date(0);
        yearZero.setUTCFullYear(0, 5, 1);
        expect(wallOf(berlin, yearZero.getTime()) - yearZero.getTime()).toBe((53 * 60 + 28) * 1000);
    });

    it('skips Intl entirely for UTC', () => {
        expect(checkTimeZone('UTC')).toBe(true);
        expect(checkTimeZone('Etc/UTC')).toBe(true);
        expect(checkTimeZone('Europe/Berlin')).toBe(false);
        expect(wallOf({ timeZone: 'UTC', utc: true }, 123)).toBe(123);
        expect(instantOf({ timeZone: 'UTC', utc: true }, 456)).toBe(456);
    });

    it('rejects unknown zones', () => {
        expect(() => checkTimeZone('Mars/Olympus_Mons')).toThrow(RangeError);
    });

    it('gives the local day of an instant', () => {
        const newYork = zone('America/New_York');
        expect(dayOf(newYork, at('2026-10-03T03:00:00Z'))).toBe(
            dayOf(newYork, at('2026-10-02T12:00:00Z'))
        );
    });
});

describe('instantOf — the first moment the local clock reads a time', () => {
    it('is exact away from transitions', () => {
        expect(iso(instantOf(zone('Asia/Kolkata'), wall('2026-06-15T12:00:00')))).toBe(
            '2026-06-15T06:30:00.000Z'
        );
        expect(iso(instantOf(zone('America/New_York'), wall('2026-07-01T09:00:00')))).toBe(
            '2026-07-01T13:00:00.000Z'
        );
    });

    it('maps a time skipped by spring-forward to the moment of the jump', () => {
        const newYork = zone('America/New_York');
        expect(iso(instantOf(newYork, wall('2026-03-08T02:30:00')))).toBe(
            '2026-03-08T07:00:00.000Z'
        );
        expect(iso(instantOf(newYork, wall('2026-03-08T02:00:00')))).toBe(
            '2026-03-08T07:00:00.000Z'
        );
        expect(iso(instantOf(newYork, wall('2026-03-08T03:00:00')))).toBe(
            '2026-03-08T07:00:00.000Z'
        );
    });

    it('maps a time repeated by fall-back to its first pass', () => {
        expect(iso(instantOf(zone('America/New_York'), wall('2026-11-01T01:30:00')))).toBe(
            '2026-11-01T05:30:00.000Z'
        );
    });

    it('handles half-hour transitions', () => {
        const lordHowe = zone('Australia/Lord_Howe');
        expect(iso(instantOf(lordHowe, wall('2026-10-04T02:15:00')))).toBe(
            '2026-10-03T15:30:00.000Z'
        );
        expect(iso(instantOf(lordHowe, wall('2026-04-05T01:45:00')))).toBe(
            '2026-04-04T14:45:00.000Z'
        );
    });

    it('handles a day that never happened', () => {
        const apia = zone('Pacific/Apia');
        expect(iso(instantOf(apia, wall('2011-12-30T09:00:00')))).toBe('2011-12-30T10:00:00.000Z');
        expect(iso(instantOf(apia, wall('2011-12-31T09:00:00')))).toBe('2011-12-30T19:00:00.000Z');
    });

    it('returns the same answer from its memo', () => {
        const berlin = zone('Europe/Berlin');
        const first = instantOf(berlin, wall('2026-10-25T02:30:00'));
        expect(instantOf(berlin, wall('2026-10-25T02:30:00'))).toBe(first);
        expect(iso(first)).toBe('2026-10-25T00:30:00.000Z');
    });
});
