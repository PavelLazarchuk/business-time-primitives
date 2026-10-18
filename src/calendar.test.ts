import { describe, expect, it } from 'vitest';
import { BusinessCalendarError, defineCalendar, validateCalendar } from './calendar';
import { hoursOn, isOpen } from './hours';
import { at } from './testUtils';
import type { BusinessCalendar } from './types';

const issuesOf = (input: unknown) => validateCalendar(input);
const week = (hours: Record<string, unknown>): unknown => ({ timeZone: 'UTC', week: hours });

describe('validation', () => {
    it('accepts a complete calendar', () => {
        expect(
            issuesOf({
                timeZone: 'Europe/Berlin',
                week: { 'mon-fri': ['09:00-12:30', '13:30-18:00'], sat: '10:00-14:00', sun: [] },
                holidays: ['2026-12-25', '--01-01', '2026-08-03/2026-08-14', '--12-24/--12-26'],
                overrides: { '2026-12-31': '09:00-12:00', '--05-01': [] },
            })
        ).toEqual([]);
    });

    it('reports every problem with its path', () => {
        expect(
            issuesOf({
                timeZone: 'Mars/Base',
                week: {
                    'mon-fry': '9-17',
                    mon: '25:00-26:00',
                    tue: 'x',
                    wed: 5,
                    thu: ['09:00-10:00', 7],
                },
                holidays: ['2026-02-30', 4],
                overrides: { 'next tuesday': '09:00-10:00', '2026-01-01': '09:00-09:00' },
                extra: true,
            })
        ).toEqual([
            {
                path: 'extra',
                message: 'unknown property — expected one of timeZone, week, holidays, overrides',
            },
            { path: 'timeZone', message: '"Mars/Base" is not a time zone this runtime knows' },
            {
                path: 'week["mon-fry"]',
                message:
                    "\"mon-fry\" is not a day — expected mon…sun, a range such as 'mon-fri', or a list such as 'sat,sun'",
            },
            {
                path: 'week["mon-fry"]',
                message: '"9" is not a start time — expected 00:00 to 23:59:59',
            },
            {
                path: 'week["mon"]',
                message: '"25:00" is not a start time — expected 00:00 to 23:59:59',
            },
            {
                path: 'week["tue"]',
                message: '"x" is not a range — expected \'HH:mm-HH:mm\'',
            },
            {
                path: 'week["wed"]',
                message: "expected 'HH:mm-HH:mm', a list of them, or [] for closed — got number",
            },
            { path: 'week["thu"][1]', message: "expected 'HH:mm-HH:mm', got number" },
            {
                path: 'holidays[0]',
                message:
                    "\"2026-02-30\" is not a date — expected 'YYYY-MM-DD', '--MM-DD' (every year) or a 'start/end' range of the same kind",
            },
            { path: 'holidays[1]', message: 'expected a date string, got number' },
            {
                path: 'overrides["next tuesday"]',
                message:
                    "\"next tuesday\" is not a date — expected 'YYYY-MM-DD', '--MM-DD' (every year) or a 'start/end' range of the same kind",
            },
            {
                path: 'overrides["2026-01-01"]',
                message: '"09:00-09:00" is empty — use \'00:00-24:00\' for a whole day',
            },
        ]);
    });

    it('rejects the wrong shapes', () => {
        expect(issuesOf(null)).toEqual([
            { path: '(calendar)', message: 'expected an object, got null' },
        ]);
        expect(issuesOf([])[0]?.message).toBe('expected an object, got an array');
        expect(issuesOf({ timeZone: 3, week: {} })[0]?.path).toBe('timeZone');
        expect(issuesOf({ timeZone: 'UTC', week: 'mon-fri' })[0]?.path).toBe('week');
        expect(issuesOf({ timeZone: 'UTC', week: {}, holidays: '2026-12-25' })[0]?.path).toBe(
            'holidays'
        );
        expect(issuesOf({ timeZone: 'UTC', week: {}, overrides: [] })[0]?.path).toBe('overrides');
    });

    it('checks times', () => {
        const message = (hours: string) =>
            issuesOf(week({ mon: hours })).map(issue => issue.message);
        expect(message('09:60-10:00')).toEqual([
            '"09:60" is not a start time — expected 00:00 to 23:59:59',
        ]);
        expect(message('09:00-10:00:61')).toEqual([
            '"10:00:61" is not an end time — expected 00:00 to 24:00',
        ]);
        expect(message('24:00-01:00')).toEqual([
            '"24:00" is not a start time — expected 00:00 to 23:59:59',
        ]);
        expect(message('09:00-24:30')).toEqual([
            '"24:30" is not an end time — expected 00:00 to 24:00',
        ]);
        expect(message('09:00-10:00-11:00')[0]).toContain('is not a range');
        expect(message('00:00-00:00')[0]).toContain('is empty');
        for (const good of [
            '9:00-17:00',
            ' 09:00 - 17:00 ',
            '09:00:30-17:00',
            '22:00-06:00',
            '00:00-24:00',
        ]) {
            expect(message(good)).toEqual([]);
        }
    });

    it('checks week keys', () => {
        expect(issuesOf(week({ 'mon-fri': '09:00-17:00', fri: '10:00-11:00' }))).toEqual([
            { path: 'week["fri"]', message: 'fri is already set by "mon-fri"' },
        ]);
        expect(issuesOf(week({ 'mon,mon': '09:00-17:00' }))[0]?.message).toBe(
            'mon is already set by "mon,mon"'
        );
        expect(issuesOf(week({ 'mon-tue-wed': '09:00-17:00' }))).toHaveLength(1);
        expect(issuesOf(week({ 'sat, sun': '09:00-17:00', 'mon - tue': '09:00-17:00' }))).toEqual(
            []
        );
    });

    it('checks date keys and ranges', () => {
        const holiday = (key: string) =>
            issuesOf({ timeZone: 'UTC', week: {}, holidays: [key] }).map(issue => issue.message);
        expect(holiday('2026-12-31/2026-12-01')).toEqual([
            '"2026-12-31/2026-12-01" ends before it starts',
        ]);
        expect(holiday('2026-01-01/2036-01-10')).toEqual([
            '"2026-01-01/2036-01-10" spans more than 3660 days',
        ]);
        expect(holiday('2026-01-01/--01-05')[0]).toContain('is not a date');
        expect(holiday('2026-01-01/2026-01-02/2026-01-03')[0]).toContain('is not a date');
        expect(holiday('--02-29')).toEqual([]);
        expect(holiday('--02-30')[0]).toContain('is not a date');
        expect(holiday('--12-30/--01-02')).toEqual([]);
    });

    it('rejects override ranges that overlap', () => {
        expect(
            issuesOf({
                timeZone: 'UTC',
                week: {},
                overrides: {
                    '2026-12-20/2026-12-27': '10:00-14:00',
                    '2026-12-24/2026-12-31': '09:00-12:00',
                    '--07-01/--07-31': '10:00-15:00',
                    '--07-15/--08-15': '10:00-15:00',
                },
            })
        ).toEqual([
            {
                path: 'overrides["2026-12-24/2026-12-31"]',
                message: 'overlaps with "2026-12-20/2026-12-27" — split one of the ranges',
            },
            {
                path: 'overrides["--07-15/--08-15"]',
                message: 'overlaps with "--07-01/--07-31" — split one of the ranges',
            },
        ]);
    });
});

describe('defineCalendar', () => {
    it('returns a deeply frozen copy', () => {
        const input = { timeZone: 'UTC', week: { mon: ['09:00-17:00'] }, holidays: ['2026-12-25'] };
        const calendar = defineCalendar(input);
        expect(calendar).toEqual(input);
        expect(calendar).not.toBe(input);
        expect(Object.isFrozen(calendar)).toBe(true);
        expect(Object.isFrozen(calendar.week.mon)).toBe(true);
        expect(() => (calendar.holidays as string[]).push('2026-12-26')).toThrow(TypeError);
    });

    it('throws a BusinessCalendarError listing every issue', () => {
        try {
            defineCalendar({ timeZone: 'Nowhere', week: { mon: '9' } } as BusinessCalendar);
            expect.unreachable();
        } catch (error) {
            expect(error).toBeInstanceOf(BusinessCalendarError);
            expect(error).toBeInstanceOf(RangeError);
            expect((error as BusinessCalendarError).issues).toHaveLength(2);
            expect((error as Error).message).toBe(
                'Invalid business calendar:\n' +
                    '  timeZone: "Nowhere" is not a time zone this runtime knows\n' +
                    `  week["mon"]: "9" is not a range — expected 'HH:mm-HH:mm'`
            );
        }
    });

    it('rejects invalid calendars in every function', () => {
        expect(() => isOpen({ timeZone: 'UTC' } as BusinessCalendar, 0)).toThrow(
            BusinessCalendarError
        );
        expect(() => isOpen(null as unknown as BusinessCalendar, 0)).toThrow(BusinessCalendarError);
    });
});

describe('plain calendar objects', () => {
    it('notices when a calendar is changed after first use', () => {
        const calendar = {
            timeZone: 'UTC',
            week: { 'mon-fri': '09:00-17:00' },
            holidays: [] as string[],
        };
        const christmas = at('2026-12-25T10:00:00Z');
        expect(isOpen(calendar, christmas)).toBe(true);
        calendar.holidays.push('2026-12-25');
        expect(isOpen(calendar, christmas)).toBe(false);
        expect(isOpen(calendar, christmas)).toBe(false);
    });
});

describe('precedence of dates', () => {
    const calendar = defineCalendar({
        timeZone: 'UTC',
        week: { 'mon-sun': '09:00-17:00' },
        holidays: ['2026-12-25', '2026-12-28/2026-12-29', '--01-01', '--12-30/--12-31'],
        overrides: {
            '2026-12-21/2026-12-31': '10:00-14:00',
            '2026-12-29': '08:00-09:00',
            '--12-31': '11:00-12:00',
            '--01-01/--01-02': '12:00-13:00',
        },
    });

    it.each([
        ['2026-12-25', [], 'a single holiday beats a range of short hours'],
        ['2026-12-24', ['10:00-14:00'], 'a range override applies'],
        ['2026-12-28', ['10:00-14:00'], 'a range override beats a range holiday'],
        ['2026-12-29', ['08:00-09:00'], 'a single override beats every range'],
        ['2026-12-31', ['10:00-14:00'], 'a dated range beats a yearly date'],
        ['2027-12-31', ['11:00-12:00'], 'a yearly date beats a yearly range'],
        ['2027-12-30', [], 'a yearly range holiday applies'],
        ['2027-01-01', [], 'a yearly holiday beats a yearly range override'],
        ['2027-01-02', ['12:00-13:00'], 'a yearly range override applies'],
        ['2027-01-04', ['09:00-17:00'], 'otherwise the week applies'],
    ])('%s → %j (%s)', (date, hours) => {
        expect(hoursOn(calendar, date)).toEqual(hours);
    });

    it('wraps yearly ranges past New Year and honours February 29', () => {
        const wrapped = defineCalendar({
            timeZone: 'UTC',
            week: { 'mon-sun': '09:00-17:00' },
            holidays: ['--12-30/--01-02', '--02-29'],
        });
        expect(
            ['2026-12-29', '2026-12-30', '2027-01-02', '2027-01-03'].map(day =>
                hoursOn(wrapped, day)
            )
        ).toEqual([['09:00-17:00'], [], [], ['09:00-17:00']]);
        expect(hoursOn(wrapped, '2028-02-29')).toEqual([]);
        expect(hoursOn(wrapped, '2027-03-01')).toEqual(['09:00-17:00']);
    });
});

describe('hoursOn', () => {
    const calendar = defineCalendar({
        timeZone: 'America/New_York',
        week: {
            'fri-mon': ['22:00-06:00', '10:00-14:00'],
            tue: '00:00-24:00',
            wed: '09:00:30-17:00',
            thu: '20:00-00:00',
        },
    });

    it('lists shifts in order, overnight shifts on the day they start', () => {
        expect(hoursOn(calendar, '2026-10-02')).toEqual(['10:00-14:00', '22:00-06:00']);
        expect(hoursOn(calendar, '2026-10-06')).toEqual(['00:00-24:00']);
        expect(hoursOn(calendar, '2026-10-07')).toEqual(['09:00:30-17:00']);
        expect(hoursOn(calendar, '2026-10-08')).toEqual(['20:00-24:00']);
    });

    it('reads an instant in the calendar time zone', () => {
        expect(hoursOn(calendar, at('2026-10-03T02:00:00Z'))).toEqual([
            '10:00-14:00',
            '22:00-06:00',
        ]);
    });

    it('rejects dates that are not YYYY-MM-DD', () => {
        expect(() => hoursOn(calendar, '10/02/2026')).toThrow(
            `date: "10/02/2026" is not a 'YYYY-MM-DD' date`
        );
    });
});
