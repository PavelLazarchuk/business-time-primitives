import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
import { defineCalendar } from './calendar';
import { DAY, HOUR, at, iso, nyOffice, utcWeekdays } from './testUtils';
import { addBusinessTime, businessTimeBetween, subtractBusinessTime } from './time';
import type { DurationInput } from './types';

const add = (from: string, duration: DurationInput, calendar = nyOffice) =>
    iso(addBusinessTime(calendar, at(from), duration));
const subtract = (until: string, duration: DurationInput, calendar = nyOffice) =>
    iso(subtractBusinessTime(calendar, at(until), duration));

describe('addBusinessTime', () => {
    it('rolls over evenings and weekends', () => {
        expect(add('2026-10-02T19:00:00Z', { hours: 4 })).toBe('2026-10-05T15:00:00.000Z');
    });

    it('stops at closing time when the duration ends exactly there', () => {
        expect(add('2026-10-02T13:00:00Z', { hours: 8 })).toBe('2026-10-02T21:00:00.000Z');
    });

    it('starts the clock at the next opening when added outside hours', () => {
        expect(add('2026-10-03T15:00:00Z', { hours: 1 })).toBe('2026-10-05T14:00:00.000Z');
    });

    it('keeps 9–5 in local time across a DST change', () => {
        expect(add('2026-10-30T20:00:00Z', { hours: 2 })).toBe('2026-11-02T15:00:00.000Z');
    });

    it('honours short days and holidays', () => {
        expect(add('2026-12-23T20:00:00Z', { hours: 6 })).toBe('2026-12-24T18:00:00.000Z');
        expect(add('2026-12-23T20:00:00Z', { hours: 7 })).toBe('2026-12-28T15:00:00.000Z');
    });

    it('returns the start unchanged for a zero duration, even when closed', () => {
        expect(add('2026-10-03T15:00:00Z', 0)).toBe('2026-10-03T15:00:00.000Z');
    });

    it('walks backwards for negative durations', () => {
        expect(add('2026-10-05T14:00:00Z', { hours: -2 })).toBe('2026-10-02T20:00:00.000Z');
    });

    it('throws when the calendar runs out of business time', () => {
        const never = defineCalendar({ timeZone: 'UTC', week: {} });
        expect(() => addBusinessTime(never, at('2026-10-05T00:00:00Z'), { hours: 1 })).toThrow(
            'addBusinessTime: the calendar has no business time left after 2026-10-05T00:00:00.000Z'
        );
        const once = defineCalendar({
            timeZone: 'UTC',
            week: {},
            overrides: { '2040-06-01': '10:00-12:00' },
        });
        expect(add('2026-01-01T00:00:00Z', { hours: 1 }, once)).toBe('2040-06-01T11:00:00.000Z');
        expect(() => add('2026-01-01T00:00:00Z', { hours: 3 }, once)).toThrow(RangeError);
    });

    it('stays within the range a Date can hold instead of hanging', () => {
        const always = defineCalendar({ timeZone: 'UTC', week: { 'mon-sun': '00:00-24:00' } });
        expect(() => addBusinessTime(always, 8.64e15 - DAY, { hours: 1000 })).toThrow(
            'addBusinessTime: the calendar has no business time left after'
        );
        expect(() => addBusinessTime(utcWeekdays, 1e300, 1000)).toThrow(
            'from: 1e+300 is outside the range a Date can hold'
        );
        expect(() => addBusinessTime(nyOffice, -8.64e15 - 1, 1000)).toThrow('outside the range');
    });
});

describe('subtractBusinessTime', () => {
    it('finds the latest start that still finishes in time', () => {
        expect(subtract('2026-10-05T14:00:00Z', { hours: 2 })).toBe('2026-10-02T20:00:00.000Z');
        expect(subtract('2026-10-05T14:00:00Z', { hours: 1 })).toBe('2026-10-05T13:00:00.000Z');
    });

    it('names itself in errors', () => {
        const never = defineCalendar({ timeZone: 'UTC', week: {} });
        expect(() => subtractBusinessTime(never, 0, { hours: 1 })).toThrow(
            'subtractBusinessTime: the calendar has no business time left before'
        );
        expect(() => subtractBusinessTime(nyOffice, Number.NaN, 1)).toThrow(
            'until: not a valid point in time'
        );
    });

    it('reaches far back across a long dated closure', () => {
        const closed = defineCalendar({
            timeZone: 'UTC',
            week: { 'mon-fri': '09:00-17:00' },
            holidays: ['2026-01-05/2036-01-04', '2036-01-05/2036-01-12'],
        });
        expect(subtract('2036-01-14T10:00:00Z', { hours: 2 }, closed)).toBe(
            '2026-01-02T16:00:00.000Z'
        );
    });
});

describe('businessTimeBetween', () => {
    it('counts only open time, signed by direction', () => {
        const friday = at('2026-10-02T20:00:00Z');
        const monday = at('2026-10-05T14:00:00Z');
        expect(businessTimeBetween(nyOffice, friday, monday)).toBe(2 * HOUR);
        expect(businessTimeBetween(nyOffice, monday, friday)).toBe(-2 * HOUR);
        expect(businessTimeBetween(nyOffice, monday, monday)).toBe(0);
    });

    it('refuses spans of more than a century', () => {
        expect(() => businessTimeBetween(nyOffice, 0, 101 * 366 * DAY)).toThrow(
            'businessTimeBetween: spans more than 100 years'
        );
    });
});

describe('durations', () => {
    const plus = (duration: DurationInput) => add('2026-10-05T13:00:00Z', duration);

    it('accept milliseconds and parts', () => {
        expect(plus(90 * 60_000)).toBe('2026-10-05T14:30:00.000Z');
        expect(plus({ hours: 1, minutes: 30 })).toBe('2026-10-05T14:30:00.000Z');
        expect(plus({ seconds: 30, milliseconds: 500 })).toBe('2026-10-05T13:00:30.500Z');
        expect(plus({ microseconds: 1500 })).toBe('2026-10-05T13:00:00.001Z');
    });

    it('treat undefined parts as zero', () => {
        expect(plus({ hours: 1, minutes: undefined })).toBe('2026-10-05T14:00:00.000Z');
    });

    it('read Temporal.Duration-style getters', () => {
        class Duration {
            get years() {
                return 0;
            }
            get days() {
                return 0;
            }
            get hours() {
                return 4;
            }
            get minutes() {
                return 15;
            }
        }
        expect(plus(new Duration() as DurationInput)).toBe('2026-10-05T17:15:00.000Z');
        class Days extends Duration {
            override get days() {
                return 1;
            }
        }
        expect(() => plus(new Days() as DurationInput)).toThrow(
            "duration: 'days' of business time are ambiguous"
        );
    });

    it('reject typos, calendar units and nonsense', () => {
        expect(() => plus({ hour: 1 } as DurationInput)).toThrow('duration: unknown unit "hour"');
        expect(() => plus({ days: 1 } as DurationInput)).toThrow(
            "'days' of business time are ambiguous"
        );
        expect(() => plus({ weeks: 1 } as DurationInput)).toThrow("'weeks' of business time");
        expect(plus({ days: 0, hours: 1 } as DurationInput)).toBe('2026-10-05T14:00:00.000Z');
        expect(() => plus({ hours: Number.NaN })).toThrow('duration.hours: not a finite number');
        expect(() => plus({ hours: '1' } as unknown as DurationInput)).toThrow('duration.hours');
        expect(() => plus(Number.POSITIVE_INFINITY)).toThrow('duration: not a finite number');
        expect(() => plus(null as unknown as DurationInput)).toThrow('got null');
        expect(() => plus('1h' as unknown as DurationInput)).toThrow('got string');
        expect(() => plus({ hours: 101 * 366 * 24 })).toThrow('more than 100 years');
    });
});

describe('instants', () => {
    it('accept Dates from another realm', () => {
        const foreign = runInNewContext('new Date("2026-10-05T13:00:00Z")');
        expect(iso(addBusinessTime(nyOffice, foreign, { hours: 1 }))).toBe(
            '2026-10-05T14:00:00.000Z'
        );
    });

    it('reject anything else', () => {
        expect(() => addBusinessTime(nyOffice, new Date('nope'), 1)).toThrow(
            'from: not a valid point in time'
        );
        expect(() => addBusinessTime(nyOffice, '2026-10-05' as unknown as Date, 1)).toThrow(
            'from: expected a Date, epoch milliseconds or a Temporal instant, got string'
        );
        expect(() => addBusinessTime(nyOffice, null as unknown as Date, 1)).toThrow('got null');
        expect(() =>
            addBusinessTime(nyOffice, { epochMilliseconds: 'x' } as unknown as Date, 1)
        ).toThrow('from: not a valid point in time');
    });
});
