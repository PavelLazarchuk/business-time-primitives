import { describe, expect, it } from 'vitest';
import { defineCalendar } from './calendar';
import { formatDay, parseDay } from './internal/civil';
import {
    addBusinessDays,
    businessDateOf,
    businessDaysBetween,
    isBusinessDay,
    localDate,
} from './days';
import { at, nyOffice, random } from './testUtils';

describe('isBusinessDay', () => {
    it('knows weekends, holidays and short days', () => {
        expect(isBusinessDay(nyOffice, '2026-10-02')).toBe(true);
        expect(isBusinessDay(nyOffice, '2026-10-03')).toBe(false);
        expect(isBusinessDay(nyOffice, '2026-11-26')).toBe(false);
        expect(isBusinessDay(nyOffice, '2026-12-24')).toBe(true);
        expect(isBusinessDay(nyOffice, '2027-12-24')).toBe(true);
        expect(isBusinessDay(nyOffice, '2026-12-25')).toBe(false);
    });

    it('reads instants in the calendar time zone', () => {
        expect(isBusinessDay(nyOffice, at('2026-10-03T02:00:00Z'))).toBe(true);
        expect(isBusinessDay(nyOffice, new Date('2026-10-03T05:00:00Z'))).toBe(false);
    });
});

describe('addBusinessDays', () => {
    it('steps over weekends and holidays, not counting the start', () => {
        expect(addBusinessDays(nyOffice, '2026-10-02', 1)).toBe('2026-10-05');
        expect(addBusinessDays(nyOffice, '2026-10-03', 1)).toBe('2026-10-05');
        expect(addBusinessDays(nyOffice, '2026-10-03', -1)).toBe('2026-10-02');
        expect(addBusinessDays(nyOffice, '2026-11-25', 1)).toBe('2026-11-27');
        expect(addBusinessDays(nyOffice, '2026-10-05', 10)).toBe('2026-10-19');
        expect(addBusinessDays(nyOffice, '2026-10-05', 0)).toBe('2026-10-05');
        expect(addBusinessDays(nyOffice, at('2026-10-03T02:00:00Z'), 1)).toBe('2026-10-05');
    });

    it('rejects fractional and absurd amounts', () => {
        expect(() => addBusinessDays(nyOffice, '2026-10-05', 1.5)).toThrow(
            'addBusinessDays: amount must be an integer, got 1.5'
        );
        expect(() => addBusinessDays(nyOffice, '2026-10-05', 1e7)).toThrow(
            'addBusinessDays: more than'
        );
    });

    it('jumps to calendars that only open far ahead or long ago', () => {
        const once = defineCalendar({
            timeZone: 'UTC',
            week: {},
            overrides: { '2040-06-01': '10:00-12:00' },
        });
        expect(addBusinessDays(once, '2026-01-01', 1)).toBe('2040-06-01');
        expect(addBusinessDays(once, '2041-01-01', -1)).toBe('2040-06-01');
        expect(() => addBusinessDays(once, '2026-01-01', 2)).toThrow(
            'addBusinessDays: the calendar runs out of business days after 2026-01-01'
        );
        expect(() => addBusinessDays(once, '2040-06-01', -1)).toThrow(
            'runs out of business days before'
        );
    });

    it('walks through a decade-long dated closure', () => {
        const closed = defineCalendar({
            timeZone: 'UTC',
            week: { 'mon-fri': '09:00-17:00' },
            holidays: ['2026-01-05/2036-01-04', '2036-01-05/2036-01-12'],
        });
        expect(addBusinessDays(closed, '2026-01-03', 1)).toBe('2036-01-14');
        expect(addBusinessDays(closed, '2036-01-14', -1)).toBe('2026-01-02');
    });

    it('fails cleanly on a calendar that never opens', () => {
        const never = defineCalendar({ timeZone: 'UTC', week: {} });
        expect(() => addBusinessDays(never, '2026-01-01', 1)).toThrow(
            'runs out of business days after'
        );
        expect(() => addBusinessDays(never, '2026-01-01', -1)).toThrow(
            'runs out of business days before'
        );
        expect(isBusinessDay(never, '2026-01-01')).toBe(false);
    });
});

describe('businessDaysBetween', () => {
    it('counts the days addBusinessDays steps over, in both directions', () => {
        expect(businessDaysBetween(nyOffice, '2026-10-01', '2026-10-04')).toBe(1);
        expect(businessDaysBetween(nyOffice, '2026-10-04', '2026-10-01')).toBe(-2);
        expect(addBusinessDays(nyOffice, '2026-10-04', -2)).toBe('2026-10-01');
        expect(businessDaysBetween(nyOffice, '2026-10-05', '2026-10-05')).toBe(0);
        expect(businessDaysBetween(nyOffice, '2026-11-20', '2026-11-30')).toBe(5);
    });

    it('is the inverse of addBusinessDays whenever the end is a business day', () => {
        const rng = random(11);
        const origin = parseDay('2026-10-01') as number;
        for (let run = 0; run < 400; run += 1) {
            const start = formatDay(origin + rng.int(120));
            const end = formatDay(origin + rng.int(120));
            if (!isBusinessDay(nyOffice, end)) continue;
            const days = businessDaysBetween(nyOffice, start, end);
            expect(addBusinessDays(nyOffice, start, days), `${start} → ${end}`).toBe(
                days === 0 ? start : end
            );
        }
    });

    it('refuses spans of more than a century', () => {
        expect(() => businessDaysBetween(nyOffice, '1900-01-01', '2026-01-01')).toThrow(
            'businessDaysBetween: spans more than 100 years'
        );
    });
});

describe('businessDateOf', () => {
    it('moves orders after the cutoff, or outside business days, to the next business day', () => {
        const order = (when: string, cutoff?: string) =>
            businessDateOf(nyOffice, at(when), cutoff === undefined ? {} : { cutoff });
        expect(order('2026-10-02T17:00:00Z', '14:00')).toBe('2026-10-02');
        expect(order('2026-10-02T19:00:00Z', '14:00')).toBe('2026-10-05');
        expect(order('2026-10-02T23:00:00Z')).toBe('2026-10-02');
        expect(order('2026-10-03T15:00:00Z', '14:00')).toBe('2026-10-05');
        expect(order('2026-11-25T20:00:00Z', '14:00')).toBe('2026-11-27');
    });

    it('validates the cutoff and names itself in errors', () => {
        expect(() => businessDateOf(nyOffice, 0, { cutoff: '2pm' })).toThrow(
            `businessDateOf: cutoff "2pm" is not a time — expected 'HH:mm'`
        );
        expect(() => businessDateOf(nyOffice, 0, { cutoff: 14 as unknown as string })).toThrow(
            'businessDateOf: cutoff 14'
        );
        expect(() => businessDateOf(nyOffice, 0, null as never)).toThrow(
            'businessDateOf: options must be an object, got null'
        );
        const never = defineCalendar({ timeZone: 'UTC', week: {} });
        expect(() => businessDateOf(never, 0)).toThrow(
            'businessDateOf: the calendar runs out of business days after 1970-01-01'
        );
    });
});

describe('localDate', () => {
    it('gives the calendar-local date of an instant', () => {
        expect(localDate(nyOffice, at('2026-10-03T02:00:00Z'))).toBe('2026-10-02');
        expect(localDate({ timeZone: 'Asia/Tokyo', week: {} }, at('2026-10-02T16:00:00Z'))).toBe(
            '2026-10-03'
        );
    });
});
