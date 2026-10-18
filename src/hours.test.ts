import { describe, expect, it } from 'vitest';
import { defineCalendar } from './calendar';
import { isOpen, openIntervals, openStatus } from './hours';
import { DAY, at, iso, nyOffice } from './testUtils';

const status = (calendar: Parameters<typeof openStatus>[0], when: string) => {
    const result = openStatus(calendar, at(when));
    return result.open
        ? { open: true, closesAt: iso(result.closesAt) }
        : { open: false, opensAt: iso(result.opensAt) };
};

describe('isOpen', () => {
    it('includes the opening minute and excludes the closing one', () => {
        expect(isOpen(nyOffice, at('2026-10-05T13:00:00Z'))).toBe(true);
        expect(isOpen(nyOffice, at('2026-10-05T12:59:59.999Z'))).toBe(false);
        expect(isOpen(nyOffice, at('2026-10-05T20:59:59.999Z'))).toBe(true);
        expect(isOpen(nyOffice, at('2026-10-05T21:00:00Z'))).toBe(false);
    });

    it('is closed on weekends, holidays and outside short days', () => {
        expect(isOpen(nyOffice, at('2026-10-03T15:00:00Z'))).toBe(false);
        expect(isOpen(nyOffice, at('2026-11-26T15:00:00Z'))).toBe(false);
        expect(isOpen(nyOffice, at('2026-12-24T17:00:00Z'))).toBe(true);
        expect(isOpen(nyOffice, at('2026-12-24T19:00:00Z'))).toBe(false);
    });

    it('accepts Dates and Temporal-like instants', () => {
        expect(isOpen(nyOffice, new Date('2026-10-05T14:00:00Z'))).toBe(true);
        expect(isOpen(nyOffice, { epochMilliseconds: at('2026-10-05T14:00:00Z') })).toBe(true);
    });
});

describe('openStatus', () => {
    it('says when an open business closes and a closed one opens', () => {
        expect(status(nyOffice, '2026-10-05T14:00:00Z')).toEqual({
            open: true,
            closesAt: '2026-10-05T21:00:00.000Z',
        });
        expect(status(nyOffice, '2026-10-03T15:00:00Z')).toEqual({
            open: false,
            opensAt: '2026-10-05T13:00:00.000Z',
        });
        expect(status(nyOffice, '2026-11-25T22:00:00Z')).toEqual({
            open: false,
            opensAt: '2026-11-27T14:00:00.000Z',
        });
    });

    it('treats split shifts as separate and overnight shifts as one stretch', () => {
        const bar = defineCalendar({
            timeZone: 'Europe/Berlin',
            week: { 'fri,sat': ['12:00-14:00', '20:00-04:00'] },
        });
        expect(status(bar, '2026-10-02T10:30:00Z')).toEqual({
            open: true,
            closesAt: '2026-10-02T12:00:00.000Z',
        });
        expect(status(bar, '2026-10-02T13:00:00Z')).toEqual({
            open: false,
            opensAt: '2026-10-02T18:00:00.000Z',
        });
        expect(status(bar, '2026-10-03T00:00:00Z')).toEqual({
            open: true,
            closesAt: '2026-10-03T02:00:00.000Z',
        });
    });

    it('merges back-to-back shifts across midnight', () => {
        const nights = defineCalendar({
            timeZone: 'UTC',
            week: { mon: '18:00-24:00', tue: ['00:00-02:00', '02:00-03:00'] },
        });
        expect(status(nights, '2026-10-05T20:00:00Z')).toEqual({
            open: true,
            closesAt: '2026-10-06T03:00:00.000Z',
        });
    });

    it('reports a 24/7 calendar as never closing and an empty one as never opening', () => {
        const always = defineCalendar({
            timeZone: 'America/New_York',
            week: { 'mon-sun': '00:00-24:00' },
        });
        expect(status(always, '2026-11-01T06:00:00Z')).toEqual({ open: true, closesAt: null });
        const never = defineCalendar({ timeZone: 'UTC', week: {} });
        expect(status(never, '2026-10-05T12:00:00Z')).toEqual({ open: false, opensAt: null });
    });

    it('finds a far-off opening behind a long dated closure', () => {
        const closed = defineCalendar({
            timeZone: 'UTC',
            week: { 'mon-fri': '09:00-17:00' },
            holidays: ['2026-01-05/2036-01-04', '2036-01-05/2036-01-12'],
        });
        expect(status(closed, '2026-01-03T12:00:00Z')).toEqual({
            open: false,
            opensAt: '2036-01-14T09:00:00.000Z',
        });
    });

    it('finds the only open day of a calendar made of overrides', () => {
        const once = defineCalendar({
            timeZone: 'UTC',
            week: {},
            overrides: { '2040-06-01': '10:00-12:00' },
        });
        expect(status(once, '2026-01-01T00:00:00Z')).toEqual({
            open: false,
            opensAt: '2040-06-01T10:00:00.000Z',
        });
        expect(status(once, '2040-06-01T11:00:00Z')).toEqual({
            open: true,
            closesAt: '2040-06-01T12:00:00.000Z',
        });
        expect(status(once, '2040-06-01T12:00:00Z')).toEqual({ open: false, opensAt: null });
    });
});

describe('openIntervals', () => {
    it('lists open time clipped to the range', () => {
        const intervals = openIntervals(
            nyOffice,
            at('2026-10-02T15:00:00Z'),
            at('2026-10-05T14:00:00Z')
        );
        expect(intervals.map(({ start, end }) => [iso(start), iso(end)])).toEqual([
            ['2026-10-02T15:00:00.000Z', '2026-10-02T21:00:00.000Z'],
            ['2026-10-05T13:00:00.000Z', '2026-10-05T14:00:00.000Z'],
        ]);
    });

    it('merges a 24/7 week across a DST change into one interval', () => {
        const always = defineCalendar({
            timeZone: 'America/New_York',
            week: { 'mon-sun': '00:00-24:00' },
        });
        const intervals = openIntervals(
            always,
            at('2026-10-28T00:00:00Z'),
            at('2026-11-05T00:00:00Z')
        );
        expect(intervals.map(({ start, end }) => [iso(start), iso(end)])).toEqual([
            ['2026-10-28T00:00:00.000Z', '2026-11-05T00:00:00.000Z'],
        ]);
    });

    it('returns nothing for an empty or reversed range, and refuses a century', () => {
        expect(
            openIntervals(nyOffice, at('2026-10-05T14:00:00Z'), at('2026-10-05T14:00:00Z'))
        ).toEqual([]);
        expect(
            openIntervals(nyOffice, at('2026-10-06T00:00:00Z'), at('2026-10-05T00:00:00Z'))
        ).toEqual([]);
        expect(() => openIntervals(nyOffice, 0, 101 * 366 * DAY)).toThrow(
            'openIntervals: spans more than 100 years'
        );
    });
});
